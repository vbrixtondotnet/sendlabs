import type { Database } from "../../database/client";
import { senderRepo } from "../../database/repositories/sender";
import { decryptSecret } from "../../lib/crypto";
import { ApiError } from "../../lib/errors";
import { buildMime, inspectMime, toBase64Url, type OutgoingEmail as MimeEmail } from "../../lib/mime";
import { EmailSendError, type EmailChannel, type EmailProvider, type OutgoingEmail } from "../email-provider";
import { GmailSendError, GoogleError, type GoogleConfig, type GoogleOAuth } from "../google-oauth";

const RECONNECT_MESSAGE = "Google no longer accepts your Gmail connection. Reconnect it in Settings, then try again";

/**
 * Sends through the organization's connected Gmail account (OAuth). Everything Gmail-specific lives here: the saved
 * refresh token, the access-token refresh, the MIME message, and Gmail's error codes.
 */
export class GmailProvider implements EmailProvider {
  readonly id = "gmail";

  constructor(private readonly deps: { db: Database; google: GoogleOAuth; cfg: GoogleConfig | null }) {}

  async open(tenantId: string): Promise<EmailChannel> {
    const { db, google, cfg } = this.deps;
    if (!cfg) throw new ApiError(503, "GMAIL_NOT_CONFIGURED", "Gmail connection is not set up on this server yet");
    const senders = senderRepo(db, tenantId);
    const sender = await senders.get();
    if (!sender) throw new ApiError(409, "SENDER_REQUIRED", "Connect a Gmail account in Settings before sending email");
    if (sender.status !== "Connected") throw new ApiError(409, "SENDER_RECONNECT", "Reconnect your Gmail account in Settings before sending email");

    // A rejected connection is remembered, so Settings asks for it to be redone.
    const reconnect = async () => {
      await senders.markNeedsReconnect();
      return new ApiError(409, "SENDER_RECONNECT", RECONNECT_MESSAGE);
    };

    let refreshToken: string;
    try {
      refreshToken = await decryptSecret(sender.refreshTokenEncrypted, cfg.encryptionKey, `sender-refresh-token:${tenantId}`);
    } catch {
      throw await reconnect();
    }
    let accessToken: string;
    try {
      accessToken = await google.refreshAccessToken(cfg, refreshToken);
    } catch (e) {
      if (e instanceof GoogleError && e.googleCode === "invalid_grant") throw await reconnect();
      throw new EmailSendError("transient"); // Google could not be reached or answered badly: the caller reports a failed send
    }

    // The one place a message is turned into Gmail's format, so what is inspected is exactly what is sent.
    const build = (m: OutgoingEmail): MimeEmail => ({
      from: sender.email,
      fromName: m.fromName,
      to: m.to,
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      subject: m.subject,
      text: m.text,
      ...(m.html === undefined ? {} : { html: m.html }),
      ...(m.listUnsubscribe ? { listUnsubscribe: m.listUnsubscribe } : {}),
      ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    });

    return {
      fromName: sender.senderName,
      inspect: (m) => inspectMime(buildMime(build(m))),
      send: async (m) => {
        try {
          await google.sendMessage(accessToken, toBase64Url(buildMime(build(m))));
        } catch (e) {
          if (e instanceof GmailSendError) {
            if (e.kind === "auth") {
              await senders.markNeedsReconnect();
              throw new EmailSendError("auth", RECONNECT_MESSAGE);
            }
            if (e.kind === "rate_limit") throw new EmailSendError("rate_limit", "Gmail is limiting sending from this account right now. Try again later");
            throw new EmailSendError(e.kind);
          }
          throw e;
        }
      },
    };
  }
}
