import type { JobApplicationEmail } from "../../shared/schemas";
import type { EmailAttachment } from "../lib/attachments";
import { ApiError } from "../lib/errors";
import { EmailSendError, type EmailProvider } from "./email-provider";

/** Emails one person can send from the Apply panel in an hour: it is a way to write to an employer, not to mass-mail. */
export const MAX_APPLICATION_EMAILS_PER_HOUR = 20;

/** When each person last sent (per Worker instance: a best-effort brake, not a ledger; nothing is stored). */
const sentAt = new Map<string, number[]>();

function takeTurn(userId: string, now: number): void {
  const recent = (sentAt.get(userId) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= MAX_APPLICATION_EMAILS_PER_HOUR) {
    sentAt.set(userId, recent);
    throw new ApiError(429, "TOO_MANY_EMAILS", `You can send at most ${MAX_APPLICATION_EMAILS_PER_HOUR} application emails an hour. Please try again later`);
  }
  sentAt.set(userId, [...recent, now]);
}

/** Forgets who sent what (tests). */
export function resetApplicationEmailLimits(): void {
  sentAt.clear();
}

export interface ApplicationEmailDeps {
  /** Whatever delivers the mail (the organization's Gmail today). This code knows nothing about which. */
  email: EmailProvider;
  tenantId: string;
  userId: string;
  /** The name shown on the From line when the sender connection has none: the person's own. */
  fallbackFromName: string;
  now?: () => number;
}

/**
 * Sends ONE personally written email, plain text, to ONE address, with its attachments: no CC, no BCC, no unsubscribe link, no
 * tracking, nothing added to the words. It goes out as the organization's connected sender (the Gmail account), the way the person
 * would write from it. Throws an ApiError the person can act on.
 */
export async function sendApplicationEmail(deps: ApplicationEmailDeps, fields: JobApplicationEmail, attachments: EmailAttachment[]): Promise<void> {
  const { email, tenantId } = deps;
  takeTurn(deps.userId, (deps.now ?? Date.now)());

  const failed = (e: unknown) => {
    if (e instanceof EmailSendError && (e.kind === "auth" || e.kind === "rate_limit")) {
      return new ApiError(e.kind === "auth" ? 409 : 429, e.kind === "auth" ? "SENDER_RECONNECT" : "GMAIL_RATE_LIMITED", e.userMessage);
    }
    console.error(JSON.stringify({ level: "error", event: "application_email_failed", tenantId, provider: email.id, kind: e instanceof EmailSendError ? e.kind : "other" }));
    return new ApiError(502, "EMAIL_SEND_FAILED", "The email could not be sent. Please try again");
  };

  // Opening throws an actionable ApiError (not set up, no sender, reconnect), or an EmailSendError if the provider is down.
  const channel = await email.open(tenantId).catch((e: unknown) => { throw e instanceof EmailSendError ? failed(e) : e; });
  try {
    await channel.send({ fromName: channel.fromName || deps.fallbackFromName, to: fields.to, subject: fields.subject, text: fields.body, ...(attachments.length ? { attachments } : {}) });
  } catch (e) {
    throw failed(e);
  }
  console.log(JSON.stringify({ level: "info", event: "application_email_sent", tenantId, provider: email.id, attachments: attachments.length }));
}
