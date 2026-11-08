/**
 * Settings that are NOT in wrangler.jsonc, so `wrangler types` does not know them.
 *
 *  - Local development: put them in `.dev.vars` (git-ignored). See `.dev.vars.example`.
 *  - Staging / production: `wrangler secret put <NAME> --env <env>`.
 *
 * All optional on purpose: when any is missing, the Gmail connection reports "not configured" instead of crashing.
 */
interface Env {
  /** Google Cloud OAuth client id (Web application). Not secret, but supplied per environment. */
  GOOGLE_CLIENT_ID?: string;
  /** SECRET. Google Cloud OAuth client secret. */
  GOOGLE_CLIENT_SECRET?: string;
  /** SECRET. 32 random bytes, base64. Encrypts the stored Gmail refresh tokens. Generate: `openssl rand -base64 32`. */
  TOKEN_ENCRYPTION_KEY?: string;
  /**
   * Local development shortcut only: when set (in `.dev.vars`), a request with no session runs as this user, so the API
   * can be tried without signing in. Unset by default, so locally you sign in through the login page. Ignored outside
   * the local environment.
   */
  DEV_ACTOR_EMAIL?: string;
}
