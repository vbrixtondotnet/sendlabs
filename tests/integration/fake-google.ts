import { sha256Base64Url } from "../../src/server/lib/crypto";
import { GMAIL_SEND_SCOPE } from "../../src/server/services/google-oauth";

/**
 * A stand-in for Google's OAuth endpoints (token, userinfo, revoke), driven by the tests.
 * It enforces what Google enforces: the right client id and secret, the exact redirect address, and PKCE
 * (the verifier must hash to the challenge sent at the start). It records every call, so tests can assert what
 * was revoked and what was (not) sent.
 *
 * It is NOT Google. It proves our side of the conversation is correct, not that Google's real screens, quotas
 * or verification rules will accept it.
 */
export interface FakeAccount {
  email: string;
  /** What the user ticked on the consent screen. Defaults to everything we ask for. */
  scopes?: string[];
  refreshToken?: string | null;
  verified?: boolean;
  /** Make a step fail. */
  exchange?: "fail";
  userinfo?: "fail" | number;
}

interface IssuedCode { challenge: string; account: FakeAccount }

export class FakeGoogle {
  readonly clientId = "test-client-id";
  readonly clientSecret = "test-client-secret";
  readonly redirectUri = "http://localhost:5173/api/sender/gmail/callback";

  private codes = new Map<string, IssuedCode>();
  private accessTokens = new Map<string, FakeAccount>();
  private refreshTokens = new Map<string, FakeAccount>();
  private n = 0;
  /** Tokens Google was asked to cancel, in order. */
  readonly revoked: string[] = [];
  readonly calls: { method: string; url: string }[] = [];
  /** When true, revoke requests fail (Google unreachable). */
  revokeFails = false;
  /** Every message handed to Gmail's send endpoint: who it was sent as, and the raw RFC 5322 text. */
  readonly mailbox: { from: string; raw: string }[] = [];
  /** Make the send endpoint answer with this error instead of accepting the message. */
  sendFailure: { status: number; body?: unknown } | null = null;
  /** Make the refresh-token grant fail with invalid_grant, as if the user had revoked access. */
  refreshFails = false;

  /** Pretends the user finished Google's consent screen: returns the address Google would redirect the browser to. */
  consent(authUrl: string, account: FakeAccount): string {
    const u = new URL(authUrl);
    const code = `code-${++this.n}`;
    this.codes.set(code, { challenge: u.searchParams.get("code_challenge") ?? "", account });
    return `/api/sender/gmail/callback?code=${code}&state=${encodeURIComponent(u.searchParams.get("state") ?? "")}`;
  }

  /** The `state` value out of an authorization address. */
  static stateOf(authUrl: string) { return new URL(authUrl).searchParams.get("state") ?? ""; }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    this.calls.push({ method, url });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (url === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(init?.body));
      if (form.get("client_id") !== this.clientId || form.get("client_secret") !== this.clientSecret) return json(401, { error: "invalid_client" });
      if (form.get("grant_type") === "refresh_token") {
        const token = form.get("refresh_token") ?? "";
        const account = this.refreshTokens.get(token);
        if (!account || this.revoked.includes(token) || this.refreshFails) return json(400, { error: "invalid_grant" });
        const access = `access-${++this.n}`;
        this.accessTokens.set(access, account);
        return json(200, { access_token: access, expires_in: 3599, token_type: "Bearer", scope: (account.scopes ?? []).join(" ") });
      }
      if (form.get("redirect_uri") !== this.redirectUri || form.get("grant_type") !== "authorization_code") return json(400, { error: "invalid_request" });
      const issued = this.codes.get(form.get("code") ?? "");
      if (!issued) return json(400, { error: "invalid_grant" });
      this.codes.delete(form.get("code") ?? ""); // a code works once
      if ((await sha256Base64Url(form.get("code_verifier") ?? "")) !== issued.challenge) return json(400, { error: "invalid_grant" });
      if (issued.account.exchange === "fail") return json(400, { error: "invalid_grant" });
      const access = `access-${++this.n}`;
      this.accessTokens.set(access, issued.account);
      const refresh = issued.account.refreshToken === undefined ? `refresh-${this.n}` : issued.account.refreshToken;
      if (refresh) this.refreshTokens.set(refresh, issued.account);
      return json(200, {
        access_token: access,
        ...(refresh ? { refresh_token: refresh } : {}),
        expires_in: 3599,
        token_type: "Bearer",
        scope: (issued.account.scopes ?? ["openid", "https://www.googleapis.com/auth/userinfo.email", GMAIL_SEND_SCOPE]).join(" "),
      });
    }

    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
      const account = this.accessTokens.get(token);
      if (!account) return json(401, { error: "invalid_token" });
      if (account.userinfo === "fail") return json(500, { error: "backend_error" });
      if (typeof account.userinfo === "number") return json(account.userinfo, {});
      return json(200, { email: account.email, email_verified: account.verified ?? true });
    }

    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
      const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
      const account = this.accessTokens.get(token);
      if (!account) return json(401, { error: { code: 401, status: "UNAUTHENTICATED" } });
      if (this.sendFailure) return json(this.sendFailure.status, this.sendFailure.body ?? { error: { code: this.sendFailure.status } });
      const raw = (JSON.parse(String(init?.body)) as { raw: string }).raw;
      const text = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      this.mailbox.push({ from: account.email, raw: text });
      return json(200, { id: `msg-${++this.n}`, threadId: `thread-${this.n}` });
    }

    if (url === "https://oauth2.googleapis.com/revoke") {
      if (this.revokeFails) throw new TypeError("network down");
      this.revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? "");
      return json(200, {});
    }
    return json(404, { error: "unknown endpoint" });
  };
}
