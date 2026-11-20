/**
 * Checks for the One-to-one email page. A one-to-one email is sent exactly as written, so nothing is filled in for you, and
 * a message that looks like a template or a mass mailing is likely to be filed as Spam. These are pure functions, shared by
 * the page (to warn as you type) and the server (to refuse what must never go out).
 */

/** Merge tags such as {{companyName}} that are still in the text. They would be sent as they are. */
export function findPlaceholders(text: string): string[] {
  return [...new Set(text.match(/\{\{[^{}]*\}\}/g) ?? [])];
}

/** The sentence shown when a message still has template tags in it. */
export function placeholderMessage(tags: string[]): string {
  return `Replace ${tags.join(", ")} with the real text. A one-to-one email is sent exactly as you write it, so merge fields are not filled in`;
}

/** Lower-cased words of at least 3 letters, as a set: enough to tell a message from a copy of itself with the name changed. */
const wordsOf = (text: string): Set<string> => new Set((text.toLowerCase().match(/[a-z0-9$']{3,}/g) ?? []));

/** How alike two messages are, 0 to 1: the share of words they have in common. */
export function similarity(a: string, b: string): number {
  const x = wordsOf(a);
  const y = wordsOf(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/** A subject that suggests you already have dealings with the person: deceptive when you do not, and a classic spam pattern. */
const RELATIONSHIP_SUBJECT = /^\s*(re|fwd?)\s*:|\b(invoice|contract|quote|quotation|receipt|payment|purchase order|order confirmation|shipment|your account|urgent|action required|final notice|overdue)\b/i;

/** Longer than this, a first message reads as a pitch rather than a note. */
export const LONG_FIRST_MESSAGE = 700;
/** At or above this likeness, two messages count as the same message. */
export const SAME_MESSAGE = 0.8;

/** The made-up contact the campaign editor's preview uses. Its values in a one-to-one email mean the text was pasted from a preview. */
export const SAMPLE_COMPANY = "Example Co";

/** A price or other money amount, such as $5,000 or USD 10,000. */
const MONEY = /(\$|€|£|₱|\b(?:usd|php|eur|gbp)\s?)\s?\d[\d,.]*/i;

export interface PersonalEmailWarning {
  code: "sample-data" | "repeated" | "relationship-subject" | "long" | "price";
  message: string;
}

/**
 * Things worth a second look before sending. None of them stops the email: they explain what mail filters notice.
 * `recent` is what was already sent, so repeating a message to other people can be seen.
 */
export function personalEmailWarnings(input: { to: string; subject: string; body: string; recent: readonly { to: string; body: string }[] }): PersonalEmailWarning[] {
  const out: PersonalEmailWarning[] = [];
  const to = input.to.trim().toLowerCase();

  if (new RegExp(SAMPLE_COMPANY, "i").test(`${input.subject}\n${input.body}`)) {
    out.push({
      code: "sample-data",
      message: `This text mentions "${SAMPLE_COMPANY}", the made-up company the campaign preview uses, so it was probably copied from a preview. Check the name and company: the person will see exactly what is written here.`,
    });
  }

  const others = new Set<string>();
  for (const r of input.recent) {
    if (r.to.toLowerCase() !== to && similarity(input.body, r.body) >= SAME_MESSAGE) others.add(r.to.toLowerCase());
  }
  if (others.size > 0 && input.body.trim()) {
    out.push({
      code: "repeated",
      message: `You have already sent almost this same message to ${others.size} other address${others.size === 1 ? "" : "es"}. Gmail treats the same text sent to many people as bulk mail and tends to file it as Spam. Write each one for the person it goes to, or use a campaign.`,
    });
  }

  if (RELATIONSHIP_SUBJECT.test(input.subject)) {
    out.push({
      code: "relationship-subject",
      message: "This subject suggests you already have dealings with the person (a reply, an invoice, a contract, a quote...). If you do not, Gmail may treat it as misleading. Say what the email really is.",
    });
  }

  if (MONEY.test(input.body)) {
    out.push({
      code: "price",
      message: "A price in a first message reads like advertising to a mail filter, and to the person. Keep prices for when they reply.",
    });
  }

  if (input.body.trim().length > LONG_FIRST_MESSAGE) {
    out.push({
      code: "long",
      message: `This is ${input.body.trim().length.toLocaleString("en-US")} characters. A long first message with prices and a list of services reads like a sales pitch to a mail filter. A few short lines and one question usually do better.`,
    });
  }
  return out;
}
