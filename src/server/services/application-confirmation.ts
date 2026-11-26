import { escapeHtml } from "../lib/mime";
import type { SystemMail, SystemMailer } from "./system-mail";

/** One line of text: no control characters, single spaces, at most `max` characters. */
const oneLine = (v: string | undefined, max: number) => (v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export interface ApplicationConfirmation {
  /** The account's own address: where the confirmation goes (never the employer's). */
  to: string;
  jobTitle?: string | undefined;
  companyName?: string | undefined;
  /** Who the application went to. */
  sentTo: string;
  sentAt: Date;
  attachmentNames: string[];
  /** The address of the app, for the link back. */
  appUrl: string;
}

/**
 * The "your application was sent" email. A short summary only (what, to whom, when, which files) and never the message itself.
 * Plain and transactional: no tracking, no marketing, no unsubscribe link. Everything that came from a person is cleaned and escaped.
 */
export function buildApplicationConfirmation(a: ApplicationConfirmation): SystemMail {
  const title = oneLine(a.jobTitle, 200);
  const company = oneLine(a.companyName, 200);
  const what = [title, company].filter(Boolean).join(" at ") || "a job";
  const when = a.sentAt.toUTCString();
  const files = a.attachmentNames.map((n) => oneLine(n, 120)).filter(Boolean);
  const link = /^https?:\/\//i.test(a.appUrl) ? a.appUrl.replace(/\/+$/, "") : "";
  const subject = `Your application${company ? ` to ${company}` : ""} was sent`;

  const lines = [
    "Hello,",
    "",
    `Your application for ${what} was sent.`,
    "",
    `Sent to: ${oneLine(a.sentTo, 254)}`,
    `Sent on: ${when}`,
    ...(files.length ? [`Attachments: ${files.join(", ")}`] : []),
    ...(link ? ["", `Open Sendrix: ${link}`] : []),
    "",
    "This is an automated message from Sendrix. Please do not reply to it.",
  ];

  const row = (k: string, v: string) => `<tr><td style="padding:2px 12px 2px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:2px 0">${escapeHtml(v)}</td></tr>`;
  const html = [
    '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">',
    "<p>Hello,</p>",
    `<p>Your application for <strong>${escapeHtml(what)}</strong> was sent.</p>`,
    '<table style="border-collapse:collapse;font-size:14px">',
    row("Sent to", oneLine(a.sentTo, 254)),
    row("Sent on", when),
    ...(files.length ? [row("Attachments", files.join(", "))] : []),
    "</table>",
    ...(link ? [`<p><a href="${escapeHtml(link)}">Open Sendrix</a></p>`] : []),
    '<p style="color:#64748b;font-size:12px">This is an automated message from Sendrix. Please do not reply to it.</p>',
    "</div>",
  ].join("\n");

  return { to: a.to, subject, text: lines.join("\n"), html };
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
