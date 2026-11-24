import { normalizeEmail } from "../../shared/email";
import type { Database } from "../database/client";
import { testRecipientsRepo } from "../database/repositories/test-recipients";
import { ApiError } from "../lib/errors";
import type { MimeInspection } from "../lib/mime";
import { EmailSendError, type EmailProvider, type IndividualEmail, type OutgoingEmail } from "./email-provider";

/**
 * The fixed message of the Gmail classification test. It is exactly what a person would type: plain text, no HTML, no
 * tracking, no campaign data, and none of the bulk-mail headers. Sending it through Sendrix and through Gmail on the web,
 * from the same account to the same inbox, shows whether the way Sendrix builds or submits mail changes where Gmail files it.
 */
export const DIAGNOSTIC_SUBJECT = "Quick question";
export const DIAGNOSTIC_BODY = "Hi John,\n\nJust checking if you received my previous message.\n\nThanks!";

/**
 * The same words laid out the way Gmail on the web sends them: a text part plus an HTML part wrapped in
 * `<div dir="ltr">`. Still a personal email: no unsubscribe header, no footer, no tracking.
 */
export const DIAGNOSTIC_WEB_LIKE_HTML =
  '<div dir="ltr">Hi John,<div><br></div><div>Just checking if you received my previous message.</div><div><br></div><div>Thanks!</div></div>';

/** "plain" is a single text/plain part; "web-like" is multipart/alternative, like a message written in Gmail on the web. */
export type DiagnosticVariant = "plain" | "web-like";

export interface DiagnosticResult {
  sent: boolean;
  /** Where it went (always an address on the test-send allowlist). */
  to: string;
  /** The message exactly as it was (or would be) submitted: headers and decoded parts. No credentials are in a message. */
  message: MimeInspection;
}

/**
 * Sends the diagnostic message to ONE address on the test-send allowlist, as an individual (one-to-one) email, through the
 * connected provider. With `dryRun` nothing is sent: only the message is built and returned. The headers are written to
 * the log (names and values of the message; never the body, an access token or a refresh token, which are not in it).
 */
export async function sendDiagnosticEmail(
  deps: { db: Database; email: EmailProvider },
  who: { userId: string; senderName: string },
  input: { to: string; dryRun: boolean; variant: DiagnosticVariant; fromName?: string | undefined },
): Promise<DiagnosticResult> {
  const wanted = normalizeEmail(input.to);
  const allowed = await testRecipientsRepo(deps.db, who.userId).emails();
  const to = allowed.find((a) => normalizeEmail(a) === wanted);
  if (!to) {
    throw new ApiError(400, "NOT_ON_ALLOWLIST", `Not on the test-send allowlist: ${input.to}`, [{ path: "to", message: "Only addresses on the test-send allowlist can be mailed" }]);
  }

  const channel = await deps.email.open(who.userId);
  // Never an unsubscribe header or a reply-to. "plain" has no HTML either, and the individual-email type cannot carry it.
  // `fromName` overrides the display name, so the name the mailbox itself uses (Gmail web uses it) can be compared with the Sendrix user's.
  const individual: IndividualEmail = { fromName: input.fromName ?? (channel.fromName || who.senderName), to, subject: DIAGNOSTIC_SUBJECT, text: DIAGNOSTIC_BODY };
  const message: OutgoingEmail = input.variant === "web-like" ? { ...individual, html: DIAGNOSTIC_WEB_LIKE_HTML } : individual;
  const inspected = channel.inspect(message);
  console.log(JSON.stringify({ level: "info", event: "diagnostic_email", userId: who.userId, provider: deps.email.id, dryRun: input.dryRun, variant: input.variant, headers: inspected.headers, parts: inspected.parts.map((p) => p.contentType) }));

  if (!input.dryRun) {
    try {
      await channel.send(message);
    } catch (e) {
      if (e instanceof EmailSendError && (e.kind === "auth" || e.kind === "rate_limit")) throw new ApiError(e.kind === "auth" ? 409 : 429, e.kind === "auth" ? "SENDER_RECONNECT" : "GMAIL_RATE_LIMITED", e.userMessage);
      throw new ApiError(502, "DIAGNOSTIC_SEND_FAILED", "The diagnostic email could not be sent");
    }
  }
  return { sent: !input.dryRun, to, message: inspected };
}
