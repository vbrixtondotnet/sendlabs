import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Base64Url } from "../../src/server/lib/crypto";
import { hashPassword } from "../../src/server/lib/password";
import { LOGIN_MAX_FAILURES } from "../../src/server/services/auth";
import { startHarness, uniqueEmail, type Harness } from "./harness";

let h: Harness;
const PASSWORD = "Correct-horse-1";

beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.dispose(); });
beforeEach(async () => { await h.sql("DELETE FROM login_attempts"); });

const cookieOf = (r: { headers: Headers }) => /sendrix_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? "";
const asSession = (s: string) => ({ cookie: `sendrix_session=${s}` });

/** A user with a known password who is signed in (twice, to have two sessions). */
async function person(over: { tenantId?: string; first?: string; last?: string } = {}) {
  const email = uniqueEmail("person");
  const id = `u-${email}`;
  await h.sql(
    "INSERT INTO users (id,tenant_id,first_name,last_name,display_name,email,normalized_email,password_hash,must_change_password,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, over.tenantId ?? h.tenantId, over.first ?? "Pat", over.last ?? "Lee", `${over.first ?? "Pat"} ${over.last ?? "Lee"}`, email, email, await hashPassword(PASSWORD), 1, "viewer", "Active", 1, 1,
  );
  const signIn = async (password = PASSWORD) => cookieOf(await h.anonymous.api("POST", "/api/auth/login", { email, password }));
  return { email, id, signIn, first: await signIn(), second: await signIn() };
}
const me = (session: string) => h.anonymous.api("GET", "/api/me", undefined, asSession(session));
const hashOf = async (id: string) => (await h.rows<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", id))[0]!.password_hash;
const sessionCount = async (id: string) => (await h.rows<{ n: number }>("SELECT count(*) AS n FROM sessions WHERE user_id = ?", id))[0]!.n;

describe("GET /api/me", () => {
  it("includes the first and last name, so the profile form can show them", async () => {
    const p = await person({ first: "Ada", last: "Lovelace" });
    expect((await me(p.first)).json.user).toMatchObject({ email: p.email, firstName: "Ada", lastName: "Lovelace", displayName: "Ada Lovelace" });
  });
});

describe("updating your profile", () => {
  const patch = (session: string, body: unknown) => h.anonymous.api("PATCH", "/api/me", body, asSession(session));

  it("changes first and last name, and the name shown around the app follows", async () => {
    const p = await person();
    const r = await patch(p.first, { firstName: "Grace", lastName: "Hopper" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ firstName: "Grace", lastName: "Hopper", displayName: "Grace Hopper" });
    expect((await me(p.second)).json.user).toMatchObject({ firstName: "Grace", lastName: "Hopper", displayName: "Grace Hopper" });
    expect((await h.rows<{ first_name: string; display_name: string }>("SELECT first_name, display_name FROM users WHERE id = ?", p.id))[0]).toEqual({ first_name: "Grace", display_name: "Grace Hopper" });
  });

  it("trims and tidies the names, and strips control characters", async () => {
    const p = await person();
    const r = await patch(p.first, { firstName: "  Grace\r\n  Murray ", lastName: "\tHopper  " });
    expect(r.json).toMatchObject({ firstName: "Grace Murray", lastName: "Hopper", displayName: "Grace Murray Hopper" });
  });

  it("requires both names, within a sane length, and refuses anything else", async () => {
    const p = await person();
    for (const body of [{ firstName: "", lastName: "X" }, { firstName: "X", lastName: "  " }, { firstName: "X" }, { lastName: "X" }, { firstName: "x".repeat(200), lastName: "X" }, { firstName: "X", lastName: "Y", email: "evil@x.test" }, { firstName: "X", lastName: "Y", accessId: "administrator" }, { firstName: "X", lastName: "Y", tenantId: "t" }, {}]) {
      expect((await patch(p.first, body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect((await h.anonymous.api("PATCH", "/api/me", "{nope", asSession(p.first))).status).toBe(400);
    expect((await me(p.first)).json.user).toMatchObject({ firstName: "Pat", lastName: "Lee" }); // nothing changed
  });

  it("never changes email, role or tenant, whatever is sent", async () => {
    const p = await person();
    await patch(p.first, { firstName: "A", lastName: "B", email: "evil@x.test", accessId: "administrator", tenantId: "other" });
    const [row] = await h.rows<{ email: string; access_id: string; tenant_id: string }>("SELECT email, access_id, tenant_id FROM users WHERE id = ?", p.id);
    expect(row).toEqual({ email: p.email, access_id: "viewer", tenant_id: h.tenantId });
  });

  it("only ever edits the signed-in user, never anyone else", async () => {
    const a = await person({ first: "Alice", last: "A" });
    const b = await person({ first: "Bob", last: "B" });
    await patch(a.first, { firstName: "Changed", lastName: "Name" });
    expect((await me(b.first)).json.user).toMatchObject({ firstName: "Bob", lastName: "B" });
    const t = await h.addTenant("Globex Corp", "admin@globex.test");
    expect((await h.rows<{ first_name: string }>("SELECT first_name FROM users WHERE id = ?", t.userId))[0]!.first_name).not.toBe("Changed");
  });

  it("needs a session", async () => {
    expect((await h.anonymous.api("PATCH", "/api/me", { firstName: "A", lastName: "B" })).status).toBe(401);
  });

  it("refuses a cross-site request", async () => {
    const p = await person();
    expect((await h.anonymous.api("PATCH", "/api/me", { firstName: "A", lastName: "B" }, { ...asSession(p.first), origin: "https://evil.test" })).status).toBe(403);
  });
});

describe("changing your password", () => {
  const change = (session: string, body: unknown, headers: Record<string, string> = {}) => h.anonymous.api("POST", "/api/me/password", body, { ...asSession(session), ...headers });
  const NEW = "A-brand-new-pass-9";

  it("changes it: the new password signs in, the old one no longer does", async () => {
    const p = await person();
    expect((await change(p.first, { currentPassword: PASSWORD, newPassword: NEW })).status).toBe(204);
    expect((await h.anonymous.api("POST", "/api/auth/login", { email: p.email, password: NEW })).status).toBe(200);
    expect((await h.anonymous.api("POST", "/api/auth/login", { email: p.email, password: PASSWORD })).status).toBe(401);
  });

  it("stores only a hash of the new password", async () => {
    const p = await person();
    const before = await hashOf(p.id);
    await change(p.first, { currentPassword: PASSWORD, newPassword: NEW });
    const after = await hashOf(p.id);
    expect(after).not.toBe(before);
    expect(after).toMatch(/^pbkdf2-sha256\$/);
    expect(JSON.stringify(await h.rows("SELECT * FROM users WHERE id = ?", p.id))).not.toContain(NEW);
  });

  it("keeps you signed in on this device and signs every other session out", async () => {
    const p = await person();
    expect(await sessionCount(p.id)).toBe(2);
    await change(p.first, { currentPassword: PASSWORD, newPassword: NEW });
    expect((await me(p.first)).json.session).toBe(true);
    expect((await me(p.second)).status).toBe(401);
    expect(await sessionCount(p.id)).toBe(1);
  });

  it("does not touch other people's sessions", async () => {
    const a = await person();
    const b = await person();
    await change(a.first, { currentPassword: PASSWORD, newPassword: NEW });
    expect((await me(b.first)).status).toBe(200);
    expect((await me(b.second)).status).toBe(200);
  });

  it("clears the must-change-password flag", async () => {
    const p = await person();
    expect((await me(p.first)).json.user.mustChangePassword).toBe(true);
    await change(p.first, { currentPassword: PASSWORD, newPassword: NEW });
    expect((await me(p.first)).json.user.mustChangePassword).toBe(false);
  });

  it("refuses a wrong current password, and changes nothing", async () => {
    const p = await person();
    const before = await hashOf(p.id);
    const r = await change(p.first, { currentPassword: "not-my-password", newPassword: NEW });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("INVALID_CURRENT_PASSWORD");
    expect(r.json.error.details).toEqual([{ path: "currentPassword", message: "Your current password is not correct" }]);
    expect(await hashOf(p.id)).toBe(before);
    expect(await sessionCount(p.id)).toBe(2);
  });

  it("holds a new password to the same rules as everywhere else, without counting it as a wrong guess", async () => {
    const p = await person();
    for (const newPassword of ["short", "x".repeat(300)]) {
      const r = await change(p.first, { currentPassword: PASSWORD, newPassword });
      expect(r.status, newPassword.slice(0, 8)).toBe(400);
      expect(r.json.error.details[0].path).toBe("newPassword");
    }
    const same = await change(p.first, { currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(400);
    expect(same.json.error.details[0]).toMatchObject({ path: "newPassword" });
    expect(await h.rows("SELECT key FROM login_attempts WHERE key = ?", `password:${p.id}`)).toHaveLength(0);
  });

  it("refuses unknown fields and missing ones", async () => {
    const p = await person();
    for (const body of [{}, { currentPassword: PASSWORD }, { newPassword: NEW }, { currentPassword: PASSWORD, newPassword: NEW, userId: "x" }, { currentPassword: "", newPassword: NEW }]) {
      expect((await change(p.first, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it(`locks after ${LOGIN_MAX_FAILURES} wrong current passwords, even for the right one, and does not lock sign-in`, async () => {
    const p = await person();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await change(p.first, { currentPassword: `wrong-guess-${i}`, newPassword: NEW })).status).toBe(400);
    const locked = await change(p.first, { currentPassword: PASSWORD, newPassword: NEW });
    expect(locked.status).toBe(429);
    expect(locked.json.error.code).toBe("TOO_MANY_ATTEMPTS");
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await hashOf(p.id)).toMatch(/^pbkdf2/);
    expect((await h.anonymous.api("POST", "/api/auth/login", { email: p.email, password: PASSWORD })).status).toBe(200); // signing in is a separate counter
  });

  it("a correct change clears the count", async () => {
    const p = await person();
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) await change(p.first, { currentPassword: `wrong-${i}`, newPassword: NEW });
    expect((await change(p.first, { currentPassword: PASSWORD, newPassword: NEW })).status).toBe(204);
    expect(await h.rows("SELECT key FROM login_attempts WHERE key = ?", `password:${p.id}`)).toHaveLength(0);
  });

  it("needs a session, and refuses a cross-site request", async () => {
    expect((await h.anonymous.api("POST", "/api/me/password", { currentPassword: PASSWORD, newPassword: NEW })).status).toBe(401);
    const p = await person();
    expect((await change(p.first, { currentPassword: PASSWORD, newPassword: NEW }, { origin: "https://evil.test" })).status).toBe(403);
    expect(await sessionCount(p.id)).toBe(2);
  });

  it("only ever changes the signed-in user's own password", async () => {
    const a = await person();
    const b = await person();
    const bBefore = await hashOf(b.id);
    await change(a.first, { currentPassword: PASSWORD, newPassword: NEW });
    expect(await hashOf(b.id)).toBe(bBefore);
  });

  it("the session's stored token is unaffected (still only a hash, still the same row)", async () => {
    const p = await person();
    await change(p.first, { currentPassword: PASSWORD, newPassword: NEW });
    expect((await h.rows<{ n: number }>("SELECT count(*) AS n FROM sessions WHERE token_hash = ?", await sha256Base64Url(p.first)))[0]!.n).toBe(1);
  });
});
