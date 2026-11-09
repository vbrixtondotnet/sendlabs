import { isValidEncryptionKey } from "./crypto";
import { ApiError } from "./errors";

/**
 * Unsubscribe links carry a SIGNED token, not a database id: it says which tenant, which address and which campaign,
 * and an HMAC (SHA-256, keyed from TOKEN_ENCRYPTION_KEY with its own purpose label) proves we made it. Nobody can forge
 * a link for another address, and there is nothing to look up or guess. It never expires: a link in an old email must
 * keep working. The address is readable inside the token (it is only base64url), which is fine: it is the recipient's own.
 *
 * A "test" token (from a test send) opens the real page but unsubscribes nobody.
 */
export interface UnsubscribePayload {
  tenantId: string;
  /** Trimmed and lower-cased. */
  email: string;
  campaignId: string | null;
  test: boolean;
}

const PURPOSE = "sendrix-unsubscribe-v1";
const MAX_TOKEN_LENGTH = 1024;
const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64Url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
function fromB64Url(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad), (c) => c.charCodeAt(0));
}

async function hmacKey(keyB64: string): Promise<CryptoKey> {
  if (!isValidEncryptionKey(keyB64)) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return crypto.subtle.importKey("raw", Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** The signing key from the environment, or a 503 if this server has none (so nothing is ever signed with a bad key). */
export function unsubscribeKey(env: { TOKEN_ENCRYPTION_KEY?: string | undefined }): string {
  if (!isValidEncryptionKey(env.TOKEN_ENCRYPTION_KEY)) throw new ApiError(503, "UNSUBSCRIBE_NOT_CONFIGURED", "Unsubscribe links are not set up on this server yet");
  return env.TOKEN_ENCRYPTION_KEY;
}

export async function createUnsubscribeToken(keyB64: string, p: UnsubscribePayload): Promise<string> {
  const payload = toB64Url(enc.encode(JSON.stringify({ t: p.tenantId, e: p.email, c: p.campaignId, k: p.test ? "t" : "l" })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(keyB64), enc.encode(`${PURPOSE}.${payload}`)));
  return `${payload}.${toB64Url(sig)}`;
}

/** The payload if the token is genuine, otherwise null. One answer for every kind of bad token: no hints. */
export async function readUnsubscribeToken(keyB64: string, token: string): Promise<UnsubscribePayload | null> {
  try {
    if (token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
    const [payload, sig] = token.split(".") as [string, string];
    // `verify` compares in constant time.
    if (!(await crypto.subtle.verify("HMAC", await hmacKey(keyB64), fromB64Url(sig), enc.encode(`${PURPOSE}.${payload}`)))) return null;
    const data = JSON.parse(dec.decode(fromB64Url(payload))) as { t?: unknown; e?: unknown; c?: unknown; k?: unknown };
    if (typeof data.t !== "string" || typeof data.e !== "string" || !data.t || !data.e || data.e.length > 320) return null;
    if (data.c !== null && typeof data.c !== "string") return null;
    if (data.k !== "t" && data.k !== "l") return null;
    return { tenantId: data.t, email: data.e, campaignId: data.c, test: data.k === "t" };
  } catch {
    return null;
  }
}

/**
 * The two addresses for one recipient: the PAGE a person opens from the link in the email body, and the endpoint a mail
 * app POSTs to for one-click unsubscribe (the `List-Unsubscribe` header). Both carry the same token.
 */
export function unsubscribeLinks(appBaseUrl: string, token: string): { page: string; oneClick: string } {
  const base = appBaseUrl.replace(/\/+$/, "");
  return { page: `${base}/unsubscribe/${token}`, oneClick: `${base}/api/unsubscribe/${token}` };
}
