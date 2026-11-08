/**
 * Password hashing with PBKDF2-HMAC-SHA256 through WebCrypto, so it runs unchanged in Workers, Node and tests.
 *
 * Stored format: `pbkdf2-sha256$<iterations>$<salt base64>$<hash base64>`. The parameters travel with the
 * hash, so the cost can be raised later and old hashes still verify (and can be re-hashed on next sign-in).
 *
 * LIMIT: Cloudflare Workers refuse PBKDF2 above 100,000 iterations. That is below current OWASP guidance
 * for SHA-256 (600,000), so this is the strongest the platform allows, not the strongest that exists.
 * If that is not acceptable, move to a memory-hard hash (scrypt or Argon2) in WebAssembly.
 */

export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const SCHEME = "pbkdf2-sha256";

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordProblem } from "../../shared/password-rules";
import { PASSWORD_MAX_LENGTH } from "../../shared/password-rules";

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  // NFKC so the same visible password always hashes the same, whatever way the keyboard composed it.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, HASH_BYTES * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations: number = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `${SCHEME}$${iterations}$${toB64(salt)}$${toB64(hash)}`;
}

/** Compares without exiting early on the first differing byte. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/** False for a wrong password AND for a malformed stored value: callers never see the difference. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length === 0 || password.length > PASSWORD_MAX_LENGTH) return false;
  const [scheme, iterRaw, saltB64, hashB64, extra] = stored.split("$");
  if (scheme !== SCHEME || extra !== undefined || !iterRaw || !saltB64 || !hashB64) return false;
  const iterations = Number(iterRaw);
  // Refuse absurd values from a corrupted row rather than burning CPU on them.
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1_000_000) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromB64(saltB64);
    expected = fromB64(hashB64);
  } catch {
    return false;
  }
  if (expected.length !== HASH_BYTES || salt.length === 0) return false;
  return constantTimeEqual(await derive(password, salt, iterations), expected);
}

/** True when a stored hash was made with fewer iterations than today's setting: re-hash after a successful sign-in. */
export function needsRehash(stored: string): boolean {
  const iterations = Number(stored.split("$")[1]);
  return !Number.isInteger(iterations) || iterations < PBKDF2_ITERATIONS;
}
