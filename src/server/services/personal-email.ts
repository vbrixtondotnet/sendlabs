import type { PersonalEmailDto, PersonalEmailsDto } from "../../shared/api";
import { normalizeEmail } from "../../shared/email";
import { PERSONAL_EMAILS_PER_DAY, type PersonalEmailCreate } from "../../shared/schemas";
import type { Database } from "../database/client";
import { personalEmailsRepo } from "../database/repositories/personal-emails";
import { suppressionsRepo } from "../database/repositories/suppressions";
import { ApiError } from "../lib/errors";
import { escapeHtml } from "../lib/mime";
import { EmailSendError, type EmailProvider, type IndividualEmail } from "./email-provider";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT = 50;

/**
 * The same words as an HTML part, laid out exactly as Gmail on the web writes a message: the first line bare inside
 * `<div dir="ltr">`, every later line its own `<div>`, a blank line as `<div><br></div>`. Mail sent as a single text part
 * by a program was being filed as Spam; a mail program always sends text plus HTML, so this does too. Nothing is added:
 * the text is escaped, so it cannot become markup, and there is no footer, link or image.
 */
export function personalEmailHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const [first = "", ...rest] = lines;
  return `<div dir="ltr">${escapeHtml(first)}${rest.map((l) => `<div>${l.trim() === "" ? "<br>" : escapeHtml(l)}</div>`).join("")}</div>`;
}

export async function listPersonalEmails(db: Database, tenantId: string, provider: string): Promise<PersonalEmailsDto> {
  const repo = personalEmailsRepo(db, tenantId);
  const [items, sentToday] = await Promise.all([repo.recent(RECENT), repo.countSince(Date.now() - DAY_MS)]);
  return { items, sentToday, dailyLimit: PERSONAL_EMAILS_PER_DAY, provider };
}

/**
 * Sends one message, written by a person, to one person. It is an `IndividualEmail`: the words (as text plus the matching
 * mail-program HTML) with an optional Reply-To and nothing else, so it carries no unsubscribe footer and no
 * List-Unsubscribe header, and the type cannot carry them. It is not a way to reach a list, so:
 *  - an address on the suppression list is refused (someone who asked not to be emailed is not emailed here either);
 *  - at most PERSONAL_EMAILS_PER_DAY go out in 24 hours per organization.
 * It is sent in the connected mailbox's own name (the sender name), then the sending user's.
 */
export async function sendPersonalEmail(
  deps: { db: Database; email: EmailProvider },
  who: { tenantId: string; userId: string; senderName: string },
  input: PersonalEmailCreate,
): Promise<PersonalEmailDto> {
  const { db } = deps;
  const to = input.to.trim();
  const normalized = normalizeEmail(to);
  if (await suppressionsRepo(db, who.tenantId).has(normalized)) {
    throw new ApiError(409, "RECIPIENT_SUPPRESSED", "This address asked not to be emailed, so it cannot be sent to", [{ path: "to", message: "On your suppression list" }]);
  }
  const repo = personalEmailsRepo(db, who.tenantId);
  if ((await repo.countSince(Date.now() - DAY_MS)) >= PERSONAL_EMAILS_PER_DAY) {
    throw new ApiError(429, "PERSONAL_EMAIL_LIMIT", `You can send ${PERSONAL_EMAILS_PER_DAY} one-to-one emails in 24 hours. For more people, use a campaign`);
  }

  const channel = await deps.email.open(who.tenantId); // throws an actionable ApiError: not set up, no sender, reconnect
  const message: IndividualEmail = {
    fromName: channel.fromName || who.senderName,
    to,
    ...(input.replyTo ? { replyTo: input.replyTo.trim() } : {}),
    subject: input.subject,
    text: input.body,
    html: personalEmailHtml(input.body),
  };
  try {
    await channel.send(message);
  } catch (e) {
    if (e instanceof EmailSendError && (e.kind === "auth" || e.kind === "rate_limit")) {
      throw new ApiError(e.kind === "auth" ? 409 : 429, e.kind === "auth" ? "SENDER_RECONNECT" : "GMAIL_RATE_LIMITED", e.userMessage);
    }
    // The provider's own explanation, when it is one a person can act on (a From address it does not know, a bounced recipient).
    if (e instanceof EmailSendError && e.kind === "permanent") throw new ApiError(422, "PERSONAL_EMAIL_REJECTED", e.userMessage);
    console.error(JSON.stringify({ level: "error", event: "personal_email_failed", tenantId: who.tenantId, provider: deps.email.id, kind: e instanceof EmailSendError ? e.kind : "other" }));
    throw new ApiError(502, "PERSONAL_EMAIL_FAILED", "The email could not be sent. Please try again");
  }
  return repo.record({ recipient: to, normalizedRecipient: normalized, subject: input.subject, body: input.body, sentBy: who.userId });
}
