import type { EmailAttachment } from "../lib/attachments";
import type { MimeInspection } from "../lib/mime";

/**
 * The seam between Sendrix and whatever actually delivers mail (Gmail today; SendGrid or Mailgun later).
 *
 * Everything that SENDS (the test send now, the campaign sender later) talks only to these types: it composes a
 * provider-neutral `OutgoingEmail` and hands it to a channel. Nothing outside a provider adapter knows about Gmail's
 * MIME-and-base64 API, OAuth refresh tokens, or any vendor's JSON. To add a provider:
 *
 *   1. Write an adapter in `providers/` that implements `EmailProvider` (see `providers/gmail.ts`).
 *   2. Add one `case` for it in `email-providers.ts`.
 *   3. Set `EMAIL_PROVIDER` to its id. The composing code, routes and UI do not change.
 */

/** One message to one recipient. Provider-neutral: each adapter turns it into its own wire format. */
export interface OutgoingEmail {
  /** The name recipients see on the From line. The address comes from the provider's connected sender. */
  fromName: string;
  to: string;
  /** Where replies go when that is not the sender. Adapters add a Reply-To header only when this is set. */
  replyTo?: string;
  subject: string;
  /** Always present. When `html` is absent the message is sent as plain text only. */
  text: string;
  html?: string;
  /** The RFC 8058 unsubscribe link for the headers. Adapters that cannot set custom headers may ignore it. */
  listUnsubscribe?: { url: string; oneClick: boolean };
  /** Files to attach. Only personally written mail uses them; campaigns never do. */
  attachments?: EmailAttachment[];
}

/**
 * A one-to-one message, written by a person to a person: nothing but the sender, one recipient, the words, and an optional
 * Reply-To. `html` is only the same words laid out the way a mail program sends them (a text part plus an HTML part, as
 * Gmail on the web does), never a design. The type cannot carry bulk-mail pieces (an unsubscribe header), so a personal
 * email can never pick them up by accident. Campaign mail uses the full `OutgoingEmail`, with the unsubscribe headers
 * that Google requires of it.
 */
export type IndividualEmail = Pick<OutgoingEmail, "fromName" | "to" | "replyTo" | "subject" | "text" | "html" | "attachments">;

/** Why a send failed, in terms every provider can map its errors onto. */
export type SendFailureKind =
  /** The provider rejected our credentials: the connection needs to be set up again. */
  | "auth"
  /** The provider is limiting us: try again later. */
  | "rate_limit"
  /** A temporary problem: the same message may succeed if retried. */
  | "transient"
  /** The provider refused this message: retrying it will not help. */
  | "permanent";

export class EmailSendError extends Error {
  /** `userMessage` is shown to the person for "auth" and "rate_limit", so the adapter words it for its own service. */
  constructor(readonly kind: SendFailureKind, readonly userMessage: string = "The email could not be sent") {
    super(`Email send failed (${kind})`);
    this.name = "EmailSendError";
  }
}

/** A ready-to-use connection to the provider for one organization. */
export interface EmailChannel {
  /** The name this sender is set up to show on the From line, "" when none was set. Callers fall back to their own. */
  readonly fromName: string;
  /** Sends one message. Throws `EmailSendError`. */
  send(message: OutgoingEmail): Promise<void>;
  /** The exact message `send` would submit, as readable headers and decoded parts. Nothing is sent. For diagnostics. */
  inspect(message: OutgoingEmail): MimeInspection;
}

export interface EmailProvider {
  /** Stable id, as set in `EMAIL_PROVIDER`: "gmail", "sendgrid", "mailgun". */
  readonly id: string;
  /**
   * Gets a channel for an organization, doing whatever the provider needs first (loading its saved connection or API
   * key, refreshing a token). Throws an `ApiError` the person can act on when sending is not possible: not configured,
   * no sender connected, or the connection must be redone.
   */
  open(tenantId: string): Promise<EmailChannel>;
}
