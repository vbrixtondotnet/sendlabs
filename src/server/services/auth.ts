import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { normalizeEmail } from "../../shared/email";
import type { Database, DbOrTx } from "../database/client";
import { loginAttempts, sessions, users } from "../database/schema";
import { randomToken, sha256Base64Url } from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { newId, nowMs } from "../lib/id";
import { hashPassword, verifyPassword } from "../lib/password";
import { SESSION_TTL_MS } from "../lib/session";

/** Five wrong passwords for one address within 15 minutes lock that address for 15 minutes. */
export const LOGIN_MAX_FAILURES = 5;
/** One network address may fail this many times in the same window, across any accounts, before it is locked. */
export const LOGIN_IP_MAX_FAILURES = 30;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

const INVALID = () => new ApiError(401, "INVALID_CREDENTIALS", "Incorrect email or password");

/**
 * Something to check a password against when the address has no account, so an unknown address costs the same
 * time as a wrong password and the response time does not reveal which addresses exist. Made once per isolate.
 */
let decoy: Promise<string> | null = null;
const decoyHash = () => (decoy ??= hashPassword("decoy-password-never-matches"));

export interface LoginContext {
  /** The caller's network address (Cloudflare's CF-Connecting-IP), when there is one. */
  ip: string | null;
}

/** How long until the soonest of these keys may try again, in ms; 0 when none is locked. */
export async function lockedFor(db: DbOrTx, keys: string[], now: number): Promise<number> {
  const [row] = await db
    .select({ until: sql<number | null>`max(${loginAttempts.lockedUntil})` })
    .from(loginAttempts)
    .where(and(gt(loginAttempts.lockedUntil, now), inArray(loginAttempts.key, keys)));
  return row?.until ? Number(row.until) - now : 0;
}

/**
 * One atomic upsert: count the failure, start a new window if the last one is over, and lock at the limit.
 * (Every number is worked out here and bound as one value, with an explicit type where the database could not tell, so no
 * arithmetic is left between two untyped parameters.)
 */
export async function recordFailure(db: DbOrTx, key: string, max: number, now: number): Promise<void> {
  const fresh = sql`(${loginAttempts.windowStart} <= ${now - LOGIN_WINDOW_MS} OR (${loginAttempts.lockedUntil} IS NOT NULL AND ${loginAttempts.lockedUntil} <= ${now}))`;
  const failuresNow = sql`(CASE WHEN ${fresh} THEN 1 ELSE ${loginAttempts.failures} + 1 END)`;
  await db
    .insert(loginAttempts)
    .values({ key, failures: 1, windowStart: now, lockedUntil: null, updatedAt: now })
    .onConflictDoUpdate({
      target: loginAttempts.key,
      set: {
        failures: failuresNow,
        windowStart: sql`CASE WHEN ${fresh} THEN ${now}::bigint ELSE ${loginAttempts.windowStart} END`,
        lockedUntil: sql`CASE WHEN ${failuresNow} >= ${max} THEN ${now + LOGIN_LOCK_MS}::bigint ELSE NULL END`,
        updatedAt: now,
      },
    });
}

/**
 * Checks an email and password, and starts a session.
 *
 * Every way of being wrong (no such address, wrong password, a removed user) gets the SAME answer, after the SAME
 * amount of work, so it cannot be used to find out who has an account. Failures are counted per typed address and per
 * network address; once locked, even the right password is refused until the lock ends. Only a user who proved they
 * know the password is told their account is disabled.
 */
export async function login(
  db: Database,
  ctx: LoginContext,
  input: { email: string; password: string },
): Promise<{ sessionToken: string; expiresAt: number; mustChangePassword: boolean }> {
  const now = nowMs();
  const email = normalizeEmail(input.email);
  const emailKey = `email:${email}`;
  const ipKey = ctx.ip ? `ip:${ctx.ip.slice(0, 64)}` : null;
  const keys = ipKey ? [emailKey, ipKey] : [emailKey];

  const wait = await lockedFor(db, keys, now);
  if (wait > 0) {
    const seconds = Math.ceil(wait / 1000);
    throw new ApiError(429, "TOO_MANY_ATTEMPTS", `Too many failed attempts. Try again in ${Math.max(1, Math.ceil(seconds / 60))} minute(s).`, { retryAfterSeconds: seconds });
  }

  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash, status: users.status, mustChangePassword: users.mustChangePassword })
    .from(users)
    .where(eq(users.normalizedEmail, email))
    .limit(1);

  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await decoyHash()));
  if (!user || !ok) {
    await db.transaction(async (tx) => {
      await recordFailure(tx, emailKey, LOGIN_MAX_FAILURES, now);
      if (ipKey) await recordFailure(tx, ipKey, LOGIN_IP_MAX_FAILURES, now);
    });
    throw INVALID();
  }
  if (user.status !== "Active") throw new ApiError(403, "USER_DISABLED", "This account is disabled");

  const sessionToken = randomToken();
  const expiresAt = now + SESSION_TTL_MS;
  const tokenHash = await sha256Base64Url(sessionToken);
  await db.transaction(async (tx) => {
    await tx.delete(loginAttempts).where(eq(loginAttempts.key, emailKey));
    await tx.insert(sessions).values({ id: newId(), userId: user.id, tokenHash, expiresAt, createdAt: now });
    // Only the sign-in time: a sign-in is not an edit of the user, so updated_at stays as it was.
    await tx.execute(sql`UPDATE users SET last_login_at = ${now} WHERE id = ${user.id}`);
  });
  console.log(JSON.stringify({ level: "info", event: "login", userId: user.id }));
  return { sessionToken, expiresAt, mustChangePassword: user.mustChangePassword };
}
