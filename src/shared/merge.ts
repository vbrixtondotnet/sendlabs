import type { ContactFields } from "./types";

/** The only placeholders that are ever substituted. No arbitrary template code runs. Shared by the editor preview and test sends. */
export interface MergeField {
  tag: string;
  label: string;
  /** Used when the contact's value is blank. */
  fallback: string;
  value: (c: Partial<ContactFields>) => string;
}

export const MERGE_FIELDS: MergeField[] = [
  { tag: "{{firstName}}", label: "First name", fallback: "there", value: (c) => c.firstName ?? "" },
  { tag: "{{lastName}}", label: "Last name", fallback: "", value: (c) => c.lastName ?? "" },
  { tag: "{{title}}", label: "Title", fallback: "", value: (c) => c.title ?? "" },
  { tag: "{{companyName}}", label: "Company", fallback: "your company", value: (c) => c.companyName ?? "" },
  { tag: "{{industry}}", label: "Industry", fallback: "your industry", value: (c) => c.industry ?? "" },
  { tag: "{{city}}", label: "City", fallback: "", value: (c) => c.city ?? "" },
  { tag: "{{state}}", label: "State", fallback: "", value: (c) => c.state ?? "" },
  { tag: "{{country}}", label: "Country", fallback: "", value: (c) => c.country ?? "" },
  { tag: "{{website}}", label: "Website", fallback: "", value: (c) => c.website ?? "" },
];

export const UNSUBSCRIBE_TAG = "{{unsubscribeUrl}}";
/** Old way of placing the signature inside a body. The signature now always follows the body, so this tag is just removed if it is still there. */
export const SIGNATURE_TAG = "{{signature}}";
export const PREVIEW_UNSUBSCRIBE_URL = "https://example.invalid/unsubscribe/preview-token";

/** The made-up contact a test email is filled in with, so the tags can be seen working. */
export const SAMPLE_CONTACT: Partial<ContactFields> = { firstName: "Alex", lastName: "Sample", companyName: "Example Co", industry: "construction", email: "alex@example.test" };

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Substitute the fixed placeholder set. HTML bodies escape values. Subjects are plain text. `unsubscribeUrl` is where
 * `{{unsubscribeUrl}}` points: the recipient's own link when sending, a placeholder in the editor's preview.
 */
export function renderTemplate(template: string, contact: Partial<ContactFields>, asHtml: boolean, unsubscribeUrl: string = PREVIEW_UNSUBSCRIBE_URL): string {
  let out = template;
  for (const f of MERGE_FIELDS) {
    const v = f.value(contact).trim() || f.fallback;
    out = out.split(f.tag).join(asHtml ? escapeHtml(v) : v);
  }
  return out.split(UNSUBSCRIBE_TAG).join(asHtml ? escapeHtml(unsubscribeUrl) : unsubscribeUrl);
}

/** Merge tags in a template that are not in the supported set (likely typos). */
export function unknownTags(template: string): string[] {
  const known = new Set([...MERGE_FIELDS.map((f) => f.tag), UNSUBSCRIBE_TAG, SIGNATURE_TAG]);
  const found = template.match(/\{\{[^}]*\}\}/g) ?? [];
  return [...new Set(found.filter((t) => !known.has(t)))];
}

/** Plain text as HTML: escaped, line breaks kept, in one paragraph. Empty for nothing. Used to turn plain-text defaults into editor content. */
export function textToHtml(text: string): string {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  return clean ? `<p>${escapeHtml(clean).replace(/\n/g, "<br/>")}</p>` : "";
}

/**
 * Whether rich-text content says nothing: no text and no picture or rule. An empty editor holds `<p></p>`, so "empty"
 * has to be judged by what is left once the markup and the spaces are gone.
 */
export function isBlankHtml(html: string): boolean {
  if (/<(img|hr)\b/i.test(html)) return false;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;|\s/gi, "") === "";
}

/** The signature as HTML to send. It is written in a rich-text editor, so it already is HTML. Empty when it says nothing. */
export function signatureHtml(signature: string): string {
  return isBlankHtml(signature) ? "" : signature.trim();
}

/**
 * Puts the signature (HTML) right after the body. It is always added, so the body is just the message. (An old
 * `{{signature}}` tag left in a body is dropped rather than shown; the signature goes where it always does.) With no
 * signature nothing is added. Merge fields inside the signature are filled in afterwards by `renderTemplate`.
 */
export function applySignature(bodyHtml: string, signature: string): string {
  const body = bodyHtml.split(SIGNATURE_TAG).join("");
  const block = signatureHtml(signature);
  return block ? `${body}\n${block}` : body;
}

/**
 * The signature a new campaign starts with, as plain text lines, from the signed-in user and their organization:
 *
 *   Best regards,
 *   {full name}
 *   {position} | {company}
 *   {website}
 *
 * A missing position leaves just the company on that line, and a missing website drops its line.
 */
export function defaultSignature(who: { name: string; position: string }, tenant: { name: string; website: string }): string {
  const clean = (v: string) => v.replace(/\s+/g, " ").trim();
  const identity = [clean(who.position), clean(tenant.name)].filter(Boolean).join(" | ");
  return ["Best regards,", clean(who.name), identity, clean(tenant.website)].filter(Boolean).join("\n");
}

/** The company's postal address as a small grey footer block (escaped, line breaks kept). Empty when there is no address. */
export function postalFooterHtml(address: string): string {
  const text = address.replace(/\r\n?/g, "\n").trim();
  return text ? `<p style="font-size:12px;color:#666666">${escapeHtml(text).replace(/\n/g, "<br/>")}</p>` : "";
}

/**
 * The standard footer every email gets, below the signature. It is fixed: nobody edits it. `{{unsubscribeUrl}}` becomes
 * the recipient's own unsubscribe link. The last line is the SENDING company's name (not the recipient's company, which
 * is what the `{{companyName}}` merge field means in a body).
 */
export function unsubscribeFooterHtml(companyName: string): string {
  const name = escapeHtml(companyName.replace(/\s+/g, " ").trim());
  return `<hr/>
<p style="font-size:12px;color:#666;">
You're receiving this email because we believe our services may be relevant to your business.<br/>
<a href="${UNSUBSCRIBE_TAG}">Unsubscribe</a><br/>
${name}
</p>`;
}

export interface EmailParts {
  /** What the user wrote: just the message. */
  body: string;
  /** The email signature (plain text). */
  signature: string;
  /** The sending company's name, for the footer. */
  companyName: string;
  /** The company's postal address, last. */
  postalAddress: string;
  /** The company's "Require an unsubscribe link in every campaign" setting: when on, the standard footer is added. */
  unsubscribeFooter: boolean;
}

/**
 * The finished HTML of one email, in the order it is sent:
 *
 *   1. the body (just the message)
 *   2. the email signature
 *   3. the standard unsubscribe footer (when the company requires an unsubscribe link, which is the default)
 *   4. the company's postal address, small and grey (a legal requirement for marketing email; nothing if there is none)
 *
 * Merge fields are filled in across 1 to 3, and `{{unsubscribeUrl}}` becomes `unsubscribeUrl`. The editor's preview and
 * every sending path build the message with this one function, so what you preview is what is sent.
 */
export function composeEmailHtml(parts: EmailParts, contact: Partial<ContactFields>, unsubscribeUrl: string = PREVIEW_UNSUBSCRIBE_URL): string {
  const message = [applySignature(parts.body, parts.signature), parts.unsubscribeFooter ? unsubscribeFooterHtml(parts.companyName) : ""].filter(Boolean).join("\n");
  const html = renderTemplate(message, contact, true, unsubscribeUrl);
  const address = postalFooterHtml(parts.postalAddress);
  return address ? `${html}\n${address}` : html;
}

/** The same starting signature as HTML, which is what the signature editor holds. */
export function defaultSignatureHtml(who: { name: string; position: string }, tenant: { name: string; website: string }): string {
  return textToHtml(defaultSignature(who, tenant));
}
