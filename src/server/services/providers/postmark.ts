import { bytesToB64 } from "../../lib/attachments";
import { ApiError } from "../../lib/errors";
import type { MimeInspection } from "../../lib/mime";
import { EmailSendError, type EmailChannel, type EmailProvider, type OutgoingEmail } from "../email-provider";

const POSTMARK_URL = "https://api.postmarkapp.com/email";

/** Everything Postmark needs, read from the environment. Nothing is stored per organization. */
export interface PostmarkConfig {
  /** The Server API token. A secret: it travels only in the `X-Postmark-Server-Token` header, and is never logged or returned. */
  token: string;
  /** The From address. Postmark only sends from a confirmed Sender Signature, or from an address on a verified domain. */
  from: string;
  /** The name shown on the From line, "" for none (the sending user's name is then used). */
  fromName: string;
  /** "outbound" is Postmark's transactional stream, which suits one-to-one mail. */
  messageStream: string;
}

/**
 * Reads the Postmark settings. Null unless there is a token and a From address, so "not configured" is one clear state.
 *   POSTMARK_SERVER_TOKEN   the Server API token (SECRET)
 *   POSTMARK_FROM           the confirmed From address, e.g. discovery@yourcompany.com
 *   POSTMARK_FROM_NAME      optional display name
 *   POSTMARK_MESSAGE_STREAM optional, default "outbound"
 */
export function postmarkConfig(env: { POSTMARK_SERVER_TOKEN?: string; POSTMARK_FROM?: string; POSTMARK_FROM_NAME?: string; POSTMARK_MESSAGE_STREAM?: string }): PostmarkConfig | null {
  const token = env.POSTMARK_SERVER_TOKEN?.trim();
  const from = env.POSTMARK_FROM?.trim();
  if (!token || !from) return null;
  return { token, from, fromName: env.POSTMARK_FROM_NAME?.trim() ?? "", messageStream: env.POSTMARK_MESSAGE_STREAM?.trim() || "outbound" };
}

/** `Marketing Admin <discovery@acme.com>`, or just the address. Quotes, angle brackets and line breaks are removed from the name. */
function fromHeader(name: string, address: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f"<>\\]+/g, " ").replace(/\s+/g, " ").trim();
  return clean ? `${clean} <${address}>` : address;
}

/** The JSON Postmark's `/email` endpoint takes. Opens and links are never tracked. */
export function postmarkPayload(cfg: PostmarkConfig, m: OutgoingEmail) {
  return {
    From: fromHeader(m.fromName, cfg.from),
    To: m.to,
    Subject: m.subject,
    TextBody: m.text,
    ...(m.html === undefined ? {} : { HtmlBody: m.html }),
    ...(m.replyTo ? { ReplyTo: m.replyTo } : {}),
    ...(m.listUnsubscribe
      ? {
          Headers: [
            { Name: "List-Unsubscribe", Value: `<${m.listUnsubscribe.url}>` },
            ...(m.listUnsubscribe.oneClick ? [{ Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" }] : []),
          ],
        }
      : {}),
    ...(m.attachments?.length ? { Attachments: m.attachments.map((a) => ({ Name: a.filename, Content: bytesToB64(a.content), ContentType: a.contentType })) } : {}),
    MessageStream: cfg.messageStream,
    TrackOpens: false,
    TrackLinks: "None",
  };
}

/** Postmark's error codes that mean what they say to the person, worded for them. The rest show Postmark's own message. */
function failureFrom(status: number, code: number | null, message: string): EmailSendError {
  if (status === 401 || code === 10) return new EmailSendError("auth", "Postmark did not accept the API token. Check POSTMARK_SERVER_TOKEN");
  if (status === 429) return new EmailSendError("rate_limit", "Postmark is limiting sending right now. Try again later");
  if (code === 400) return new EmailSendError("permanent", "Postmark does not recognise the From address. Confirm it as a Sender Signature, or verify its domain, in Postmark");
  if (code === 406) return new EmailSendError("permanent", "Postmark will not send to this address: it bounced or was reported as spam before");
  if (status >= 500) return new EmailSendError("transient");
  // Other 4xx: the message is Postmark's explanation of what is wrong with the request (never a credential).
  return new EmailSendError("permanent", `Postmark rejected the email: ${message.slice(0, 300)}`);
}

/**
 * Sends through Postmark's HTTP API with one Server API token from the environment. No per-organization connection: the
 * token and the From address are the server's. `doFetch` is injectable so the API can be tested without the real service.
 */
export class PostmarkProvider implements EmailProvider {
  readonly id = "postmark";

  constructor(private readonly cfg: PostmarkConfig | null, private readonly doFetch: typeof fetch = (...a) => fetch(...a)) {}

  async open(): Promise<EmailChannel> {
    const cfg = this.cfg;
    if (!cfg) throw new ApiError(503, "POSTMARK_NOT_CONFIGURED", "Postmark is not set up on this server yet");
    const doFetch = this.doFetch;

    return {
      fromName: cfg.fromName,
      inspect: (m): MimeInspection => {
        const p = postmarkPayload(cfg, m);
        return {
          headers: [
            { name: "From", value: p.From },
            { name: "To", value: p.To },
            { name: "Subject", value: p.Subject },
            ...(p.ReplyTo ? [{ name: "Reply-To", value: p.ReplyTo }] : []),
            ...(p.Headers ?? []).map((h) => ({ name: h.Name, value: h.Value })),
          ],
          parts: [{ contentType: "text/plain", text: p.TextBody }, ...(p.HtmlBody === undefined ? [] : [{ contentType: "text/html", text: p.HtmlBody }])],
        };
      },
      send: async (m) => {
        let res: Response;
        try {
          res = await doFetch(POSTMARK_URL, {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json", "x-postmark-server-token": cfg.token },
            body: JSON.stringify(postmarkPayload(cfg, m)),
          });
        } catch {
          throw new EmailSendError("transient"); // Postmark could not be reached
        }
        let body: { ErrorCode?: number; Message?: string } = {};
        try {
          body = (await res.json()) as typeof body;
        } catch {
          /* a non-JSON answer: judged by its status alone */
        }
        const code = typeof body.ErrorCode === "number" ? body.ErrorCode : null;
        if (res.ok && (code === null || code === 0)) return;
        throw failureFrom(res.status, code, typeof body.Message === "string" ? body.Message : "");
      },
    };
  }
}
