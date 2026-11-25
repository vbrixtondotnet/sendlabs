/**
 * Settings that are NOT in wrangler.jsonc, so `wrangler types` does not know them.
 *
 *  - Local development: put them in `.dev.vars` (git-ignored). See `.dev.vars.example`.
 *  - Staging / production: `wrangler secret put <NAME> --env <env>`.
 *
 * All optional on purpose: when any is missing, the Gmail connection reports "not configured" instead of crashing.
 */
interface Env {
  /** PostgreSQL connection string for development, tests and scripts. In production the HYPERDRIVE binding is used instead. */
  DATABASE_URL?: string;
  /** Google Cloud OAuth client id (Web application). Not secret, but supplied per environment. */
  GOOGLE_CLIENT_ID?: string;
  /** SECRET. Google Cloud OAuth client secret. */
  GOOGLE_CLIENT_SECRET?: string;
  /** SECRET. 32 random bytes, base64. Encrypts the stored Gmail refresh tokens. Generate: `openssl rand -base64 32`. */
  TOKEN_ENCRYPTION_KEY?: string;
  /**
   * Turns on the temporary Gmail classification test (`POST /api/sender/diagnostic`): "true" to enable. Off (404) when
   * unset, so a deployed app cannot be made to send test mail by mistake.
   */
  ENABLE_EMAIL_DIAGNOSTICS?: string;
  /**
   * The public HTTPS address the unsubscribe links in campaign emails point at, e.g. https://sabertoothsoftwarelabs.net. Used
   * for those links only: APP_BASE_URL still drives sign-in and the same-site check, so the app can keep running on localhost.
   * Unset or invalid, the links use APP_BASE_URL. Whatever it is, /unsubscribe/* and /api/unsubscribe/* must reach this app.
   */
  UNSUBSCRIBE_BASE_URL?: string;
  /**
   * "true" opens sign-in and the protected API for a deployment outside local development. Anything else (or nothing) keeps it
   * closed. Set in wrangler.jsonc vars for an environment that should be usable; see src/server/lib/auth-enabled.ts.
   */
  AUTH_ENABLED?: string;
  /** SECRET. Postmark Server API token (used when the provider is "postmark"). Put it in `.dev.vars`, never in the code. */
  POSTMARK_SERVER_TOKEN?: string;
  /** The From address for Postmark. It must be a confirmed Sender Signature, or on a verified domain, in Postmark. */
  POSTMARK_FROM?: string;
  /** Optional display name on Postmark's From line. */
  POSTMARK_FROM_NAME?: string;
  /** Optional Postmark message stream. Default "outbound" (transactional). */
  POSTMARK_MESSAGE_STREAM?: string;
  /** Which service delivers email: "gmail" (the default). See services/email-providers.ts for how to add another. */
  EMAIL_PROVIDER?: string;
  /**
   * SECRET. Jooble API key (free: https://jooble.org/api/about). Optional: without it the Jobs page simply does not use Jooble. Put it in
   * `.dev.vars`, or `wrangler secret put JOOBLE_API_KEY --env <env>`. It is sent only to jooble.org, in the request address.
   */
  JOOBLE_API_KEY?: string;
  /**
   * SECRET. Hunter.io API key (https://hunter.io/api-keys). Optional: without it "Get Email Address" in the Apply panel is switched off.
   * Put it in `.dev.vars`, or `wrangler secret put HUNTER_API_KEY --env <env>`. It is sent only to api.hunter.io.
   */
  HUNTER_API_KEY?: string;
  /**
   * Local development shortcut only: when set (in `.dev.vars`), a request with no session runs as this user, so the API
   * can be tried without signing in. Unset by default, so locally you sign in through the login page. Ignored outside
   * the local environment.
   */
  DEV_ACTOR_EMAIL?: string;
}
