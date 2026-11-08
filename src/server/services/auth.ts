import { and, eq } from "drizzle-orm";
import { normalizeEmail } from "../../shared/email";
import type { Database } from "../database/client";
import { access, tenants, users } from "../database/schema";
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

export async function lockedFor(d1: D1Database, keys: string[], now: number): Promise<number> {
  const marks = keys.map((_, i) => `?${i + 2}`).join(",");
  const row = await d1
    .prepare(`SELECT max(locked_until) AS until FROM login_attempts WHERE locked_until > ?1 AND key IN (${marks})`)
    .bind(now, ...keys)
    .first<{ until: number | null }>();
  return row?.until ? row.until - now : 0;
}

/** One atomic upsert: count the failure, start a new window if the last one is over, and lock at the limit. */
export function recordFailure(d1: D1Database, key: string, max: number, now: number) {
  const fresh = `(window_start <= ?2 - ?3 OR (locked_until IS NOT NULL AND locked_until <= ?2))`;
  return d1
    .prepare(
      `INSERT INTO login_attempts (key, failures, window_start, locked_until, updated_at) VALUES (?1, 1, ?2, NULL, ?2)
       ON CONFLICT(key) DO UPDATE SET
         failures = CASE WHEN ${fresh} THEN 1 ELSE failures + 1 END,
         window_start = CASE WHEN ${fresh} THEN ?2 ELSE window_start END,
         locked_until = CASE WHEN (CASE WHEN ${fresh} THEN 1 ELSE failures + 1 END) >= ?4 THEN ?2 + ?5 ELSE NULL END,
         updated_at = ?2`,
    )
    .bind(key, now, LOGIN_WINDOW_MS, max, LOGIN_LOCK_MS);
}

/**
 * Checks an email and password, and starts a session.
 *
 * Every way of being wrong (no such address, wrong password, a removed user) gets the SAME answer, after the SAME
 * amount of work, so it cannot be used to find out who has an account. Failures are counted per typed address and per
 * network address; once locked, even the right password is refused until the lock ends. Only a user who proved they
 * know the password is told their account is disabled or their organization suspended.
 */
export async function login(
  db: Database,
  ctx: LoginContext,
  input: { email: string; password: string },
): Promise<{ sessionToken: string; expiresAt: number; mustChangePassword: boolean }> {
  const d1 = db.$client;
  const now = nowMs();
  const email = normalizeEmail(input.email);
  const emailKey = `email:${email}`;
  const ipKey = ctx.ip ? `ip:${ctx.ip.slice(0, 64)}` : null;
  const keys = ipKey ? [emailKey, ipKey] : [emailKey];

  const wait = await lockedFor(d1, keys, now);
  if (wait > 0) {
    const seconds = Math.ceil(wait / 1000);
    throw new ApiError(429, "TOO_MANY_ATTEMPTS", `Too many failed attempts. Try again in ${Math.max(1, Math.ceil(seconds / 60))} minute(s).`, { retryAfterSeconds: seconds });
  }

  const [user] = await db
    .select({
      id: users.id,
      tenantId: users.tenantId,
      passwordHash: users.passwordHash,
      status: users.status,
      mustChangePassword: users.mustChangePassword,
      tenantStatus: tenants.status,
      accessName: access.name,
    })
    .from(users)
    .innerJoin(tenants, eq(users.tenantId, tenants.id))
    .innerJoin(access, eq(users.accessId, access.id))
    .where(and(eq(users.normalizedEmail, email), eq(users.isDeleted, false)))
    .limit(1);

  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await decoyHash()));
  if (!user || !ok) {
    await d1.batch([recordFailure(d1, emailKey, LOGIN_MAX_FAILURES, now), ...(ipKey ? [recordFailure(d1, ipKey, LOGIN_IP_MAX_FAILURES, now)] : [])]);
    throw INVALID();
  }
  if (user.status !== "Active") throw new ApiError(403, "USER_DISABLED", "This account is disabled. Ask an Administrator of your organization.");
  if (user.tenantStatus !== "Active") throw new ApiError(403, "TENANT_SUSPENDED", "This organization is suspended");

  const sessionToken = randomToken();
  const expiresAt = now + SESSION_TTL_MS;
  await d1.batch([
    d1.prepare(`DELETE FROM login_attempts WHERE key = ?1`).bind(emailKey),
    d1
      .prepare(`INSERT INTO sessions (id, tenant_id, user_id, token_hash, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(newId(), user.tenantId, user.id, await sha256Base64Url(sessionToken), expiresAt, now),
    d1.prepare(`UPDATE users SET last_login_at = ?1 WHERE id = ?2`).bind(now, user.id),
  ]);
  console.log(JSON.stringify({ level: "info", event: "login", tenantId: user.tenantId, userId: user.id }));
  return { sessionToken, expiresAt, mustChangePassword: user.mustChangePassword };
}
