import { z } from "zod";
import { isValidEncryptionKey } from "../lib/crypto";

/** The only permissions Sendrix asks for: send email, and read which address was connected. Nothing about the inbox. */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const REQUESTED_SCOPES = ["openid", "email", GMAIL_SEND_SCOPE] as const;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/** Where Google sends the browser back to. Register this exact address in the Google Cloud console. */
export const CALLBACK_PATH = "/api/sender/gmail/callback";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** For encrypting the refresh token. 32 bytes, base64. */
  encryptionKey: string;
  /** The app's public address: where the browser is sent after Google. */
  appBaseUrl: string;
}

/**
 * Reads the Google settings from the environment. Returns null unless EVERYTHING needed is present and valid, so
 * "not configured" is one clear state rather than a half-working one.
 */
export function googleConfig(env: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; TOKEN_ENCRYPTION_KEY?: string; APP_BASE_URL?: string }): GoogleConfig | null {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, TOKEN_ENCRYPTION_KEY: encryptionKey, APP_BASE_URL: base } = env;
  if (!clientId || !clientSecret || !isValidEncryptionKey(encryptionKey) || !base) return null;
  let appBaseUrl: URL;
  try {
    appBaseUrl = new URL(base);
  } catch {
    return null;
  }
  if (appBaseUrl.protocol !== "https:" && appBaseUrl.hostname !== "localhost" && appBaseUrl.hostname !== "127.0.0.1") return null;
  return {
    clientId,
    clientSecret,
    encryptionKey,
    appBaseUrl: appBaseUrl.origin,
    redirectUri: new URL(CALLBACK_PATH, appBaseUrl).toString(),
  };
}

/** A failed call to Google. Carries Google's error code (like `invalid_grant`) but never a token or a code. */
export class GoogleError extends Error {
  constructor(readonly step: "exchange" | "userinfo" | "refresh", readonly googleCode: string | null = null) {
    super(`Google ${step} failed${googleCode ? ` (${googleCode})` : ""}`);
    this.name = "GoogleError";
  }
}

/**
 * A failed attempt to send. `kind` tells the caller what to do:
 *  - auth: Google rejected our token (revoked, expired, password changed): the tenant must reconnect.
 *  - rate_limit: Gmail is limiting this account right now: try again later.
 *  - transient: Google had a problem or the network failed: trying again may work.
 *  - permanent: Google refused this message: retrying the same message will not help.
 */
export class GmailSendError extends Error {
  constructor(readonly kind: "auth" | "rate_limit" | "transient" | "permanent", readonly status: number | null = null) {
    super(`Gmail send failed (${kind}${status ? ` ${status}` : ""})`);
    this.name = "GmailSendError";
  }
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
  scope: z.string().default(""),
});
const userInfo = z.object({ email: z.string().min(1), email_verified: z.boolean().optional() });

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  /** What the user actually granted. May be fewer than requested: Google lets people untick boxes. */
  scopes: string[];
}

const TIMEOUT_MS = 10_000;

export class GoogleOAuth {
  /** `doFetch` is injectable so tests can stand in for Google. Wrapped so `fetch` keeps its Workers binding. */
  constructor(private readonly doFetch: typeof fetch = (input, init) => fetch(input, init)) {}

  /** The address to send the browser to. PKCE (S256) is used on top of the client secret. */
  authorizationUrl(cfg: GoogleConfig, params: { state: string; codeChallenge: string }): string {
    const q = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: "code",
      scope: REQUESTED_SCOPES.join(" "),
      // offline + consent: without these Google may not issue the long-lived refresh token we need to keep sending.
      access_type: "offline",
      prompt: "consent",
      state: params.state,
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
    });
    return `${AUTH_URL}?${q.toString()}`;
  }

  async exchangeCode(cfg: GoogleConfig, code: string, codeVerifier: string): Promise<GoogleTokens> {
    let res: Response;
    try {
      res = await this.doFetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: cfg.redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new GoogleError("exchange");
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new GoogleError("exchange", typeof (body as { error?: unknown })?.error === "string" ? (body as { error: string }).error : null);
    const parsed = tokenResponse.safeParse(body);
    if (!parsed.success) throw new GoogleError("exchange", "malformed_response");
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token ?? null,
      scopes: parsed.data.scope.split(/\s+/).filter(Boolean),
    };
  }

  /** The authorized account's address. Requires a verified one: an unverified address proves nothing. */
  async userEmail(accessToken: string): Promise<string> {
    let res: Response;
    try {
      res = await this.doFetch(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new GoogleError("userinfo");
    }
    if (!res.ok) throw new GoogleError("userinfo", String(res.status));
    const parsed = userInfo.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new GoogleError("userinfo", "malformed_response");
    if (parsed.data.email_verified === false) throw new GoogleError("userinfo", "email_not_verified");
    return parsed.data.email.trim();
  }

  /**
   * Turns the stored long-lived refresh token into a short-lived access token (about an hour). Throws GoogleError
   * with `googleCode` "invalid_grant" when Google no longer honours the refresh token: that means reconnect.
   */
  async refreshAccessToken(cfg: GoogleConfig, refreshToken: string): Promise<string> {
    let res: Response;
    try {
      res = await this.doFetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new GoogleError("refresh");
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new GoogleError("refresh", typeof (body as { error?: unknown })?.error === "string" ? (body as { error: string }).error : String(res.status));
    const parsed = tokenResponse.safeParse(body);
    if (!parsed.success) throw new GoogleError("refresh", "malformed_response");
    return parsed.data.access_token;
  }

  /** Sends one message (`raw` is the whole RFC 5322 message, base64url encoded). Returns Gmail's message id. */
  async sendMessage(accessToken: string, raw: string): Promise<{ id: string }> {
    let res: Response;
    try {
      res = await this.doFetch(GMAIL_SEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new GmailSendError("transient");
    }
    const body = (await res.json().catch(() => null)) as { id?: unknown; error?: { errors?: { reason?: string }[]; status?: string } } | null;
    if (res.ok) {
      if (typeof body?.id !== "string") throw new GmailSendError("transient", res.status);
      return { id: body.id };
    }
    const reason = `${body?.error?.errors?.[0]?.reason ?? ""} ${body?.error?.status ?? ""}`;
    if (res.status === 401) throw new GmailSendError("auth", 401);
    if (res.status === 429 || (res.status === 403 && /rate|quota/i.test(reason))) throw new GmailSendError("rate_limit", res.status);
    if (res.status === 403) throw new GmailSendError("auth", 403); // permission was removed or the scope is missing
    if (res.status >= 500 || res.status === 408) throw new GmailSendError("transient", res.status);
    throw new GmailSendError("permanent", res.status);
  }

  /** Tells Google to cancel a token, so a disconnected account really loses access. Best effort: never throws. */
  async revoke(token: string): Promise<boolean> {
    try {
      const res = await this.doFetch(REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
