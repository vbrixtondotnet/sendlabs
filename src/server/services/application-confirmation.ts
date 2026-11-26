import { escapeHtml } from "../lib/mime";
import type { SystemMail, SystemMailer } from "./system-mail";

/** One line of text: no control characters, single spaces, at most `max` characters. */
const oneLine = (v: string | undefined, max: number) => (v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export interface ApplicationConfirmation {
  /** The account's own address: where the confirmation goes (never the employer's). */
  to: string;
  /** The person's first name, for the greeting. */
  firstName: string;
  jobTitle?: string | undefined;
  companyName?: string | undefined;
  /** When the application was sent. */
  sentAt: Date;
}

/** "November 26, 2026" (the day it was sent, in UTC). */
export const applicationDate = (d: Date): string => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/**
 * The "your application has been successfully submitted" email, worded as Sendrix Jobs specifies:
 *
 *   Hi {{FirstName}}, ... your application for {{JobTitle}} at {{CompanyName}} has been successfully submitted to the employer ...
 *   Application Details: Position, Company, Date Applied, Application Status: Submitted ...
 *
 * Never the application message itself. Plain and transactional: no tracking, no marketing, no unsubscribe link. Everything that came from
 * a person is cleaned and escaped. When the job's title or company is not known the sentence and the detail line say less, never "undefined".
 */
export function buildApplicationConfirmation(a: ApplicationConfirmation): SystemMail {
  const first = oneLine(a.firstName, 80) || "there";
  const title = oneLine(a.jobTitle, 200);
  const company = oneLine(a.companyName, 200);
  const date = applicationDate(a.sentAt);
  const forWhat = `${title || "the position"}${company ? ` at ${company}` : ""}`;

  const intro = "Thank you for applying through Sendrix Jobs!";
  const confirm = `We're pleased to confirm that your application for ${forWhat} has been successfully submitted to the employer.`;
  const details: [string, string][] = [
    ...(title ? ([["Position", title]] as [string, string][]) : []),
    ...(company ? ([["Company", company]] as [string, string][]) : []),
    ["Date Applied", date],
    ["Application Status", "Submitted"],
  ];
  const next = "The employer can now review your application. If your qualifications match their requirements, they may contact you directly through your registered email address.";
  const thanks = "Thank you for using Sendrix Jobs in your career journey. We wish you the best of luck!";

  const text = [
    `Hi ${first},`, "", intro, "", confirm, "",
    "Application Details", "", ...details.flatMap(([k, v]) => [`${k}: ${v}`, ""]),
    next, "", thanks, "", "Best regards,", "The Sendrix Jobs Team",
  ].join("\n");

  const p = (t: string) => `<p style="margin:0 0 14px">${escapeHtml(t)}</p>`;
  const html = [
    '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">',
    p(`Hi ${first},`),
    p(intro),
    p(confirm),
    '<p style="margin:0 0 6px"><strong>Application Details</strong></p>',
    '<table style="border-collapse:collapse;font-size:14px;margin:0 0 14px">',
    ...details.map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;color:#475569">${escapeHtml(k)}:</td><td style="padding:2px 0"><strong>${escapeHtml(v)}</strong></td></tr>`),
    "</table>",
    p(next),
    p(thanks),
    '<p style="margin:0">Best regards,<br>The Sendrix Jobs Team</p>',
    "</div>",
  ].join("\n");

  return { to: a.to, subject: "Your application has been successfully submitted!", text, html };
}

/**
 * Sends the confirmation and swallows every failure: the application has already gone out, so a problem here must never change its
 * answer. Logs the outcome (never an address, a name or a credential).
 */
export async function sendApplicationConfirmation(mailer: SystemMailer | null, userId: string, a: ApplicationConfirmation): Promise<void> {
  if (!mailer) {
    console.log(JSON.stringify({ level: "info", event: "confirmation_email_skipped", reason: "system email is not set up" }));
    return;
  }
  try {
    await mailer.send(buildApplicationConfirmation(a));
    console.log(JSON.stringify({ level: "info", event: "confirmation_email_sent", userId }));
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "confirmation_email_failed", userId, kind: e instanceof Error && "kind" in e ? String((e as { kind: unknown }).kind) : "other" }));
  }
}
