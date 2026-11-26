import { z } from "zod";
import { EmailSendError } from "./email-provider";

/**
 * The SYSTEM's own sender: mail Sendrix itself sends to a person (today the "application sent" confirmation), as opposed to the mail a
 * person sends from their own Gmail (`email-provider.ts`). It goes out through Cloudflare Email Service's REST API
 * (https://developers.cloudflare.com/email-service/api/send-emails/rest-api/) from an address on a domain onboarded for Email Sending
 * (jobs@sendrix.app). One code path serves local development and deployment; the same call can later be swapped for the Workers
 * `send_email` binding without touching the callers.
 *
 * Settings (all in the environment, never in code): CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_EMAIL_API_TOKEN (a token with the "Email Sending: Edit"
 * permission: it is only ever sent to api.cloudflare.com, and is never put in an error or a log), SYSTEM_EMAIL_FROM, SYSTEM_EMAIL_FROM_NAME.
 * Without the account id and token there is no system mailer and nothing is sent.
 */

export const DEFAULT_FROM = "jobs@sendrix.app";
export const DEFAULT_FROM_NAME = "Sendrix";
const TIMEOUT_MS = 10_000;

export interface SystemMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SystemMailer {
  /** Sends one message to one recipient. Throws `EmailSendError`. */
  send(mail: SystemMail): Promise<void>;
}

export interface SystemMailEnv {
  CLOUDFLARE_ACCOUNT_ID?: string | undefined;
  CLOUDFLARE_EMAIL_API_TOKEN?: string | undefined;
  SYSTEM_EMAIL_FROM?: string | undefined;
  SYSTEM_EMAIL_FROM_NAME?: string | undefined;
}

export interface SystemMailConfig {
  accountId: string;
  token: string;
  from: string;
  fromName: string;
}

/** The settings, or null when sending is not set up (no account id or token, or an account id that is not a Cloudflare account id). */
export function systemMailConfig(env: SystemMailEnv): SystemMailConfig | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const token = env.CLOUDFLARE_EMAIL_API_TOKEN?.trim() ?? "";
  if (!/^[0-9a-f]{32}$/i.test(accountId) || token === "") return null; // the id goes into a URL: only a real one is accepted
  const from = env.SYSTEM_EMAIL_FROM?.trim() || DEFAULT_FROM;
  if (!/^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/.test(from)) return null;
  return { accountId, token, from, fromName: (env.SYSTEM_EMAIL_FROM_NAME?.trim() || DEFAULT_FROM_NAME).replace(/[\r\n"<>]/g, " ").slice(0, 80) };
}

const answer = z.object({
  success: z.boolean().optional(),
  errors: z.array(z.object({ code: z.number().optional(), message: z.string().optional() }).passthrough()).optional(),
  result: z
    .object({ delivered: z.array(z.string()).optional(), queued: z.array(z.string()).optional(), permanent_bounces: z.array(z.string()).optional() })
    .passthrough()
    .nullish(),
});

/** Cloudflare's HTTP status and error code mapped onto the kinds every sender uses. The message never holds the token. */
function failureFrom(status: number, code: number | null): EmailSendError {
  if (status === 401 || (status === 403 && (code === 10102 || code === 10105))) return new EmailSendError("auth", "Cloudflare did not accept the email API token or the account may not send email");
  if (status === 403) return new EmailSendError("permanent", "Cloudflare will not send this email (sending is restricted for the account)");
  if (status === 429) return new EmailSendError("rate_limit", "Cloudflare is limiting sending right now");
  if (status >= 500) return new EmailSendError("transient");
  return new EmailSendError("permanent", "Cloudflare rejected the email");
}

/** Cloudflare Email Service over its REST API. `doFetch` is injectable so tests never reach the real service. */
export class CloudflareEmailMailer implements SystemMailer {
  constructor(private readonly cfg: SystemMailConfig, private readonly doFetch: typeof fetch = (...a) => fetch(...a)) {}

  async send(mail: SystemMail): Promise<void> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.cfg.accountId}/email/sending/send`;
    let res: Response;
    try {
      res = await this.doFetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.cfg.token}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ to: mail.to, from: { address: this.cfg.from, name: this.cfg.fromName }, subject: mail.subject, text: mail.text, html: mail.html }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new EmailSendError("transient"); // Cloudflare could not be reached, or took too long
    }
    let body: z.infer<typeof answer> = {};
    try {
      const parsed = answer.safeParse(await res.json());
      if (parsed.success) body = parsed.data;
    } catch {
      /* a non-JSON answer: judged by its status alone */
    }
    if (!res.ok || body.success === false) throw failureFrom(res.status, body.errors?.[0]?.code ?? null);
    if (body.result?.permanent_bounces?.some((a) => a.toLowerCase() === mail.to.toLowerCase())) throw new EmailSendError("permanent", "The address does not accept email");
  }
}

/** The system mailer for this environment, or null when it is not set up. */
export function systemMailerFor(env: SystemMailEnv, doFetch?: typeof fetch): SystemMailer | null {
  const cfg = systemMailConfig(env);
  return cfg ? new CloudflareEmailMailer(cfg, doFetch) : null;
}
