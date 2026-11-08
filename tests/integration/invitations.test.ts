import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Base64Url } from "../../src/server/lib/crypto";
import { MAX_OPEN_INVITATIONS, RESEND_COOLDOWN_MS } from "../../src/server/services/invitations";
import { GoogleOAuth } from "../../src/server/services/google-oauth";
import { FakeGoogle } from "./fake-google";
import { startHarness, uniqueEmail, type Caller, type Harness } from "./harness";

const google = new FakeGoogle();
let h: Harness;
const GLOBEX = "admin@globex.test";
const SENDER = "sales@sabertooth.test";
const PASSWORD = "Str0ng!Passw0rd";
const TOKEN_IN_LINK = /\/invite\/([A-Za-z0-9_-]{43})/;

beforeAll(async () => {
  h = await startHarness({ google: new GoogleOAuth(google.fetch) });
  await h.addTenant("Globex Corp", GLOBEX);
});
afterAll(async () => { await h.dispose(); });
beforeEach(() => { google.sendFailure = null; google.refreshFails = false; google.mailbox.length = 0; });

/** Connects Gmail for a tenant through the real flow. */
async function connectGmail(who: Caller, email: string) {
  const start = await who.api("POST", "/api/sender/gmail/connect");
  const back = await who.text(google.consent(start.json.url, { email }));
  expect(back.status).toBe(302);
}

const body = (over: Record<string, unknown> = {}) => ({ email: uniqueEmail("invitee"), firstName: "Ada", lastName: "Lovelace", accessId: "campaign-manager", ...over });
const invite = (over: Record<string, unknown> = {}, who: Caller = h) => who.api("POST", "/api/users/invitations", body(over));

/** The decoded text and HTML parts of the last message Gmail was asked to send. */
function lastMail() {
  const raw = google.mailbox.at(-1)!.raw;
  const parts = raw
    .split(/--=_sendlab_[0-9a-f]+/)
    .slice(1)
    .filter((p) => p.trim() && p.trim() !== "--")
    .map((p) => Buffer.from(p.split("\r\n\r\n").slice(1).join("").replace(/\s+/g, ""), "base64").toString("utf8"));
  return { raw, head: raw.split("\r\n\r\n")[0]!, text: parts[0] ?? "", html: parts[1] ?? "" };
}
function tokenFromMail(): string {
  const m = TOKEN_IN_LINK.exec(lastMail().text);
  expect(m, "no invitation link in the email").toBeTruthy();
  return m![1]!;
}

const expireCooldown = (email: string) => h.sql("UPDATE invitations SET created_at = created_at - ? WHERE normalized_email = ?", RESEND_COOLDOWN_MS + 1000, email.toLowerCase());
const cookieOf = (r: { headers: Headers }) => /sendlab_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? "";
const asSession = (s: string) => ({ cookie: `sendlab_session=${s}` });
const ids = (r: { json: { items: { id: string }[] } }) => r.json.items.map((i) => i.id);

describe("who can invite", () => {
  it("needs a connected Gmail account, and says so", async () => {
    const r = await invite();
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("SENDER_REQUIRED");
    expect(google.mailbox).toHaveLength(0);
    expect(await h.rows("SELECT id FROM invitations")).toHaveLength(0);
  });

  it("is for Administrators only", async () => {
    await connectGmail(h, SENDER);
    const email = uniqueEmail("viewer");
    await h.sql("INSERT INTO users (id,tenant_id,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", "v1", h.tenantId, "V", email, email, "x", "viewer", "Active", 1, 1);
    expect((await invite({}, h.as(email))).status).toBe(403);
    expect((await h.as(email).api("GET", "/api/users/invitations")).status).toBe(403);
  });
});

describe("inviting", () => {
  it("emails the invitee through the tenant's Gmail and lists the invitation", async () => {
    const r = await h.api("POST", "/api/users/invitations", body({ email: "Pat.Smith@Example.test", firstName: "Pat", lastName: "Smith", accessId: "viewer" }));
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ email: "Pat.Smith@Example.test", firstName: "Pat", lastName: "Smith", access: "Viewer", accessId: "viewer", status: "Pending", invitedBy: h.adminEmail });
    expect(Object.keys(r.json).sort()).toEqual(["access", "accessId", "createdAt", "email", "expiresAt", "firstName", "id", "invitedBy", "lastName", "status"]);

    expect(google.mailbox).toHaveLength(1);
    expect(google.mailbox[0]!.from).toBe(SENDER);
    const { head } = lastMail();
    expect(head).toContain("To: Pat.Smith@Example.test");
    expect(head).toContain("Subject: Sabertooth Software Labs has invited you to SendLab");
    expect(ids(await h.api("GET", "/api/users/invitations"))).toContain(r.json.id);
  });

  it("shows the sender as SendLab, still sent from the tenant's own mailbox", async () => {
    await invite();
    expect(lastMail().head).toContain(`From: "SendLab" <${SENDER}>`);
    expect(google.mailbox.at(-1)!.from).toBe(SENDER);
  });

  it("says who invited them, with an Accept invitation button and the plain link", async () => {
    await invite({ firstName: "Grace" });
    const { text, html } = lastMail();
    expect(text).toContain("Hi Grace,");
    expect(text).toContain("Sabertooth Software Labs has invited you to SendLab.");
    expect(text).toMatch(/http:\/\/localhost:5173\/invite\/[A-Za-z0-9_-]{43}/);
    expect(html).toContain(">Accept invitation</a>");
    expect(html).toMatch(/href="http:\/\/localhost:5173\/invite\/[A-Za-z0-9_-]{43}"/);
  });

  it("never stores the secret: only its hash is in the database", async () => {
    await invite();
    const token = tokenFromMail();
    const dump = JSON.stringify(await h.rows("SELECT * FROM invitations"));
    expect(dump).not.toContain(token);
    expect(dump).toContain(await sha256Base64Url(token));
  });

  it("expires after 7 days", async () => {
    const r = await invite();
    const days = (new Date(r.json.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });

  it("rejects bad input and unknown fields, sending nothing", async () => {
    const bad = [
      body({ email: "not-an-email" }), body({ email: "" }), body({ firstName: "" }), body({ lastName: "   " }),
      body({ accessId: "owner" }), body({ accessId: "Administrator" }), body({ extra: 1 }), body({ firstName: "x".repeat(200) }),
    ];
    for (const b of bad) expect((await h.api("POST", "/api/users/invitations", b)).status, JSON.stringify(b)).toBe(400);
    expect((await h.api("POST", "/api/users/invitations", "{nope")).status).toBe(400);
    expect(google.mailbox).toHaveLength(0);
  });

  it("can invite an Administrator, a Campaign Manager and a Viewer", async () => {
    for (const [accessId, access] of [["administrator", "Administrator"], ["campaign-manager", "Campaign Manager"], ["viewer", "Viewer"]] as const) {
      const r = await invite({ accessId });
      expect(r.status).toBe(201);
      expect(r.json.access).toBe(access);
    }
  });

  it("refuses someone who is already a user here, and does not reveal users of other tenants", async () => {
    const here = await invite({ email: h.adminEmail });
    expect(here.status).toBe(409);
    expect(here.json.error.code).toBe("ALREADY_MEMBER");
    const there = await invite({ email: GLOBEX });
    expect(there.status).toBe(409);
    expect(there.json.error.code).toBe("CANNOT_INVITE");
    expect(JSON.stringify(there.json)).not.toMatch(/globex/i);
    expect(google.mailbox).toHaveLength(0);
  });

  it("keeps a header-injection attempt in a name out of the headers", async () => {
    await invite({ firstName: "Eve\r\nBcc: attacker@evil.test", lastName: "X" });
    expect(lastMail().head.toLowerCase()).not.toContain("bcc:");
  });

  it("escapes markup in names in the HTML part", async () => {
    await invite({ firstName: "<script>alert(1)</script>" });
    const { html } = lastMail();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("a person cannot be mailed twice within a minute", async () => {
    const email = uniqueEmail("twice");
    expect((await invite({ email })).status).toBe(201);
    const again = await invite({ email });
    expect(again.status).toBe(429);
    expect(again.json.error.code).toBe("INVITATION_TOO_SOON");
    expect(google.mailbox).toHaveLength(1);
  });

  it("caps the number of open invitations", async () => {
    const { tenantId, userId } = await h.addTenant("Capped Inc", "boss@capped.test");
    const who = h.as("boss@capped.test");
    await connectGmail(who, "mail@capped.test");
    for (let i = 0; i < MAX_OPEN_INVITATIONS; i++) {
      await h.sql(
        "INSERT INTO invitations (id,tenant_id,email,normalized_email,first_name,last_name,access_id,invited_by,token_hash,status,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        `cap-${i}`, tenantId, `c${i}@x.test`, `c${i}@x.test`, "A", "B", "viewer", userId, `hash-${i}`, "Pending", Date.now() + 1e9, 1, 1,
      );
    }
    const r = await invite({}, who);
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe("TOO_MANY_INVITATIONS");
  });
});

describe("when the email cannot be sent", () => {
  it("withdraws the invitation, so nothing is listed that nobody received", async () => {
    google.sendFailure = { status: 500 };
    const email = uniqueEmail("fail");
    const r = await invite({ email });
    expect(r.status).toBe(502);
    expect(r.json.error.code).toBe("INVITE_EMAIL_FAILED");
    const list = (await h.api("GET", "/api/users/invitations")).json.items;
    expect(list.map((i: { email: string }) => i.email)).not.toContain(email);
  });

  it("explains a Gmail rate limit", async () => {
    google.sendFailure = { status: 429 };
    const r = await invite();
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe("GMAIL_RATE_LIMITED");
  });

  it("asks for a reconnect when Google rejects the stored token, and flags the connection", async () => {
    google.refreshFails = true;
    const r = await invite();
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("SENDER_RECONNECT");
    expect((await h.api("GET", "/api/sender")).json.sender.status).toBe("NeedsReconnect");
    google.refreshFails = false;
    expect((await invite()).json.error.code).toBe("SENDER_RECONNECT"); // refused up front
    await connectGmail(h, SENDER); // reconnecting restores it
    expect((await invite()).status).toBe(201);
  });
});

describe("resend and revoke", () => {
  it("resending mails a fresh link and the old link stops working", async () => {
    const email = uniqueEmail("resend");
    const first = await invite({ email });
    const oldToken = tokenFromMail();
    await expireCooldown(email);
    const second = await h.api("POST", `/api/users/invitations/${first.json.id}/resend`);
    expect(second.status).toBe(201);
    const newToken = tokenFromMail();
    expect(newToken).not.toBe(oldToken);
    expect((await h.api("GET", `/api/invitations/${oldToken}`)).status).toBe(404);
    expect((await h.api("GET", `/api/invitations/${newToken}`)).status).toBe(200);
    const open = (await h.api("GET", "/api/users/invitations")).json.items.filter((i: { email: string }) => i.email === email);
    expect(open).toHaveLength(1);
  });

  it("resending is also held to the one-minute cooldown", async () => {
    const first = await invite();
    expect((await h.api("POST", `/api/users/invitations/${first.json.id}/resend`)).status).toBe(429);
  });

  it("revoking kills the link and removes it from the list", async () => {
    const r = await invite();
    const token = tokenFromMail();
    expect((await h.api("DELETE", `/api/users/invitations/${r.json.id}`)).status).toBe(204);
    expect((await h.api("GET", `/api/invitations/${token}`)).status).toBe(404);
    expect((await h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD })).status).toBe(404);
    expect(ids(await h.api("GET", "/api/users/invitations"))).not.toContain(r.json.id);
    expect((await h.api("DELETE", `/api/users/invitations/${r.json.id}`)).status).toBe(404);
  });

  it("another tenant cannot see, resend or revoke it", async () => {
    const r = await invite();
    const g = h.as(GLOBEX);
    expect(ids(await g.api("GET", "/api/users/invitations"))).not.toContain(r.json.id);
    expect((await g.api("DELETE", `/api/users/invitations/${r.json.id}`)).status).toBe(404);
    expect((await g.api("POST", `/api/users/invitations/${r.json.id}/resend`)).status).toBe(404);
    expect(ids(await h.api("GET", "/api/users/invitations"))).toContain(r.json.id);
  });

  it("an expired invitation is listed as Expired and can be resent", async () => {
    const r = await invite({ email: uniqueEmail("old") });
    await h.sql("UPDATE invitations SET expires_at = ?, created_at = created_at - ? WHERE id = ?", Date.now() - 1000, RESEND_COOLDOWN_MS + 1000, r.json.id);
    const row = (await h.api("GET", "/api/users/invitations")).json.items.find((i: { id: string }) => i.id === r.json.id);
    expect(row.status).toBe("Expired");
    expect((await h.api("POST", `/api/users/invitations/${r.json.id}/resend`)).status).toBe(201);
  });
});

describe("the invitation page (public)", () => {
  it("shows who invited them, without a sign-in", async () => {
    const r = await invite({ firstName: "Pat", lastName: "Lee", accessId: "viewer" });
    const token = tokenFromMail();
    const p = await h.withEnv({ DEV_ACTOR_EMAIL: "nobody@nowhere.test" }).api("GET", `/api/invitations/${token}`);
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ tenantName: "Sabertooth Software Labs", email: r.json.email, firstName: "Pat", lastName: "Lee", access: "Viewer" });
    expect(Object.keys(p.json).sort()).toEqual(["access", "email", "expiresAt", "firstName", "lastName", "tenantName"]);
  });

  it("gives every bad token the same 404", async () => {
    await invite();
    const real = tokenFromMail();
    const tampered = real.slice(0, -1) + (real.endsWith("A") ? "B" : "A");
    const answers = new Set<string>();
    for (const t of [tampered, "x".repeat(43), "short", "a".repeat(500)]) {
      const r = await h.api("GET", `/api/invitations/${encodeURIComponent(t)}`);
      answers.add(`${r.status},${r.json.error.code}`);
    }
    expect([...answers]).toEqual(["404,INVITATION_INVALID"]);
  });

  it("is invalid once expired or when the tenant is suspended", async () => {
    const r = await invite();
    const token = tokenFromMail();
    await h.sql("UPDATE invitations SET expires_at = ? WHERE id = ?", Date.now() - 1, r.json.id);
    expect((await h.api("GET", `/api/invitations/${token}`)).status).toBe(404);
    await h.sql("UPDATE invitations SET expires_at = ? WHERE id = ?", Date.now() + 1e9, r.json.id);
    await h.sql("UPDATE tenants SET status = 'Suspended' WHERE id = ?", h.tenantId);
    expect((await h.api("GET", `/api/invitations/${token}`)).status).toBe(404);
    expect((await h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD })).status).toBe(404);
    await h.sql("UPDATE tenants SET status = 'Active' WHERE id = ?", h.tenantId);
    expect((await h.api("GET", `/api/invitations/${token}`)).status).toBe(200);
  });
});

describe("accepting", () => {
  it("creates the user in the inviting tenant with the invited role, and signs them in", async () => {
    const email = uniqueEmail("new");
    await invite({ email, firstName: "Ada", lastName: "Lovelace", accessId: "campaign-manager" });
    const token = tokenFromMail();
    const r = await h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ redirectTo: "/" });

    const [u] = await h.rows<Record<string, unknown>>("SELECT * FROM users WHERE normalized_email = ?", email.toLowerCase());
    expect(u).toMatchObject({ tenant_id: h.tenantId, first_name: "Ada", last_name: "Lovelace", display_name: "Ada Lovelace", access_id: "campaign-manager", status: "Active", must_change_password: 0 });
    expect(String(u!.password_hash)).toMatch(/^pbkdf2-sha256\$/);
    expect(JSON.stringify(u)).not.toContain(PASSWORD);
    const [inv] = await h.rows<{ status: string; accepted_user_id: string }>("SELECT status, accepted_user_id FROM invitations WHERE normalized_email = ?", email.toLowerCase());
    expect(inv).toMatchObject({ status: "Accepted", accepted_user_id: u!.id });

    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^sendlab_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).not.toMatch(/Secure/i); // http://localhost
    expect(Number(/Max-Age=(\d+)/i.exec(cookie)![1])).toBeGreaterThan(13 * 86400);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const session = cookieOf(r);
    expect(JSON.stringify(await h.rows("SELECT * FROM sessions"))).not.toContain(session);

    // really signed in, as themselves (the cookie beats the local placeholder)
    const me = await h.api("GET", "/api/me", undefined, asSession(session));
    expect(me.json).toMatchObject({ user: { email, access: "Campaign Manager" }, tenant: { name: "Sabertooth Software Labs" }, session: true });
    expect(JSON.stringify(me.json)).not.toMatch(/pbkdf2|passwordHash|password_hash/i);
  });

  it("works exactly once", async () => {
    await invite();
    const token = tokenFromMail();
    expect((await h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD })).status).toBe(200);
    const again = await h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD });
    expect(again.status).toBe(404);
    expect(again.headers.get("set-cookie")).toBeNull();
    expect((await h.api("GET", `/api/invitations/${token}`)).status).toBe(404);
  });

  it("simultaneous clicks make one user and one session", async () => {
    const email = uniqueEmail("race");
    await invite({ email });
    const token = tokenFromMail();
    const rs = await Promise.all([1, 2, 3, 4].map(() => h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 404)).toHaveLength(3);
    const users = await h.rows<{ id: string }>("SELECT id FROM users WHERE normalized_email = ?", email.toLowerCase());
    expect(users).toHaveLength(1);
    expect(await h.rows("SELECT id FROM sessions WHERE user_id = ?", users[0]!.id)).toHaveLength(1);
  });

  it("a rejected password does not use the link up", async () => {
    await invite();
    const token = tokenFromMail();
    for (const password of ["short", "", "x".repeat(300)]) {
      const r = await h.api("POST", `/api/invitations/${token}/accept`, { password });
      expect(r.status, password.slice(0, 10)).toBe(400);
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    expect((await h.api("POST", `/api/invitations/${token}/accept`, {})).status).toBe(400);
    expect((await h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD, extra: 1 })).status).toBe(400);
    expect((await h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD })).status).toBe(200);
  });

  it("the tenant and role come from the invitation, never from the request", async () => {
    await invite({ accessId: "viewer" });
    const token = tokenFromMail();
    expect((await h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD, tenantId: "other", accessId: "administrator" })).status).toBe(400);
    const ok = await h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD });
    const me = await h.api("GET", "/api/me", undefined, asSession(cookieOf(ok)));
    expect(me.json.user.access).toBe("Viewer");
  });

  it("if the address got an account some other way, refuses cleanly and leaves the invitation alone", async () => {
    const email = uniqueEmail("taken");
    await invite({ email });
    const token = tokenFromMail();
    await h.sql("INSERT INTO users (id,tenant_id,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", `t-${email}`, h.tenantId, "T", email, email.toLowerCase(), "x", "viewer", "Active", 1, 1);
    const r = await h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("EMAIL_EXISTS");
    expect(await h.rows("SELECT id FROM sessions WHERE user_id = ?", `t-${email}`)).toHaveLength(0);
    expect((await h.rows<{ status: string }>("SELECT status FROM invitations WHERE normalized_email = ?", email.toLowerCase()))[0]!.status).toBe("Pending");
  });

  it("a new user can do what their role allows, and no more", async () => {
    await invite({ accessId: "viewer" });
    const ok = await h.api("POST", `/api/invitations/${tokenFromMail()}/accept`, { password: PASSWORD });
    const cookie = asSession(cookieOf(ok));
    expect((await h.api("GET", "/api/contacts", undefined, cookie)).status).toBe(200);
    expect((await h.api("GET", "/api/users", undefined, cookie)).status).toBe(403);
    expect((await h.api("POST", "/api/users/invitations", body(), cookie)).status).toBe(403);
  });
});

describe("sessions", () => {
  async function newSession() {
    await invite({ accessId: "viewer" });
    return cookieOf(await h.api("POST", `/api/invitations/${tokenFromMail()}/accept`, { password: PASSWORD }));
  }
  const who = (s: string) => h.api("GET", "/api/me", undefined, asSession(s));

  it("an unknown or garbled cookie is ignored, not trusted", async () => {
    const r = await who("A".repeat(43));
    expect(r.status).toBe(200);
    expect(r.json.session).toBe(false); // fell back to the local placeholder
  });

  it("an expired session stops working", async () => {
    const s = await newSession();
    expect((await who(s)).json.session).toBe(true);
    await h.sql("UPDATE sessions SET expires_at = ? WHERE token_hash = ?", Date.now() - 1, await sha256Base64Url(s));
    expect((await who(s)).json.session).toBe(false);
  });

  it("a disabled user, or a suspended tenant, is refused rather than silently downgraded", async () => {
    const s = await newSession();
    const [row] = await h.rows<{ user_id: string }>("SELECT user_id FROM sessions WHERE token_hash = ?", await sha256Base64Url(s));
    await h.sql("UPDATE users SET status = 'Disabled' WHERE id = ?", row!.user_id);
    const r = await who(s);
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("USER_DISABLED");
    await h.sql("UPDATE users SET status = 'Active' WHERE id = ?", row!.user_id);
    await h.sql("UPDATE tenants SET status = 'Suspended' WHERE id = ?", h.tenantId);
    expect((await who(s)).json.error.code).toBe("TENANT_SUSPENDED");
    await h.sql("UPDATE tenants SET status = 'Active' WHERE id = ?", h.tenantId);
  });

  it("outside the local environment nothing works, session or not", async () => {
    const s = await newSession();
    expect((await h.withEnv({ ENVIRONMENT: "production" }).api("GET", "/api/me", undefined, asSession(s))).status).toBe(503);
  });

  it("logging out ends the session and clears the cookie, and works even when not signed in", async () => {
    const s = await newSession();
    const out = await h.api("POST", "/api/auth/logout", undefined, asSession(s));
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(/sendlab_session=;/);
    expect((await who(s)).json.session).toBe(false);
    expect((await h.api("POST", "/api/auth/logout")).status).toBe(204);
  });
});

describe("cross-site writes are refused", () => {
  it("a POST naming another site as its origin gets 403 BAD_ORIGIN, and does nothing", async () => {
    const before = google.mailbox.length;
    const r = await h.api("POST", "/api/users/invitations", body(), { origin: "https://evil.test" });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("BAD_ORIGIN");
    expect(google.mailbox.length).toBe(before);
    expect((await h.api("POST", "/api/auth/logout", undefined, { origin: "https://evil.test" })).status).toBe(403);
  });

  it("the app's own origin, and tools that send no Origin, are fine; reads are never blocked", async () => {
    expect((await h.api("POST", "/api/users/invitations", body(), { origin: "http://localhost:5173" })).status).toBe(201);
    expect((await h.api("GET", "/api/users", undefined, { origin: "https://evil.test" })).status).toBe(200);
  });
});

describe("removing users (soft delete)", () => {
  /** Invites and accepts, so there is a real user with a real session. */
  async function newUser(accessId = "viewer", email = uniqueEmail("member")) {
    await invite({ email, accessId });
    const ok = await h.api("POST", `/api/invitations/${tokenFromMail()}/accept`, { password: PASSWORD });
    const [u] = await h.rows<{ id: string }>("SELECT id FROM users WHERE normalized_email = ?", email.toLowerCase());
    return { email, id: u!.id, session: cookieOf(ok) };
  }
  const listed = async () => (await h.api("GET", "/api/users?pageSize=100")).json;
  const emailsIn = (r: { items: { email: string }[] }) => r.items.map((u) => u.email);
  const userRow = async (id: string) => (await h.rows<{ is_deleted: number; deleted_at: number | null; status: string }>("SELECT is_deleted, deleted_at, status FROM users WHERE id = ?", id))[0]!;
  const idOf = async (email: string) => (await h.rows<{ id: string }>("SELECT id FROM users WHERE normalized_email = ?", email.toLowerCase()))[0]!.id;

  it("marks the user IsDeleted instead of erasing them, and hides them from the list", async () => {
    const u = await newUser();
    const before = await listed();
    expect(emailsIn(before)).toContain(u.email);

    expect((await h.api("DELETE", `/api/users/${u.id}`)).status).toBe(204);
    const row = await userRow(u.id);
    expect(row.is_deleted).toBe(1);
    expect(row.deleted_at).toBeGreaterThan(Date.now() - 60_000);
    expect(row.status).toBe("Active"); // deletion is its own flag, not a status change

    const after = await listed();
    expect(emailsIn(after)).not.toContain(u.email);
    expect(after.total).toBe(before.total - 1);
    expect(JSON.stringify(after)).not.toMatch(/isDeleted|is_deleted/); // not part of the API shape
  });

  it("signs them out everywhere at once", async () => {
    const u = await newUser();
    expect((await h.api("GET", "/api/me", undefined, asSession(u.session))).json.session).toBe(true);
    await h.api("DELETE", `/api/users/${u.id}`);
    expect(await h.rows("SELECT id FROM sessions WHERE user_id = ?", u.id)).toHaveLength(0);
    expect((await h.api("GET", "/api/me", undefined, asSession(u.session))).json.session).toBe(false);
  });

  it("a removed user cannot act, even if a session were somehow left behind", async () => {
    const u = await newUser();
    await h.api("DELETE", `/api/users/${u.id}`);
    await h.sql("INSERT INTO sessions (id,tenant_id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)", "ghost", h.tenantId, u.id, await sha256Base64Url("ghost-cookie"), Date.now() + 1e9, 1);
    expect((await h.api("GET", "/api/me", undefined, asSession("ghost-cookie"))).json.session).toBe(false);
    expect((await h.as(u.email).api("GET", "/api/me")).status).toBe(401); // and as the local placeholder user
  });

  it("is for Administrators only", async () => {
    const victim = await newUser();
    const viewer = await newUser("viewer");
    expect((await h.api("DELETE", `/api/users/${victim.id}`, undefined, asSession(viewer.session))).status).toBe(403);
    expect((await userRow(victim.id)).is_deleted).toBe(0);
  });

  it("another tenant's users do not exist for you: 404, and nothing changes", async () => {
    const globexAdmin = await idOf(GLOBEX);
    expect((await h.api("DELETE", `/api/users/${globexAdmin}`)).status).toBe(404);
    expect((await userRow(globexAdmin)).is_deleted).toBe(0);
    expect((await h.api("DELETE", "/api/users/does-not-exist")).status).toBe(404);
  });

  it("removing someone twice is a 404 the second time", async () => {
    const u = await newUser();
    expect((await h.api("DELETE", `/api/users/${u.id}`)).status).toBe(204);
    expect((await h.api("DELETE", `/api/users/${u.id}`)).status).toBe(404);
  });

  it("you cannot remove yourself", async () => {
    const r = await h.api("DELETE", `/api/users/${h.userId}`);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("CANNOT_REMOVE_SELF");
    expect((await userRow(h.userId)).is_deleted).toBe(0);
  });

  it("the last active Administrator cannot be removed, even by a disabled-but-signed-in path", async () => {
    // Globex has one Administrator. Add a Campaign Manager row, then try to remove the Administrator through the
    // repository rule directly: there is nobody else who is an active Administrator.
    const { tenantId, userId } = await h.addTenant("Solo Inc", "boss@solo.test");
    const { usersRepo } = await import("../../src/server/database/repositories/users");
    const { createDb } = await import("../../src/server/database/client");
    expect(await usersRepo(createDb(h.env.DB), tenantId).remove(userId)).toBe("last_administrator");
    expect((await userRow(userId)).is_deleted).toBe(0);
  });

  it("two Administrators removing each other at the same moment cannot both succeed", async () => {
    const { tenantId } = await h.addTenant("Duo Inc", "a@duo.test");
    const a = h.as("a@duo.test");
    await connectGmail(a, "mail@duo.test");
    const bEmail = uniqueEmail("duo-b");
    await invite({ email: bEmail, accessId: "administrator" }, a);
    const bSession = cookieOf(await a.api("POST", `/api/invitations/${tokenFromMail()}/accept`, { password: PASSWORD }));
    const aId = await idOf("a@duo.test");
    const bId = await idOf(bEmail);
    const results = await Promise.all([
      a.api("DELETE", `/api/users/${bId}`),
      h.api("DELETE", `/api/users/${aId}`, undefined, asSession(bSession)),
    ]);
    expect(results.filter((r) => r.status === 204)).toHaveLength(1);
    expect(await h.rows("SELECT id FROM users WHERE tenant_id = ? AND is_deleted = 0 AND access_id = 'administrator'", tenantId)).toHaveLength(1);
  });

  describe("inviting a removed user again", () => {
    it("is allowed, while an active user is still refused", async () => {
      const u = await newUser();
      expect((await invite({ email: u.email })).json.error.code).toBe("ALREADY_MEMBER");
      await h.api("DELETE", `/api/users/${u.id}`);
      await expireCooldown(u.email);
      const r = await invite({ email: u.email, accessId: "administrator" });
      expect(r.status).toBe(201);
      expect(google.mailbox.at(-1)!.raw).toContain(`To: ${u.email}`);
    });

    it("accepting reactivates the SAME account: IsDeleted back to false, new password and role, one row only", async () => {
      const u = await newUser("viewer");
      const oldHash = (await h.rows<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", u.id))[0]!.password_hash;
      await h.api("DELETE", `/api/users/${u.id}`);
      await expireCooldown(u.email);
      await invite({ email: u.email, firstName: "Back", lastName: "Again", accessId: "campaign-manager" });
      const ok = await h.api("POST", `/api/invitations/${tokenFromMail()}/accept`, { password: "An0ther!Passw0rd" });
      expect(ok.status).toBe(200);

      const rows = await h.rows<Record<string, unknown>>("SELECT * FROM users WHERE normalized_email = ?", u.email.toLowerCase());
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: u.id, is_deleted: 0, deleted_at: null, status: "Active", first_name: "Back", last_name: "Again", display_name: "Back Again", access_id: "campaign-manager", tenant_id: h.tenantId });
      expect(rows[0]!.password_hash).not.toBe(oldHash);

      expect(emailsIn(await listed())).toContain(u.email);
      const me = await h.api("GET", "/api/me", undefined, asSession(cookieOf(ok)));
      expect(me.json).toMatchObject({ user: { id: u.id, access: "Campaign Manager" }, session: true });
      expect((await h.api("GET", "/api/me", undefined, asSession(u.session))).json.session).toBe(false); // the old session stays dead
    });

    it("an expired or revoked invitation does not bring them back", async () => {
      const u = await newUser();
      await h.api("DELETE", `/api/users/${u.id}`);
      await expireCooldown(u.email);
      const inv = await invite({ email: u.email });
      const token = tokenFromMail();
      await h.sql("UPDATE invitations SET expires_at = ? WHERE id = ?", Date.now() - 1, inv.json.id);
      expect((await h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD })).status).toBe(404);
      await h.sql("UPDATE invitations SET expires_at = ?, status = 'Revoked' WHERE id = ?", Date.now() + 1e9, inv.json.id);
      expect((await h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD })).status).toBe(404);
      expect((await userRow(u.id)).is_deleted).toBe(1);
      expect(await h.rows("SELECT id FROM sessions WHERE user_id = ?", u.id)).toHaveLength(0);
    });

    it("a rejected password leaves them removed and the link usable", async () => {
      const u = await newUser();
      await h.api("DELETE", `/api/users/${u.id}`);
      await expireCooldown(u.email);
      await invite({ email: u.email });
      const token = tokenFromMail();
      expect((await h.api("POST", `/api/invitations/${token}/accept`, { password: "short" })).status).toBe(400);
      expect((await userRow(u.id)).is_deleted).toBe(1);
      expect((await h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD })).status).toBe(200);
      expect((await userRow(u.id)).is_deleted).toBe(0);
    });

    it("simultaneous clicks reactivate once and make one session", async () => {
      const u = await newUser();
      await h.api("DELETE", `/api/users/${u.id}`);
      await expireCooldown(u.email);
      await invite({ email: u.email });
      const token = tokenFromMail();
      const rs = await Promise.all([1, 2, 3, 4].map(() => h.api("POST", `/api/invitations/${token}/accept`, { password: PASSWORD })));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      expect(rs.filter((r) => r.status === 404)).toHaveLength(3);
      expect(await h.rows("SELECT id FROM sessions WHERE user_id = ?", u.id)).toHaveLength(1);
    });

    it("someone removed from ANOTHER tenant still cannot be invited here, and nothing is revealed", async () => {
      const globexAdmin = await idOf(GLOBEX);
      await h.sql("UPDATE users SET is_deleted = 1, deleted_at = 1 WHERE id = ?", globexAdmin);
      const r = await invite({ email: GLOBEX });
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe("CANNOT_INVITE");
      await h.sql("UPDATE users SET is_deleted = 0, deleted_at = NULL WHERE id = ?", globexAdmin);
    });
  });
});
