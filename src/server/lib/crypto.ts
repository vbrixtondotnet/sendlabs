/**
 * Small helpers over WebCrypto, so they run unchanged in Workers, Node and tests.
 *
 * Secrets at rest use AES-256-GCM. The key is a Worker secret (TOKEN_ENCRYPTION_KEY, 32 random bytes, base64),
 * never stored in the database next to what it protects. Every ciphertext is bound to a context string
 * ("additional authenticated data") such as the tenant it belongs to: GCM then refuses to decrypt it anywhere
 * else, so a ciphertext copied into another tenant's row is useless.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64Url = (b: Uint8Array) => toB64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

/** A URL-safe random value, 32 bytes (256 bits) by default. For OAuth `state` and PKCE verifiers. */
export function randomToken(bytes = 32): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** SHA-256, base64url. Used for the PKCE code challenge and to store `state` values as hashes. */
export async function sha256Base64Url(value: string): Promise<string> {
  return toB64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))));
}

/** The key must be exactly 32 bytes of base64. Anything else is a configuration error, never "close enough". */
export function isValidEncryptionKey(keyB64: string | undefined): keyB64 is string {
  if (!keyB64) return false;
  try {
    return fromB64(keyB64).length === 32;
  } catch {
    return false;
  }
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  if (!isValidEncryptionKey(keyB64)) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return crypto.subtle.importKey("raw", fromB64(keyB64), "AES-GCM", false, ["encrypt", "decrypt"]);
}

const VERSION = "v1";

/** `v1.<iv>.<ciphertext>`. A fresh random IV every time, so sealing the same value twice gives different output. */
export async function encryptSecret(plaintext: string, keyB64: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(context) }, await importKey(keyB64), enc.encode(plaintext));
  return `${VERSION}.${toB64(iv)}.${toB64(new Uint8Array(sealed))}`;
}

/** Throws one generic error for every failure (wrong key, wrong context, tampering, bad format): no hints. */
export async function decryptSecret(sealed: string, keyB64: string, context: string): Promise<string> {
  const fail = () => new Error("Could not decrypt the stored secret");
  const [version, ivB64, ctB64, extra] = sealed.split(".");
  if (version !== VERSION || !ivB64 || !ctB64 || extra !== undefined) throw fail();
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(ivB64), additionalData: enc.encode(context) },
      await importKey(keyB64),
      fromB64(ctB64),
    );
    return dec.decode(plain);
  } catch {
    throw fail();
  }
}
