import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "../../src/server/database/client";
import { GoogleOAuth, GMAIL_SEND_SCOPE, googleConfig } from "../../src/server/services/google-oauth";
import { refreshTokenFor } from "../../src/server/services/sender";
import { SENDER_CONNECT_ERRORS } from "../../src/shared/types";
import { FakeGoogle, type FakeAccount } from "./fake-google";
import { startHarness, TEST_KEY, type Caller, type Harness } from "./harness";

const google = new FakeGoogle();
let h: Harness;
const cfg = googleConfig({ GOOGLE_CLIENT_ID: "test-client-id", GOOGLE_CLIENT_SECRET: "test-client-secret", TOKEN_ENCRYPTION_KEY: TEST_KEY, APP_BASE_URL: "http://localhost:5173" })!;
const db = () => createDb(h.env.DB);

beforeAll(async () => { h = await startHarness({ google: new GoogleOAuth(google.fetch) }); });
afterAll(async () => { await h.dispose(); });
afterEach(() => { google.revokeFails = false; });

const startConnect = async (who: Caller = h) => {
  const r = await who.api("POST", "/api/sender/gmail/connect");
  expect(r.status).toBe(200);
  return r.json.url as string;
};

/** Plays the browser coming back from Google, and returns what the app redirected to. */
async function comeBack(path: string, who: Caller = h) {
  const r = await who.text(path);
  expect(r.status).toBe(302);
  const location = r.headers.get("location") ?? "";
  const u = new URL(location, "http://x");
  return { location, sender: u.searchParams.get("sender"), reason: u.searchParams.get("reason"), headers: r.headers };
}

/** Click Connect, finish Google's screen as `account`, come back. */
async function connectAs(account: FakeAccount, who: Caller = h) {
  const url = await startConnect(who);
  return { url, ...(await comeBack(google.consent(url, account), who)) };
}

const senderOf = async (who: Caller = h) => (await who.api("GET", "/api/sender")).json;
const rowCount = async (tenantId: string) => (await h.rows<{ n: number }>("SELECT count(*) AS n FROM sender_accounts WHERE tenant_id = ?", tenantId))[0]!.n;

describe("before anything is connected", () => {
  it("reports configured, with no sender", async () => {
    expect(await senderOf()).toEqual({ configured: true, sender: null });
  });

  it("reports 'not configured' when the server has no Google credentials, and refuses to start", async () => {
    for (const missing of [{ GOOGLE_CLIENT_ID: "" }, { GOOGLE_CLIENT_SECRET: "" }, { TOKEN_ENCRYPTION_KEY: "" }, { TOKEN_ENCRYPTION_KEY: "too-short" }, { APP_BASE_URL: "" }]) {
      const caller = h.withEnv({ DEV_ACTOR_EMAIL: h.adminEmail, ...missing });
      expect((await caller.api("GET", "/api/sender")).json, JSON.stringify(missing)).toEqual({ configured: false, sender: null });
      const r = await caller.api("POST", "/api/sender/gmail/connect");
      expect(r.status).toBe(503);
      expect(r.json.error.code).toBe("GMAIL_NOT_CONFIGURED");
    }
  });
});

describe("step 0: starting the connection", () => {
  it("answers with Google's consent screen address, asking only for what it needs", async () => {
    const url = new URL(await startConnect());
    const p = url.searchParams;
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(p.get("client_id")).toBe("test-client-id");
    expect(p.get("redirect_uri")).toBe("http://localhost:5173/api/sender/gmail/callback");
    expect(p.get("scope")!.split(" ")).toEqual(["openid", "email", GMAIL_SEND_SCOPE]);
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("state")!.length).toBeGreaterThanOrEqual(43);
    expect(url.href).not.toContain("test-client-secret");
  });

  it("stores only a hash of the state and an encrypted PKCE verifier", async () => {
    const url = await startConnect();
    const state = FakeGoogle.stateOf(url);
    const [row] = await h.rows<{ state_hash: string; code_verifier_encrypted: string; used_at: number | null; expires_at: number }>(
      "SELECT state_hash, code_verifier_encrypted, used_at, expires_at FROM oauth_states WHERE tenant_id = ? AND used_at IS NULL", h.tenantId);
    expect(row!.state_hash).not.toBe(state);
    expect(row!.state_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row!.code_verifier_encrypted).toMatch(/^v1\./);
    expect(row!.used_at).toBeNull();
    const minutes = (row!.expires_at - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(8);
    expect(minutes).toBeLessThanOrEqual(10);
    const dump = JSON.stringify(await h.rows("SELECT * FROM oauth_states"));
    expect(dump).not.toContain(state);
  });

  it("keeps only the latest attempt valid per tenant", async () => {
    const first = await startConnect();
    const second = await startConnect();
    const stale = await comeBack(google.consent(first, { email: "stale@example.test" }));
    expect(stale).toMatchObject({ sender: "error", reason: "invalid_state" });
    const fresh = await comeBack(google.consent(second, { email: "fresh@example.test" }));
    expect(fresh.sender).toBe("connected");
    await h.api("DELETE", "/api/sender");
  });
});

describe("steps 1 to 5: Google sends the browser back", () => {
  it("connects the account: tokens exchanged, refresh token stored encrypted, address read, sender available", async () => {
    const r = await connectAs({ email: "Owner@Gmail.com" });
    expect(r.location).toBe("http://localhost:5173/settings?sender=connected");
    expect(r.headers.get("cache-control")).toBe("no-store"); // the address holds Google's one-time code
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");

    const status = await senderOf();
    expect(status.sender).toMatchObject({ provider: "gmail", email: "Owner@Gmail.com", status: "Connected", permissions: ["Send email"], connectedBy: h.adminEmail });
    expect(new Date(status.sender.connectedAt).toISOString()).toBe(status.sender.connectedAt);

    // the token is in the database only as ciphertext, and it decrypts for THIS tenant
    const [row] = await h.rows<{ refresh_token_encrypted: string; scopes: string; normalized_email: string; key_version: number }>("SELECT * FROM sender_accounts WHERE tenant_id = ?", h.tenantId);
    expect(row!.refresh_token_encrypted).toMatch(/^v1\./);
    expect(row).toMatchObject({ normalized_email: "owner@gmail.com", key_version: 1 });
    expect(row!.scopes).toContain(GMAIL_SEND_SCOPE);
    const token = await refreshTokenFor(db(), cfg, h.tenantId);
    expect(token).toMatch(/^refresh-\d+$/);
    expect(row!.refresh_token_encrypted).not.toContain(token!);
    // and nothing about the answer reveals a token
    expect(JSON.stringify(status)).not.toMatch(/refresh|access-|token/i);
    await h.api("DELETE", "/api/sender");
  });

  it("never logs a token, a code, the state or the email address", async () => {
    const log = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    try {
      const url = await startConnect();
      const state = FakeGoogle.stateOf(url);
      await comeBack(google.consent(url, { email: "secret.person@gmail.com" }));
      const token = (await refreshTokenFor(db(), cfg, h.tenantId))!;
      // and a failing run as well
      const url2 = await startConnect();
      await comeBack(google.consent(url2, { email: "x@example.test", exchange: "fail" }));
      const logged = [...log.mock.calls, ...err.mock.calls].flat().map(String).join("\n");
      for (const secret of [token, state, "secret.person@gmail.com", "code-", "access-", "test-client-secret", TEST_KEY]) {
        expect(logged, secret).not.toContain(secret);
      }
      expect(logged).toContain("gmail_connected"); // it does log that something happened
    } finally {
      log.mockRestore();
      err.mockRestore();
      await h.api("DELETE", "/api/sender");
    }
  });

  it("uses a state exactly once: replaying the callback is refused and changes nothing", async () => {
    const url = await startConnect();
    const back = google.consent(url, { email: "once@example.test" });
    expect((await comeBack(back)).sender).toBe("connected");
    const before = await senderOf();
    const replay = await comeBack(google.consent(url, { email: "attacker@example.test" }));
    expect(replay).toMatchObject({ sender: "error", reason: "invalid_state" });
    expect(await senderOf()).toEqual(before);
    await h.api("DELETE", "/api/sender");
  });

  it("two simultaneous callbacks with the same state: exactly one wins", async () => {
    const url = await startConnect();
    const [a, b] = await Promise.all([
      comeBack(google.consent(url, { email: "race-a@example.test" })),
      comeBack(google.consent(url, { email: "race-b@example.test" })),
    ]);
    expect([a.sender, b.sender].sort()).toEqual(["connected", "error"]);
    expect(await rowCount(h.tenantId)).toBe(1);
    await h.api("DELETE", "/api/sender");
  });

  it("refuses a missing, garbage, unknown or expired state", async () => {
    for (const path of [
      "/api/sender/gmail/callback?code=abc",
      "/api/sender/gmail/callback?code=abc&state=",
      "/api/sender/gmail/callback?code=abc&state=garbage",
      `/api/sender/gmail/callback?code=abc&state=${"x".repeat(5000)}`,
    ]) {
      expect(await comeBack(path), path.slice(0, 60)).toMatchObject({ sender: "error", reason: "invalid_state" });
    }
    const url = await startConnect();
    await h.sql("UPDATE oauth_states SET expires_at = ? WHERE tenant_id = ? AND used_at IS NULL", Date.now() - 1000, h.tenantId);
    expect(await comeBack(google.consent(url, { email: "late@example.test" }))).toMatchObject({ reason: "invalid_state" });
    expect(await rowCount(h.tenantId)).toBe(0);
  });

  it("refuses a callback without a code, after using up the state", async () => {
    const url = await startConnect();
    const state = FakeGoogle.stateOf(url);
    expect(await comeBack(`/api/sender/gmail/callback?state=${encodeURIComponent(state)}`)).toMatchObject({ reason: "invalid_state" });
    expect(await comeBack(google.consent(url, { email: "later@example.test" }))).toMatchObject({ reason: "invalid_state" }); // the state is gone
  });

  it("treats the user pressing Cancel on Google's screen as 'denied'", async () => {
    const url = await startConnect();
    const state = FakeGoogle.stateOf(url);
    const r = await comeBack(`/api/sender/gmail/callback?error=access_denied&state=${encodeURIComponent(state)}`);
    expect(r).toMatchObject({ sender: "error", reason: "denied" });
    expect(await rowCount(h.tenantId)).toBe(0);
    expect(await comeBack(google.consent(url, { email: "after@example.test" }))).toMatchObject({ reason: "invalid_state" }); // state burned
  });

  it("refuses an account that left the 'send email' permission unticked, stores nothing, and takes back what Google granted", async () => {
    const revokedBefore = google.revoked.length;
    const r = await connectAs({ email: "partial@example.test", scopes: ["openid", "https://www.googleapis.com/auth/userinfo.email"] });
    expect(r).toMatchObject({ sender: "error", reason: "missing_permission" });
    expect(await rowCount(h.tenantId)).toBe(0);
    expect(google.revoked.length).toBe(revokedBefore + 1); // no orphaned authorization left at Google
  });

  it("refuses when Google issues no refresh token, because sending later would be impossible", async () => {
    const revokedBefore = google.revoked.length;
    const r = await connectAs({ email: "norefresh@example.test", refreshToken: null });
    expect(r).toMatchObject({ sender: "error", reason: "no_refresh_token" });
    expect(await rowCount(h.tenantId)).toBe(0);
    expect(google.revoked.length).toBe(revokedBefore + 1);
  });

  it("reports an exchange failure (Google refuses the code), storing nothing", async () => {
    expect(await connectAs({ email: "x@example.test", exchange: "fail" })).toMatchObject({ sender: "error", reason: "exchange_failed" });
    expect(await rowCount(h.tenantId)).toBe(0);
  });

  it("rejects a code that was issued for a different PKCE challenge", async () => {
    const url = await startConnect();
    const other = await startConnect(); // a second attempt has a different challenge, and replaces the first
    const forged = google.consent(other, { email: "pkce@example.test" }).replace(/state=[^&]+/, `state=${encodeURIComponent(FakeGoogle.stateOf(other))}`);
    // use a code minted against `url`'s challenge with `other`'s state: the verifier will not match
    const wrongCode = new URL(google.consent(url, { email: "pkce@example.test" }), "http://x").searchParams.get("code");
    const r = await comeBack(`/api/sender/gmail/callback?code=${wrongCode}&state=${encodeURIComponent(FakeGoogle.stateOf(other))}`);
    expect(r).toMatchObject({ sender: "error", reason: "exchange_failed" });
    expect(forged).toBeTruthy();
    expect(await rowCount(h.tenantId)).toBe(0);
  });

  it("reports when the address cannot be read or is not verified, and cancels the token", async () => {
    for (const account of [{ email: "a@example.test", userinfo: "fail" as const }, { email: "b@example.test", verified: false }, { email: "c@example.test", userinfo: 403 }]) {
      const revokedBefore = google.revoked.length;
      expect(await connectAs(account), account.email).toMatchObject({ sender: "error", reason: "email_unavailable" });
      expect(google.revoked.length).toBe(revokedBefore + 1);
    }
    expect(await rowCount(h.tenantId)).toBe(0);
  });

  it("refuses when the tenant or the user became inactive while the user was on Google's screen", async () => {
    const url = await startConnect();
    await h.sql("UPDATE tenants SET status = 'Suspended' WHERE id = ?", h.tenantId);
    expect(await comeBack(google.consent(url, { email: "inactive@example.test" }))).toMatchObject({ reason: "inactive" });
    await h.sql("UPDATE tenants SET status = 'Active' WHERE id = ?", h.tenantId);
    expect(await rowCount(h.tenantId)).toBe(0);
  });

  it("only ever redirects to the configured app address, with a code from a fixed list", async () => {
    const attempts = [
      "/api/sender/gmail/callback?redirect=https://evil.test&next=//evil.test&state=x",
      "/api/sender/gmail/callback?code=1&state=x&reason=https://evil.test&sender=connected",
    ];
    for (const path of attempts) {
      const r = await comeBack(path);
      expect(r.location.startsWith("http://localhost:5173/settings?sender=error&reason=")).toBe(true);
      expect(SENDER_CONNECT_ERRORS as readonly string[]).toContain(r.reason);
    }
    // without any Google configuration it still goes somewhere safe, never to anything the request named
    const bare = await h.withEnv({ GOOGLE_CLIENT_ID: "" }).text("/api/sender/gmail/callback?redirect=https://evil.test&state=x");
    expect(bare.headers.get("location")).toBe("/settings?sender=error&reason=not_configured");
  });

  it("is reachable without signing in (Google, not our UI, calls it), yet still fails closed outside local", async () => {
    const prod = h.withEnv({ ENVIRONMENT: "production" });
    const r = await prod.text("/api/sender/gmail/callback?code=1&state=nothing");
    expect(r.status).toBe(302); // not a 503: the callback has no sign-in to require
    expect(new URL(r.headers.get("location")!).searchParams.get("reason")).toBe("invalid_state"); // and no state can exist there
    expect((await prod.api("POST", "/api/sender/gmail/connect")).status).toBe(503); // starting one is blocked
    expect((await prod.api("GET", "/api/sender")).status).toBe(503);
  });
});

describe("reconnecting and disconnecting", () => {
  it("reconnecting the same account replaces the token in place and cancels the old one", async () => {
    await connectAs({ email: "same@example.test" });
    const oldToken = (await refreshTokenFor(db(), cfg, h.tenantId))!;
    const first = (await senderOf()).sender;
    await new Promise((r) => setTimeout(r, 5));

    expect((await connectAs({ email: "same@example.test" })).sender).toBe("connected");
    const newToken = (await refreshTokenFor(db(), cfg, h.tenantId))!;
    expect(newToken).not.toBe(oldToken);
    expect(google.revoked).toContain(oldToken);
    expect(google.revoked).not.toContain(newToken);
    expect(await rowCount(h.tenantId)).toBe(1);
    const second = (await senderOf()).sender;
    expect(second.id).toBe(first.id);
    expect(second.connectedAt > first.connectedAt).toBe(true);
    await h.api("DELETE", "/api/sender");
  });

  it("connecting a different account replaces the first (one sender per tenant)", async () => {
    await connectAs({ email: "first@example.test" });
    const oldToken = (await refreshTokenFor(db(), cfg, h.tenantId))!;
    await connectAs({ email: "second@example.test" });
    expect((await senderOf()).sender.email).toBe("second@example.test");
    expect(google.revoked).toContain(oldToken);
    expect(await rowCount(h.tenantId)).toBe(1);
    await h.api("DELETE", "/api/sender");
  });

  it("a failed reconnect leaves the existing connection untouched", async () => {
    await connectAs({ email: "keep@example.test" });
    const before = await senderOf();
    const token = await refreshTokenFor(db(), cfg, h.tenantId);
    expect(await connectAs({ email: "new@example.test", exchange: "fail" })).toMatchObject({ reason: "exchange_failed" });
    expect(await connectAs({ email: "new@example.test", scopes: ["openid"] })).toMatchObject({ reason: "missing_permission" });
    expect(await senderOf()).toEqual(before);
    expect(await refreshTokenFor(db(), cfg, h.tenantId)).toBe(token);
    await h.api("DELETE", "/api/sender");
  });

  it("disconnecting removes the account and tells Google to cancel the token", async () => {
    await connectAs({ email: "bye@example.test" });
    const token = (await refreshTokenFor(db(), cfg, h.tenantId))!;
    const r = await h.api("DELETE", "/api/sender");
    expect(r.status).toBe(204);
    expect(google.revoked).toContain(token);
    expect(await senderOf()).toEqual({ configured: true, sender: null });
    expect(await rowCount(h.tenantId)).toBe(0);
    const again = await h.api("DELETE", "/api/sender");
    expect(again.status).toBe(404);
    expect(again.json.error.code).toBe("NOT_FOUND");
  });

  it("disconnects even when Google cannot be reached to cancel the token", async () => {
    await connectAs({ email: "offline@example.test" });
    google.revokeFails = true;
    expect((await h.api("DELETE", "/api/sender")).status).toBe(204);
    expect(await rowCount(h.tenantId)).toBe(0);
  });

  it("a successful reconnect is not undone when the old token cannot be cancelled", async () => {
    await connectAs({ email: "stay@example.test" });
    google.revokeFails = true;
    expect((await connectAs({ email: "stay@example.test" })).sender).toBe("connected");
    expect((await senderOf()).sender.email).toBe("stay@example.test");
    await h.api("DELETE", "/api/sender");
  });
});

describe("who may do what", () => {
  const addUser = (tenantId: string, email: string, accessId: string) =>
    h.sql("INSERT INTO users (id,tenant_id,email,normalized_email,password_hash,access_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      `u-${email}`, tenantId, email, email, "pbkdf2-sha256$1$AA$AA", accessId, Date.now(), Date.now());

  it("lets every signed-in user see the status, but only Administrators connect or disconnect", async () => {
    await addUser(h.tenantId, "mgr@a.test", "campaign-manager");
    await addUser(h.tenantId, "view@a.test", "viewer");
    await connectAs({ email: "roles@example.test" });
    for (const email of ["mgr@a.test", "view@a.test"]) {
      const who = h.as(email);
      expect((await who.api("GET", "/api/sender")).json.sender.email, email).toBe("roles@example.test");
      const connect = await who.api("POST", "/api/sender/gmail/connect");
      expect(connect.status, email).toBe(403);
      expect(connect.json.error.code).toBe("FORBIDDEN");
      expect((await who.api("DELETE", "/api/sender")).status, email).toBe(403);
    }
    expect(await senderOf()).not.toEqual({ configured: true, sender: null }); // still connected
    await h.api("DELETE", "/api/sender");
  });

  it("refuses unknown users", async () => {
    expect((await h.as("nobody@nowhere.test").api("GET", "/api/sender")).status).toBe(401);
  });
});

describe("tenants cannot reach each other's connected account", () => {
  let other: { tenantId: string; userId: string };
  const otherEmail = "admin@globex.test";
  let b: Caller;
  beforeAll(async () => {
    other = await h.addTenant("Globex Corp", otherEmail);
    b = h.as(otherEmail);
  });

  it("each tenant has its own connection, and sees only its own", async () => {
    await connectAs({ email: "a-sender@example.test" });
    expect((await senderOf(b)).sender).toBeNull();
    await connectAs({ email: "b-sender@example.test" }, b);
    expect((await senderOf()).sender.email).toBe("a-sender@example.test");
    expect((await senderOf(b)).sender.email).toBe("b-sender@example.test");
    expect((await senderOf(b)).sender.connectedBy).toBe(otherEmail);
    // disconnecting one leaves the other
    expect((await b.api("DELETE", "/api/sender")).status).toBe(204);
    expect((await senderOf()).sender.email).toBe("a-sender@example.test");
    await h.api("DELETE", "/api/sender");
  });

  it("the attempt, not whoever finishes the callback, decides the tenant", async () => {
    const url = await startConnect(h); // tenant A starts...
    const back = google.consent(url, { email: "for-a@example.test" });
    await comeBack(back, b); // ...and tenant B's browser happens to complete it
    expect((await senderOf()).sender.email).toBe("for-a@example.test"); // it landed in A
    expect((await senderOf(b)).sender).toBeNull(); // and B got nothing
    await h.api("DELETE", "/api/sender");
  });

  it("an encrypted token copied into another tenant's row cannot be decrypted there", async () => {
    await connectAs({ email: "bound@example.test" });
    const [a] = await h.rows<{ refresh_token_encrypted: string }>("SELECT refresh_token_encrypted FROM sender_accounts WHERE tenant_id = ?", h.tenantId);
    await h.sql(
      "INSERT INTO sender_accounts (id,tenant_id,email,normalized_email,refresh_token_encrypted,scopes,connected_by,connected_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      "stolen", other.tenantId, "thief@example.test", "thief@example.test", a!.refresh_token_encrypted, GMAIL_SEND_SCOPE, other.userId, Date.now(), Date.now(), Date.now(),
    );
    expect(await refreshTokenFor(db(), cfg, h.tenantId)).toMatch(/^refresh-/); // fine where it belongs
    await expect(refreshTokenFor(db(), cfg, other.tenantId)).rejects.toThrow("Could not decrypt"); // useless anywhere else
    await h.sql("DELETE FROM sender_accounts WHERE id = 'stolen'");
    await h.api("DELETE", "/api/sender");
  });
});

describe("the database enforces the same rules", () => {
  const insert = (over: Partial<Record<string, unknown>> = {}) => {
    const v = { id: "s1", tenant_id: h.tenantId, provider: "gmail", email: "x@example.test", normalized_email: "x@example.test", status: "Connected", token: "v1.a.b", connected_by: h.userId, ...over };
    return h.sql(
      "INSERT INTO sender_accounts (id,tenant_id,provider,email,normalized_email,status,refresh_token_encrypted,scopes,connected_by,connected_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      v.id, v.tenant_id, v.provider, v.email, v.normalized_email, v.status, v.token, GMAIL_SEND_SCOPE, v.connected_by, 1, 1, 1,
    );
  };

  it("allows one connected account per tenant", async () => {
    await insert({ id: "ok-1" });
    await expect(insert({ id: "ok-2", email: "y@example.test", normalized_email: "y@example.test" })).rejects.toThrow(/UNIQUE|constraint/i);
    await h.sql("DELETE FROM sender_accounts WHERE id = 'ok-1'");
  });

  it("rejects an unknown provider or status, a blank token, a non-normalized email, and a connector from another tenant", async () => {
    const other = await h.addTenant("Fk Test Co", "boss@fk.test");
    for (const bad of [{ provider: "outlook" }, { status: "Maybe" }, { token: "" }, { email: "A@B.com", normalized_email: "A@B.com" }, { connected_by: other.userId }]) {
      await expect(insert({ id: "bad", ...bad }), JSON.stringify(bad)).rejects.toThrow(/constraint|FOREIGN KEY/i);
    }
    expect(await rowCount(h.tenantId)).toBe(0);
  });

  it("will not delete a tenant, or a user, that has a connected account", async () => {
    await insert({ id: "held" });
    await expect(h.sql("DELETE FROM tenants WHERE id = ?", h.tenantId)).rejects.toThrow(/constraint|FOREIGN KEY/i);
    await expect(h.sql("DELETE FROM users WHERE id = ?", h.userId)).rejects.toThrow(/constraint|FOREIGN KEY/i);
    await h.sql("DELETE FROM sender_accounts WHERE id = 'held'");
  });
});
