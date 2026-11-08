import { describe, expect, it } from "vitest";
import { GMAIL_SEND_SCOPE, GoogleError, GoogleOAuth, googleConfig, REQUESTED_SCOPES } from "../../src/server/services/google-oauth";

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const env = { GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "csecret", TOKEN_ENCRYPTION_KEY: KEY, APP_BASE_URL: "http://localhost:5173" };
const cfg = googleConfig(env)!;

describe("googleConfig", () => {
  it("builds the redirect address from the app address", () => {
    expect(cfg.redirectUri).toBe("http://localhost:5173/api/sender/gmail/callback");
    expect(googleConfig({ ...env, APP_BASE_URL: "https://app.sendlab.example/" })!.redirectUri).toBe("https://app.sendlab.example/api/sender/gmail/callback");
    // only the origin counts: a path or query on the setting cannot redirect somewhere unexpected
    expect(googleConfig({ ...env, APP_BASE_URL: "https://app.sendlab.example/x?y=1" })!.appBaseUrl).toBe("https://app.sendlab.example");
  });

  it("is null unless EVERYTHING is present and valid, so 'not configured' is one clear state", () => {
    expect(googleConfig({})).toBeNull();
    for (const missing of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY", "APP_BASE_URL"] as const) {
      expect(googleConfig({ ...env, [missing]: undefined }), missing).toBeNull();
      expect(googleConfig({ ...env, [missing]: "" }), `${missing} empty`).toBeNull();
    }
    expect(googleConfig({ ...env, TOKEN_ENCRYPTION_KEY: "too-short" })).toBeNull();
    expect(googleConfig({ ...env, APP_BASE_URL: "not a url" })).toBeNull();
  });

  it("insists on https, except for localhost during development", () => {
    expect(googleConfig({ ...env, APP_BASE_URL: "http://app.sendlab.example" })).toBeNull();
    expect(googleConfig({ ...env, APP_BASE_URL: "http://127.0.0.1:5173" })).not.toBeNull();
    expect(googleConfig({ ...env, APP_BASE_URL: "https://app.sendlab.example" })).not.toBeNull();
  });
});

describe("authorization address", () => {
  const url = new URL(new GoogleOAuth().authorizationUrl(cfg, { state: "S", codeChallenge: "CH" }));
  const p = url.searchParams;

  it("goes to Google's consent screen with the standard code flow", () => {
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe(cfg.clientId);
    expect(p.get("redirect_uri")).toBe(cfg.redirectUri);
  });

  it("asks only for: send email, and which address this is (nothing about the inbox)", () => {
    expect(p.get("scope")!.split(" ")).toEqual(["openid", "email", GMAIL_SEND_SCOPE]);
    expect(REQUESTED_SCOPES).toEqual(["openid", "email", GMAIL_SEND_SCOPE]);
    expect(p.get("scope")).not.toMatch(/readonly|modify|compose|mail\.google\.com\/$/);
  });

  it("asks for a long-lived token every time, so reconnecting always yields one", () => {
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
  });

  it("uses PKCE and carries the state, and never the client secret", () => {
    expect(p.get("code_challenge")).toBe("CH");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("state")).toBe("S");
    expect(url.href).not.toContain("csecret");
  });
});

/** A fetch that answers with a fixed response and records the request. */
function replying(status: number, body: unknown) {
  const seen: { url: string; init: RequestInit }[] = [];
  const doFetch: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { doFetch, seen };
}
const failing: typeof fetch = async () => { throw new TypeError("network down"); };

describe("exchanging the code", () => {
  const ok = { access_token: "AT", refresh_token: "RT", expires_in: 3599, scope: "openid email https://www.googleapis.com/auth/gmail.send", token_type: "Bearer" };

  it("posts every required field to Google's token endpoint, including the PKCE verifier", async () => {
    const { doFetch, seen } = replying(200, ok);
    const tokens = await new GoogleOAuth(doFetch).exchangeCode(cfg, "THE-CODE", "THE-VERIFIER");
    expect(seen[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(seen[0]!.init.method).toBe("POST");
    const form = new URLSearchParams(String(seen[0]!.init.body));
    expect(Object.fromEntries(form)).toEqual({
      code: "THE-CODE", client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code", code_verifier: "THE-VERIFIER",
    });
    expect(tokens).toEqual({ accessToken: "AT", refreshToken: "RT", scopes: ["openid", "email", GMAIL_SEND_SCOPE] });
  });

  it("reports a missing refresh token as null instead of inventing one", async () => {
    const { refresh_token: _drop, ...noRefresh } = ok;
    expect((await new GoogleOAuth(replying(200, noRefresh).doFetch).exchangeCode(cfg, "c", "v")).refreshToken).toBeNull();
  });

  it("reads exactly the scopes Google granted, which may be fewer than requested", async () => {
    const t = await new GoogleOAuth(replying(200, { ...ok, scope: "openid email" }).doFetch).exchangeCode(cfg, "c", "v");
    expect(t.scopes).not.toContain(GMAIL_SEND_SCOPE);
  });

  it("fails with Google's error code when Google refuses, and never echoes a secret", async () => {
    const err = await new GoogleOAuth(replying(400, { error: "invalid_grant", error_description: "Bad code RT-SECRET" }).doFetch)
      .exchangeCode(cfg, "c", "v").catch((e) => e);
    expect(err).toBeInstanceOf(GoogleError);
    expect(err.step).toBe("exchange");
    expect(err.googleCode).toBe("invalid_grant");
    expect(err.message).not.toMatch(/RT-SECRET|csecret|\bc\b.*verifier/);
  });

  it("fails cleanly on a network error, a non-JSON body and a malformed answer", async () => {
    for (const doFetch of [failing, async () => new Response("<html>oops</html>", { status: 502 }), replying(200, { nothing: true }).doFetch]) {
      await expect(new GoogleOAuth(doFetch).exchangeCode(cfg, "c", "v")).rejects.toBeInstanceOf(GoogleError);
    }
  });
});

describe("reading the account's email", () => {
  it("returns the verified address, trimmed, sending the access token as a bearer", async () => {
    const { doFetch, seen } = replying(200, { email: " Owner@Gmail.com ", email_verified: true });
    expect(await new GoogleOAuth(doFetch).userEmail("AT")).toBe("Owner@Gmail.com");
    expect(seen[0]!.url).toBe("https://openidconnect.googleapis.com/v1/userinfo");
    expect(new Headers(seen[0]!.init.headers).get("authorization")).toBe("Bearer AT");
  });

  it("refuses an unverified address, an error status, a malformed answer and a network failure", async () => {
    for (const doFetch of [
      replying(200, { email: "a@b.co", email_verified: false }).doFetch,
      replying(401, { error: "invalid_token" }).doFetch,
      replying(200, { name: "no email here" }).doFetch,
      failing,
    ]) {
      await expect(new GoogleOAuth(doFetch).userEmail("AT")).rejects.toBeInstanceOf(GoogleError);
    }
  });
});

describe("revoking", () => {
  it("tells Google to cancel the token, and says whether it worked", async () => {
    const { doFetch, seen } = replying(200, {});
    expect(await new GoogleOAuth(doFetch).revoke("RT")).toBe(true);
    expect(seen[0]!.url).toBe("https://oauth2.googleapis.com/revoke");
    expect(new URLSearchParams(String(seen[0]!.init.body)).get("token")).toBe("RT");
  });
  it("never throws: a failure just means false", async () => {
    expect(await new GoogleOAuth(replying(400, { error: "invalid_token" }).doFetch).revoke("RT")).toBe(false);
    expect(await new GoogleOAuth(failing).revoke("RT")).toBe(false);
  });
});
