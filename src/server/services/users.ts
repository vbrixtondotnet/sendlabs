import { asc, count, eq } from "drizzle-orm";
import type { UserAccountDto } from "../../shared/api";
import type { UserCreate, UserUpdate } from "../../shared/schemas";
import { passwordProblem } from "../../shared/password-rules";
import type { Database } from "../database/client";
import { sessions, users } from "../database/schema";
import { ApiError, isConstraintViolation, notFound } from "../lib/errors";
import { hashPassword } from "../lib/password";
import { iso } from "../lib/http";
import { cleanName, createAccount } from "./account";

/** User Accounts: the SuperAdmin's view of every account. Never returns password data. */
type Row = typeof users.$inferSelect;
const toDto = (r: Row): UserAccountDto => ({
  id: r.id,
  email: r.email,
  firstName: r.firstName,
  lastName: r.lastName,
  displayName: r.displayName,
  role: r.role,
  status: r.status,
  mustChangePassword: r.mustChangePassword,
  lastLoginAt: r.lastLoginAt === null ? null : iso(r.lastLoginAt),
  createdAt: iso(r.createdAt),
});

export async function listAccounts(db: Database): Promise<UserAccountDto[]> {
  const rows = await db.select().from(users).orderBy(asc(users.createdAt), asc(users.email));
  return rows.map(toDto);
}

export async function addAccount(db: Database, input: UserCreate): Promise<UserAccountDto> {
  const { userId } = await createAccount(db, {
    email: input.email,
    ...(input.firstName ? { firstName: input.firstName } : {}),
    ...(input.lastName ? { lastName: input.lastName } : {}),
    password: input.password,
    mustChangePassword: true,
    role: input.role,
  });
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return toDto(row!);
}

async function superAdminCount(db: Database): Promise<number> {
  const [r] = await db.select({ n: count() }).from(users).where(eq(users.role, "SuperAdmin"));
  return r?.n ?? 0;
}

/**
 * Edits an account. A SuperAdmin cannot lock themselves out: no changing their own role, disabling themselves, and the last
 * SuperAdmin keeps the role. Disabling an account, or giving it a new password, ends its sessions.
 */
export async function changeAccount(db: Database, actorId: string, id: string, input: UserUpdate): Promise<UserAccountDto> {
  const [current] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!current) throw notFound("User");
  if (id === actorId && ((input.role && input.role !== current.role) || input.status === "Disabled")) {
    throw new ApiError(409, "CANNOT_CHANGE_SELF", "You cannot change your own role or disable your own account");
  }
  if (current.role === "SuperAdmin" && input.role && input.role !== "SuperAdmin" && (await superAdminCount(db)) <= 1) {
    throw new ApiError(409, "LAST_SUPERADMIN", "There must be at least one SuperAdmin");
  }
  const set: Partial<typeof users.$inferInsert> = {};
  if (input.firstName !== undefined) set.firstName = cleanName(input.firstName);
  if (input.lastName !== undefined) set.lastName = cleanName(input.lastName);
  if (input.firstName !== undefined || input.lastName !== undefined) {
    const first = set.firstName ?? current.firstName;
    const last = set.lastName ?? current.lastName;
    set.displayName = [first, last].filter(Boolean).join(" ") || current.email.split("@")[0]!;
  }
  if (input.role) set.role = input.role;
  if (input.status) set.status = input.status;
  if (input.password !== undefined) {
    const problem = passwordProblem(input.password);
    if (problem) throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", [{ path: "password", message: problem }]);
    set.passwordHash = await hashPassword(input.password);
    set.mustChangePassword = true;
  }
  const [row] = await db.update(users).set(set).where(eq(users.id, id)).returning();
  if (input.status === "Disabled" || input.password !== undefined) await db.delete(sessions).where(eq(sessions.userId, id));
  return toDto(row!);
}

/** Deletes an account that owns nothing. One that has data (contacts, campaigns, a Gmail connection...) is refused: disable it instead. */
export async function removeAccount(db: Database, actorId: string, id: string): Promise<void> {
  if (id === actorId) throw new ApiError(409, "CANNOT_CHANGE_SELF", "You cannot delete your own account");
  const [current] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!current) throw notFound("User");
  if (current.role === "SuperAdmin" && (await superAdminCount(db)) <= 1) throw new ApiError(409, "LAST_SUPERADMIN", "There must be at least one SuperAdmin");
  try {
    await db.delete(sessions).where(eq(sessions.userId, id));
    await db.delete(users).where(eq(users.id, id));
  } catch (err) {
    if (isConstraintViolation(err)) throw new ApiError(409, "ACCOUNT_HAS_DATA", "This account still has data. Disable it instead of deleting it.");
    throw err;
  }
}
