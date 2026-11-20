import type { Context } from "hono";
import type { AppEnv } from "../app";
import type { Database } from "../database/client";
import type { EmailProvider } from "./email-provider";
import { googleConfig, type GoogleConfig, type GoogleOAuth } from "./google-oauth";
import { GmailProvider } from "./providers/gmail";
import { PostmarkProvider, postmarkConfig } from "./providers/postmark";

/** What the adapters may need. Add a field here when a new provider needs one (an HTTP client for SendGrid, say). */
export interface ProviderDeps {
  db: Database;
  google: GoogleOAuth;
  googleConfig: GoogleConfig | null;
  /** The HTTP client for providers that call a web API. Injected so tests never reach the real service. */
  fetch?: typeof fetch;
}

/** The settings the providers read from the environment. */
export interface ProviderEnv {
  EMAIL_PROVIDER?: string;
  POSTMARK_SERVER_TOKEN?: string;
  POSTMARK_FROM?: string;
  POSTMARK_FROM_NAME?: string;
  POSTMARK_MESSAGE_STREAM?: string;
}

/**
 * The one place that knows which providers exist. `EMAIL_PROVIDER` picks one ("gmail" by default). To add SendGrid or
 * Mailgun: implement `EmailProvider` in `providers/`, add its `case` here, set `EMAIL_PROVIDER`. Nothing else changes.
 */
export function emailProviderFor(env: ProviderEnv, deps: ProviderDeps): EmailProvider {
  const id = (env.EMAIL_PROVIDER?.trim() || "gmail").toLowerCase(); // unset or empty: the default
  switch (id) {
    case "gmail":
      return new GmailProvider({ db: deps.db, google: deps.google, cfg: deps.googleConfig });
    case "postmark":
      return new PostmarkProvider(postmarkConfig(env), deps.fetch);
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${id}". Supported: gmail, postmark`);
  }
}

/**
 * The provider for the current request. EVERY feature that sends email (a campaign's test send, one-to-one email, the
 * diagnostic) gets its provider here, so they always use the same one: `EMAIL_PROVIDER`, which is Gmail (the connected
 * Google account, through OAuth) unless it says otherwise.
 */
export function emailProviderForRequest(c: Context<AppEnv>): EmailProvider {
  return emailProviderFor(c.env, { db: c.get("db"), google: c.get("google"), googleConfig: googleConfig(c.env), fetch: c.get("fetch") });
}
