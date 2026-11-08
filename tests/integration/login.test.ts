import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Base64Url } from "../../src/server/lib/crypto";
import { LOGIN_IP_MAX_FAILURES, LOGIN_LOCK_MS, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from "../../src/server/services/auth";
import { startHarness, uniqueEmail, type Harness } from "./harness";

let h: Harness;
const EMAIL = "admin@sabertoothsoftwarelabs.net";
const PASSWORD = "Password@123";

beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.dispose(); });
beforeEach(async () => { await h.sql("DELETE FROM login_attempts"); });

const login = (email: string, password: string, headers?: Record<string, string>) => h.anonymous.api("POST", "/api/auth/login", { email, password }, headers);
const cookieOf = (r: { headers: Headers }) => /sendrix_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? "";
const asSession = (s: string) => ({ cookie: `sendrix_session=${s}` });
const attempts = (key: string) => h.rows<{ failures: number; locked_until: number | null }>("SELECT failures, locked_until FROM login_attempts WHERE key = ?", key);

/** A user with a known password, made the way the app makes them. */
async function addUser(over: { status?: string; deleted?: boolean; tenantId?: string } = {}) {
  const email = uniqueEmail("person");
  const { hashPassword } = await import("../../src/server/lib/password");
  await h.sql(
    "INSERT INTO users (id,tenant_id,display_name,email,normalized_email,password_hash,access_id,status,is_deleted,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    `u-${email}`, over.tenantId ?? h.tenantId, "Pat", email, email, await hashPassword("Correct-horse-1"), "viewer", over.status ?? "Active", over.deleted ? 1 : 0, 1, 1,
  );
  return { email, id: `u-${email}` };
}

describe("signing in", () => {
  it("accepts the right email and password, sets a session cookie, and says where to go", async () => {
    const r = await login(EMAIL, PASSWORD);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ redirectTo: "/", mustChangePassword: false });
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^sendrix_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i); // http://localhost
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(r.json)).not.toMatch(/pbkdf2|hash/i);
  });

  it("reports an account flagged must-change-password, so the app can act on it", async () => {
    await h.sql("UPDATE users SET must_change_password = 1 WHERE id = ?", h.userId);
    expect((await login(EMAIL, PASSWORD)).json.mustChangePassword).toBe(true);
    await h.sql("UPDATE users SET must_change_password = 0 WHERE id = ?", h.userId);
  });

  it("the session works, as that user, and only a hash of it is stored", async () => {
    const r = await login(EMAIL, PASSWORD);
    const session = cookieOf(r);
    const me = await h.anonymous.api("GET", "/api/me", undefined, asSession(session));
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ user: { email: EMAIL, access: "Administrator" }, tenant: { name: "Sabertooth Software Labs" }, session: true });
    expect(JSON.stringify(await h.rows("SELECT * FROM sessions"))).not.toContain(session);
    expect((await h.rows<{ n: number }>("SELECT count(*) AS n FROM sessions WHERE token_hash = ?", await sha256Base64Url(session)))[0]!.n).toBe(1);
  });

  it("records the time of the sign-in", async () => {
    const u = await addUser();
    expect((await h.rows<{ last_login_at: number | null }>("SELECT last_login_at FROM users WHERE id = ?", u.id))[0]!.last_login_at).toBeNull();
    expect((await login(u.email, "Correct-horse-1")).status).toBe(200);
    expect((await h.rows<{ last_login_at: number }>("SELECT last_login_at FROM users WHERE id = ?", u.id))[0]!.last_login_at).toBeGreaterThan(Date.now() - 60_000);
  });

  it("ignores letter case and spaces around the email", async () => {
    expect((await login("  Admin@SabertoothSoftwareLabs.NET ", PASSWORD)).status).toBe(200);
  });

  it("is case-sensitive about the password", async () => {
    expect((await login(EMAIL, PASSWORD.toLowerCase())).status).toBe(401);
  });

  it("each sign-in is its own session, and signing out ends only that one", async () => {
    const a = cookieOf(await login(EMAIL, PASSWORD));
    const b = cookieOf(await login(EMAIL, PASSWORD));
    expect(a).not.toBe(b);
    await h.anonymous.api("POST", "/api/auth/logout", undefined, asSession(a));
    expect((await h.anonymous.api("GET", "/api/me", undefined, asSession(a))).status).toBe(401);
    expect((await h.anonymous.api("GET", "/api/me", undefined, asSession(b))).status).toBe(200);
  });

  it("a user who accepted an invitation can sign in later with the password they chose", async () => {
    const u = await addUser();
    const r = await login(u.email, "Correct-horse-1");
    expect(r.status).toBe(200);
    expect(r.json.mustChangePassword).toBe(false);
  });

  it("without a session, protected routes answer 401, not another user's data", async () => {
    for (const path of ["/api/me", "/api/contacts", "/api/campaigns", "/api/users", "/api/sender"]) {
      const r = await h.anonymous.api("GET", path);
      expect(r.status, path).toBe(401);
      expect(r.json.error.code).toBe("NO_ACTIVE_USER");
    }
  });
});

describe("wrong answers all look the same", () => {
  it("unknown address, wrong password, and a removed user get the identical response", async () => {
    const removed = await addUser({ deleted: true });
    const seen = new Set<string>();
    for (const [email, password] of [["nobody@example.test", "whatever-1"], [EMAIL, "wrong-password"], [removed.email, "Correct-horse-1"]] as const) {
      const r = await login(email, password);
      expect(r.status).toBe(401);
      expect(r.headers.get("set-cookie")).toBeNull();
      seen.add(JSON.stringify({ ...r.json, error: { ...r.json.error, correlationId: "" } }));
    }
    expect(seen.size).toBe(1);
    expect([...seen][0]).toContain("Incorrect email or password");
  });

  it("an unknown address takes about as long as a wrong password (both do the full password work)", async () => {
    await login(EMAIL, "warm-up-1");
    const time = async (email: string) => { const t = performance.now(); await login(email, "wrong-password-1"); return performance.now() - t; };
    const known = Math.min(await time(EMAIL), await time(EMAIL));
    const unknown = Math.min(await time("nobody1@example.test"), await time("nobody2@example.test"));
    expect(unknown).toBeGreaterThan(known * 0.5); // not an instant "no such user"
  });

  it("rejects malformed bodies without counting them as password failures", async () => {
    for (const body of [{}, { email: EMAIL }, { password: "x" }, { email: "", password: "x" }, { email: EMAIL, password: "" }, { email: EMAIL, password: "x", extra: 1 }, { email: EMAIL, password: "x".repeat(300) }]) {
      expect((await h.anonymous.api("POST", "/api/auth/login", body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect((await h.anonymous.api("POST", "/api/auth/login", "{nope")).status).toBe(400);
    expect(await attempts(`email:${EMAIL}`)).toHaveLength(0);
  });

  it("a disabled account is told so only once the password was right", async () => {
    const u = await addUser({ status: "Disabled" });
    expect((await login(u.email, "wrong-password")).json.error.code).toBe("INVALID_CREDENTIALS");
    const r = await login(u.email, "Correct-horse-1");
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("USER_DISABLED");
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("a suspended organization cannot sign in", async () => {
    const t = await h.addTenant("Frozen Inc", "boss@frozen.test");
    await h.sql("UPDATE tenants SET status = 'Suspended' WHERE id = ?", t.tenantId);
    const r = await login("boss@frozen.test", "Password@123");
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("TENANT_SUSPENDED");
  });

  it("another tenant's user signs in to their own tenant, never ours", async () => {
    await h.addTenant("Globex Corp", "admin@globex.test");
    const r = await login("admin@globex.test", "Password@123");
    const me = await h.anonymous.api("GET", "/api/me", undefined, asSession(cookieOf(r)));
    expect(me.json.tenant.name).toBe("Globex Corp");
    expect((await h.anonymous.api("GET", "/api/contacts", undefined, asSession(cookieOf(r)))).json.total).toBe(0);
  });
});

describe("throttling", () => {
  const fail = (email: string, headers?: Record<string, string>) => login(email, "wrong-password-1", headers);

  it(`locks an address after ${LOGIN_MAX_FAILURES} failures, even for the right password, with Retry-After`, async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await fail(EMAIL)).status).toBe(401);
    const locked = await login(EMAIL, PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.json.error.code).toBe("TOO_MANY_ATTEMPTS");
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(LOGIN_LOCK_MS / 1000 - 5);
    expect(locked.headers.get("set-cookie")).toBeNull();
    expect((await login(EMAIL, "wrong-password-1")).status).toBe(429); // and a wrong one is not even checked
  });

  it("the attempts before the limit still work normally, and a good sign-in clears the count", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) await fail(EMAIL);
    expect((await attempts(`email:${EMAIL}`))[0]!.failures).toBe(LOGIN_MAX_FAILURES - 1);
    expect((await login(EMAIL, PASSWORD)).status).toBe(200);
    expect(await attempts(`email:${EMAIL}`)).toHaveLength(0);
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) expect((await fail(EMAIL)).status).toBe(401); // a fresh allowance
  });

  it("locks unknown addresses the same way, so throttling does not reveal which addresses have accounts", async () => {
    const ghost = "ghost@example.test";
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await fail(ghost);
    expect((await fail(ghost)).status).toBe(429);
  });

  it("one person's lock does not lock anyone else", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await fail(EMAIL);
    const other = await addUser();
    expect((await login(other.email, "Correct-horse-1")).status).toBe(200);
  });

  it("the lock ends, and the count restarts after the window", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await fail(EMAIL);
    expect((await login(EMAIL, PASSWORD)).status).toBe(429);
    await h.sql("UPDATE login_attempts SET locked_until = ? WHERE key = ?", Date.now() - 1, `email:${EMAIL}`);
    expect((await login(EMAIL, PASSWORD)).status).toBe(200);

    await fail(EMAIL);
    await h.sql("UPDATE login_attempts SET window_start = ? WHERE key = ?", Date.now() - LOGIN_WINDOW_MS - 1000, `email:${EMAIL}`);
    await fail(EMAIL);
    expect((await attempts(`email:${EMAIL}`))[0]!.failures).toBe(1); // the old failure aged out
  });

  it("an expired lock does not leave the next failure one short of locking again", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await fail(EMAIL);
    await h.sql("UPDATE login_attempts SET locked_until = ? WHERE key = ?", Date.now() - 1, `email:${EMAIL}`);
    await fail(EMAIL);
    const [row] = await attempts(`email:${EMAIL}`);
    expect(row).toMatchObject({ failures: 1, locked_until: null });
  });

  it("also counts failures per network address across different accounts", async () => {
    const ip = { "cf-connecting-ip": "203.0.113.9" };
    for (let i = 0; i < LOGIN_IP_MAX_FAILURES; i++) await fail(`spray${i}@example.test`, ip);
    const r = await login(EMAIL, PASSWORD, ip); // a real user, right password, from the sprayed address
    expect(r.status).toBe(429);
    expect((await login(EMAIL, PASSWORD, { "cf-connecting-ip": "203.0.113.10" })).status).toBe(200); // another address is fine
  });

  it("simultaneous wrong guesses are all counted, so parallelism does not buy extra tries", async () => {
    await Promise.all(Array.from({ length: LOGIN_MAX_FAILURES + 3 }, () => fail(EMAIL)));
    expect((await attempts(`email:${EMAIL}`))[0]!.locked_until).not.toBeNull();
    expect((await login(EMAIL, PASSWORD)).status).toBe(429);
  });

  it("stores no password and nothing secret in the attempts table", async () => {
    await fail(EMAIL);
    const dump = JSON.stringify(await h.rows("SELECT * FROM login_attempts"));
    expect(dump).not.toContain("wrong-password-1");
    expect(dump).not.toContain(PASSWORD);
  });
});

describe("where signing in is allowed", () => {
  it("fails closed outside the local environment", async () => {
    const r = await h.withEnv({ ENVIRONMENT: "production" }).api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
    expect(r.status).toBe(503);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a cross-site sign-in attempt", async () => {
    const r = await login(EMAIL, PASSWORD, { origin: "https://evil.test" });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("BAD_ORIGIN");
  });

  it("the local shortcut user exists only when asked for", async () => {
    expect((await h.anonymous.api("GET", "/api/me")).status).toBe(401);
    expect((await h.as(EMAIL).api("GET", "/api/me")).status).toBe(200); // DEV_ACTOR_EMAIL set explicitly
  });
});

describe("staying signed in (30 days that restart on use)", () => {
  const DAY = 86_400_000;
  const expiryOf = async (session: string) => (await h.rows<{ expires_at: number }>("SELECT expires_at FROM sessions WHERE token_hash = ?", await sha256Base64Url(session)))[0]!.expires_at;
  const setExpiry = async (session: string, at: number) => h.sql("UPDATE sessions SET expires_at = ? WHERE token_hash = ?", at, await sha256Base64Url(session));
  const maxAge = (r: { headers: Headers }) => Number(/Max-Age=(\d+)/i.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? 0);
  const newSession = async () => cookieOf(await login(EMAIL, PASSWORD));

  it("a new sign-in lasts 30 days, in the cookie and in the database, and survives closing the browser", async () => {
    const r = await login(EMAIL, PASSWORD);
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/Expires=/i); // a persistent cookie, not a session-only one that dies with the browser
    expect(maxAge(r)).toBeGreaterThan(29.99 * 86400);
    expect(maxAge(r)).toBeLessThanOrEqual(30 * 86400);
    const days = ((await expiryOf(cookieOf(r))) - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.99);
    expect(days).toBeLessThanOrEqual(30);
  });

  it("opening the app later restarts the 30 days and re-issues the cookie with the new date", async () => {
    const s = await newSession();
    await setExpiry(s, Date.now() + 5 * DAY); // used 25 days ago
    const r = await h.anonymous.api("GET", "/api/me", undefined, asSession(s));
    expect(r.status).toBe(200);
    expect(((await expiryOf(s)) - Date.now()) / DAY).toBeGreaterThan(29.99);
    expect(maxAge(r)).toBeGreaterThan(29.99 * 86400);
    expect(r.headers.get("set-cookie")).toContain(`sendrix_session=${s}`); // same secret, new date
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/i);
  });

  it("any protected request counts as using the app, not only /api/me", async () => {
    const s = await newSession();
    await setExpiry(s, Date.now() + 2 * DAY);
    expect((await h.anonymous.api("GET", "/api/contacts", undefined, asSession(s))).status).toBe(200);
    expect(((await expiryOf(s)) - Date.now()) / DAY).toBeGreaterThan(29.99);
  });

  it("does not write on every request: a session renewed within the hour is left alone", async () => {
    const s = await newSession();
    const before = await expiryOf(s);
    const r = await h.anonymous.api("GET", "/api/me", undefined, asSession(s));
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(await expiryOf(s)).toBe(before);
  });

  it("renews once the last renewal is over an hour old", async () => {
    const s = await newSession();
    await setExpiry(s, Date.now() + 30 * DAY - 2 * 3_600_000);
    const r = await h.anonymous.api("GET", "/api/me", undefined, asSession(s));
    expect(r.headers.get("set-cookie")).toContain("sendrix_session=");
    expect(((await expiryOf(s)) - Date.now()) / DAY).toBeGreaterThan(29.99);
  });

  it("a session not used for 30 days has expired: it is refused, never revived by the request", async () => {
    const s = await newSession();
    const past = Date.now() - 1000;
    await setExpiry(s, past);
    const r = await h.anonymous.api("GET", "/api/me", undefined, asSession(s));
    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(await expiryOf(s)).toBe(past);
    expect((await h.anonymous.api("GET", "/api/contacts", undefined, asSession(s))).status).toBe(401);
  });

  it("someone who comes back every few weeks never has to sign in again", async () => {
    const s = await newSession();
    for (let visit = 0; visit < 4; visit++) {
      await setExpiry(s, Date.now() + 2 * DAY); // 28 idle days later
      expect((await h.anonymous.api("GET", "/api/me", undefined, asSession(s))).status, `visit ${visit}`).toBe(200);
    }
  });

  it("a disabled user's session is refused and not extended", async () => {
    const u = await addUser();
    const s = cookieOf(await login(u.email, "Correct-horse-1"));
    await setExpiry(s, Date.now() + 5 * DAY);
    const stale = await expiryOf(s);
    await h.sql("UPDATE users SET status = 'Disabled' WHERE id = ?", u.id);
    expect((await h.anonymous.api("GET", "/api/me", undefined, asSession(s))).status).toBe(403);
    expect(await expiryOf(s)).toBe(stale);
  });

  it("renewal never shortens a session and one session's use does not extend another's", async () => {
    const a = await newSession();
    const b = await newSession();
    await setExpiry(b, Date.now() + 3 * DAY);
    await h.anonymous.api("GET", "/api/me", undefined, asSession(a));
    expect(((await expiryOf(b)) - Date.now()) / DAY).toBeLessThan(3.01);
    const { SESSION_TTL_MS } = await import("../../src/server/lib/session");
    expect(SESSION_TTL_MS).toBe(30 * DAY);
  });

  it("the renewal itself refuses to revive an expired session or to shorten a live one (guards against racing requests)", async () => {
    const { sessionsRepo } = await import("../../src/server/database/repositories/sessions");
    const { createDb } = await import("../../src/server/database/client");
    const repo = sessionsRepo(createDb(h.env.DB));
    const idOf = async (s: string) => (await h.rows<{ id: string }>("SELECT id FROM sessions WHERE token_hash = ?", await sha256Base64Url(s)))[0]!.id;

    const dead = await newSession();
    await setExpiry(dead, Date.now() - 1000);
    expect(await repo.renew(await idOf(dead), Date.now() + 30 * DAY)).toBe(false);
    expect(await expiryOf(dead)).toBeLessThan(Date.now());

    const live = await newSession();
    const before = await expiryOf(live);
    expect(await repo.renew(await idOf(live), before - DAY)).toBe(false); // would shorten it
    expect(await expiryOf(live)).toBe(before);
    expect(await repo.renew(await idOf(live), before + DAY)).toBe(true);
  });

  it("signing out still ends the session for good", async () => {
    const s = await newSession();
    await h.anonymous.api("POST", "/api/auth/logout", undefined, asSession(s));
    expect((await h.anonymous.api("GET", "/api/me", undefined, asSession(s))).status).toBe(401);
  });
});
