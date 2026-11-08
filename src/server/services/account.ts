import { and, eq } from "drizzle-orm";
import { passwordProblem } from "../../shared/password-rules";
import { POSTAL_ADDRESS_MAX, type PasswordChange, type ProfileUpdate, type TenantUpdate } from "../../shared/schemas";
import type { Database } from "../database/client";
import { tenants, users } from "../database/schema";
import { ApiError, badRequest, isUniqueViolation } from "../lib/errors";
import { nowMs } from "../lib/id";
import { hashPassword, verifyPassword } from "../lib/password";
import type { Actor } from "../middleware/auth";
import { LOGIN_MAX_FAILURES, lockedFor, recordFailure } from "./auth";
import { cleanName } from "./invitations";

type Self = Pick<Actor, "userId" | "tenantId" | "sessionId">;

/**
 * Changes the signed-in user's own name. Only first and last name: email, role and tenant are not editable here.
 * The name shown around the app ("display name") is kept as "first last".
 */
export async function updateProfile(db: Database, who: Self, input: ProfileUpdate): Promise<{ firstName: string; lastName: string; displayName: string }> {
  const firstName = cleanName(input.firstName);
  const lastName = cleanName(input.lastName);
  if (!firstName || !lastName) {
    throw badRequest("Validation failed", [{ path: !firstName ? "firstName" : "lastName", message: `${!firstName ? "First" : "Last"} name is required` }], "VALIDATION_ERROR");
  }
  const displayName = `${firstName} ${lastName}`;
  const rows = await db
    .update(users)
    .set({ firstName, lastName, displayName })
    .where(and(eq(users.id, who.userId), eq(users.tenantId, who.tenantId), eq(users.isDeleted, false)))
    .returning({ id: users.id });
  if (rows.length !== 1) throw new ApiError(404, "NOT_FOUND", "User not found");
  return { firstName, lastName, displayName };
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

  const d1 = db.$client;
  const key = `password:${who.userId}`;
  const now = nowMs();
  const wait = await lockedFor(d1, [key], now);
  if (wait > 0) {
    const seconds = Math.ceil(wait / 1000);
    throw new ApiError(429, "TOO_MANY_ATTEMPTS", `Too many incorrect attempts. Try again in ${Math.max(1, Math.ceil(seconds / 60))} minute(s).`, { retryAfterSeconds: seconds });
  }

  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, who.userId), eq(users.tenantId, who.tenantId), eq(users.isDeleted, false)))
    .limit(1);
  if (!user) throw new ApiError(404, "NOT_FOUND", "User not found");

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    await recordFailure(d1, key, LOGIN_MAX_FAILURES, now).run();
    throw badRequest("Your current password is not correct", [{ path: "currentPassword", message: "Your current password is not correct" }], "INVALID_CURRENT_PASSWORD");
  }

  const passwordHash = await hashPassword(input.newPassword);
  await d1.batch([
    d1.prepare(`UPDATE users SET password_hash = ?1, must_change_password = 0, updated_at = ?2 WHERE id = ?3 AND tenant_id = ?4`).bind(passwordHash, now, who.userId, who.tenantId),
    d1.prepare(`DELETE FROM sessions WHERE user_id = ?1 AND tenant_id = ?2 AND id <> ?3`).bind(who.userId, who.tenantId, who.sessionId ?? ""),
    d1.prepare(`DELETE FROM login_attempts WHERE key = ?1`).bind(key),
  ]);
  console.log(JSON.stringify({ level: "info", event: "password_changed", tenantId: who.tenantId, userId: who.userId }));
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
 * Updates the caller's company details: the organization's name and its postal address (either or both). Administrators
 * only (the route enforces that). Always the caller's own tenant: the id comes from the signed-in user, never from the
 * request. The slug is deliberately left alone, so anything that refers to the organization by it keeps working. Two
 * organizations cannot share a name (ignoring letter case). The postal address may be cleared.
 */
export async function updateTenant(db: Database, tenantId: string, input: TenantUpdate): Promise<{ id: string; name: string; slug: string; postalAddress: string }> {
  const changes: { name?: string; postalAddress?: string } = {};
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (!name) throw badRequest("Validation failed", [{ path: "name", message: "Name is required" }], "VALIDATION_ERROR");
    changes.name = name;
  }
  if (input.postalAddress !== undefined) {
    const postalAddress = cleanAddress(input.postalAddress);
    if (postalAddress.length > POSTAL_ADDRESS_MAX) {
      throw badRequest("Validation failed", [{ path: "postalAddress", message: `Use at most ${POSTAL_ADDRESS_MAX} characters` }], "VALIDATION_ERROR");
    }
    changes.postalAddress = postalAddress;
  }
  try {
    const [row] = await db.update(tenants).set(changes).where(eq(tenants.id, tenantId)).returning({ id: tenants.id, name: tenants.name, slug: tenants.slug, postalAddress: tenants.postalAddress });
    if (!row) throw new ApiError(404, "NOT_FOUND", "Organization not found");
    console.log(JSON.stringify({ level: "info", event: "tenant_updated", tenantId, fields: Object.keys(changes) }));
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ApiError(409, "TENANT_NAME_TAKEN", "That organization name is already in use", [{ path: "name", message: "That organization name is already in use" }]);
    }
    throw e;
  }
}
