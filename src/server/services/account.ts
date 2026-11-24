import { and, eq, ne, sql } from "drizzle-orm";
import type { MeDto } from "../../shared/api";
import { isValidEmail, normalizeEmail } from "../../shared/email";
import type { Role } from "../../shared/types";
import { passwordProblem } from "../../shared/password-rules";
import { POSTAL_ADDRESS_MAX, type CompanyUpdate, type PasswordChange, type ProfileUpdate } from "../../shared/schemas";
import type { Database } from "../database/client";
import { loginAttempts, sessions, users } from "../database/schema";
import { ApiError, badRequest, constraintMessage } from "../lib/errors";
import { newId, nowMs } from "../lib/id";
import { hashPassword, verifyPassword } from "../lib/password";
import type { Actor } from "../middleware/auth";
import { LOGIN_MAX_FAILURES, lockedFor, recordFailure } from "./auth";

type Self = Pick<Actor, "userId" | "sessionId">;

/** One line, single spaces, no control characters. */
export const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

export interface CreateAccountInput {
  email: string;
  firstName?: string;
  lastName?: string;
  /** Shown around the app. Derived from the name (or the email) when omitted. */
  displayName?: string;
  password: string;
  /** True for a temporary password the person must replace at first sign-in. */
  mustChangePassword?: boolean;
  /** What the account may use. Defaults to JobSeeker. */
  role?: Role;
  /** The company details its emails go out under. All optional: they can be set later in Settings. */
  company?: { name?: string; postalAddress?: string; website?: string };
}

/**
 * Creates an account: one user who owns their own data. There is no organization to create; the role (SuperAdmin, JobSeeker or Agency) says what it may use. Checks the email and
 * the password, and answers 409 EMAIL_EXISTS when the address is already an account. The sign-up flow, `npm run db:provision` and the
 * seed scripts all call this.
 */
export async function createAccount(db: Database, input: CreateAccountInput): Promise<{ userId: string }> {
  const email = input.email.trim();
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) throw badRequest("Validation failed", [{ path: "email", message: "Not a valid email address" }], "VALIDATION_ERROR");
  const problem = passwordProblem(input.password);
  if (problem) throw badRequest("Validation failed", [{ path: "password", message: problem }], "VALIDATION_ERROR");

  const firstName = cleanName(input.firstName ?? "");
  const lastName = cleanName(input.lastName ?? "");
  const displayName = cleanName(input.displayName ?? "") || [firstName, lastName].filter(Boolean).join(" ") || email.split("@")[0]!;
  const userId = newId();
  const passwordHash = await hashPassword(input.password);
  try {
    await db.insert(users).values({
      id: userId,
      email,
      normalizedEmail,
      firstName,
      lastName,
      displayName,
      passwordHash,
      mustChangePassword: input.mustChangePassword ?? false,
      role: input.role ?? "JobSeeker",
      companyName: cleanName(input.company?.name ?? ""),
      postalAddress: cleanAddress(input.company?.postalAddress ?? ""),
      website: cleanName(input.company?.website ?? ""),
    });
  } catch (err) {
    const message = constraintMessage(err);
    if (message.includes("users_normalized_email_uq") || message.includes("users.normalized_email")) throw new ApiError(409, "EMAIL_EXISTS", "An account with this email address already exists");
    throw err;
  }
  return { userId };
}

/**
 * Changes the signed-in user's own name and position. Nothing else: the email is not editable here.
 * The name shown around the app ("display name") is kept as "first last".
 */
export async function updateProfile(db: Database, who: Self, input: ProfileUpdate): Promise<{ firstName: string; lastName: string; position: string; displayName: string }> {
  const firstName = cleanName(input.firstName);
  const lastName = cleanName(input.lastName);
  if (!firstName || !lastName) {
    throw badRequest("Validation failed", [{ path: !firstName ? "firstName" : "lastName", message: `${!firstName ? "First" : "Last"} name is required` }], "VALIDATION_ERROR");
  }
  const displayName = `${firstName} ${lastName}`;
  // Left out = unchanged; sent empty = cleared. Tidied like a name: one line, single spaces.
  const position = input.position === undefined ? undefined : cleanName(input.position);
  const rows = await db
    .update(users)
    .set({ firstName, lastName, displayName, ...(position === undefined ? {} : { position }) })
    .where(eq(users.id, who.userId))
    .returning({ id: users.id, position: users.position });
  if (rows.length !== 1) throw new ApiError(404, "NOT_FOUND", "User not found");
  return { firstName, lastName, position: rows[0]!.position, displayName };
}

/**
 * Changes the signed-in user's own password. The current password must be given and is checked, so someone who walks
 * up to an unlocked screen cannot take the account over. Wrong guesses are counted and locked like sign-in is (the
 * check would otherwise be a way to guess the password from an already-open session).
 *
 * Every OTHER session of the user is ended, so a stolen or forgotten sign-in does not outlive the change. The one
 * making the change stays signed in. The "must change password" flag is cleared.
 */
export async function changePassword(db: Database, who: Self, input: PasswordChange): Promise<void> {
  const problem = passwordProblem(input.newPassword);
  if (problem) throw badRequest("Validation failed", [{ path: "newPassword", message: problem }], "VALIDATION_ERROR");
  if (input.newPassword === input.currentPassword) {
    throw badRequest("Validation failed", [{ path: "newPassword", message: "Choose a password different from your current one" }], "VALIDATION_ERROR");
  }

  const key = `password:${who.userId}`;
  const now = nowMs();
  const wait = await lockedFor(db, [key], now);
  if (wait > 0) {
    const seconds = Math.ceil(wait / 1000);
    throw new ApiError(429, "TOO_MANY_ATTEMPTS", `Too many incorrect attempts. Try again in ${Math.max(1, Math.ceil(seconds / 60))} minute(s).`, { retryAfterSeconds: seconds });
  }

  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, who.userId))
    .limit(1);
  if (!user) throw new ApiError(404, "NOT_FOUND", "User not found");

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    await recordFailure(db, key, LOGIN_MAX_FAILURES, now);
    throw badRequest("Your current password is not correct", [{ path: "currentPassword", message: "Your current password is not correct" }], "INVALID_CURRENT_PASSWORD");
  }

  const passwordHash = await hashPassword(input.newPassword);
  await db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE users SET password_hash = ${passwordHash}, must_change_password = false, updated_at = ${now} WHERE id = ${who.userId}`);
    await tx.delete(sessions).where(and(eq(sessions.userId, who.userId), ne(sessions.id, who.sessionId ?? "")));
    await tx.delete(loginAttempts).where(eq(loginAttempts.key, key));
  });
  console.log(JSON.stringify({ level: "info", event: "password_changed", userId: who.userId }));
}

/** Tidies a multi-line postal address: unified line breaks, no control characters, trimmed lines, no blank lines. */
export function cleanAddress(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Updates the caller's company details: the name and postal address printed in its emails, its website and its unsubscribe
 * settings (any of them). Always the caller's own account: the id comes from the signed-in user, never from the request.
 * The postal address may be cleared.
 */
export async function updateCompany(db: Database, userId: string, input: CompanyUpdate): Promise<MeDto["company"]> {
  const changes: { companyName?: string; postalAddress?: string; website?: string; requireUnsubscribeLink?: boolean; oneClickUnsubscribe?: boolean } = {};
  if (input.name !== undefined) changes.companyName = cleanName(input.name);
  if (input.postalAddress !== undefined) {
    const postalAddress = cleanAddress(input.postalAddress);
    if (postalAddress.length > POSTAL_ADDRESS_MAX) {
      throw badRequest("Validation failed", [{ path: "postalAddress", message: `Use at most ${POSTAL_ADDRESS_MAX} characters` }], "VALIDATION_ERROR");
    }
    changes.postalAddress = postalAddress;
  }
  if (input.requireUnsubscribeLink !== undefined) changes.requireUnsubscribeLink = input.requireUnsubscribeLink;
  if (input.oneClickUnsubscribe !== undefined) changes.oneClickUnsubscribe = input.oneClickUnsubscribe;
  if (input.website !== undefined) changes.website = cleanName(input.website); // already checked by the schema; tidied like any one-line value
  const [row] = await db
    .update(users)
    .set(changes)
    .where(eq(users.id, userId))
    .returning({ name: users.companyName, postalAddress: users.postalAddress, website: users.website, requireUnsubscribeLink: users.requireUnsubscribeLink, oneClickUnsubscribe: users.oneClickUnsubscribe });
  if (!row) throw new ApiError(404, "NOT_FOUND", "Account not found");
  console.log(JSON.stringify({ level: "info", event: "company_updated", userId, fields: Object.keys(changes) }));
  return row;
}
