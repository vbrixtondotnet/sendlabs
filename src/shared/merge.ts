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
export const PREVIEW_UNSUBSCRIBE_URL = "https://example.invalid/unsubscribe/preview-token";

/** The made-up contact a test email is filled in with, so the tags can be seen working. */
export const SAMPLE_CONTACT: Partial<ContactFields> = { firstName: "Alex", lastName: "Sample", companyName: "Example Co", industry: "construction", email: "alex@example.test" };

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Substitute the fixed placeholder set. HTML bodies escape values. Subjects are plain text. */
export function renderTemplate(template: string, contact: Partial<ContactFields>, asHtml: boolean): string {
  let out = template;
  for (const f of MERGE_FIELDS) {
    const v = f.value(contact).trim() || f.fallback;
    out = out.split(f.tag).join(asHtml ? escapeHtml(v) : v);
  }
  return out.split(UNSUBSCRIBE_TAG).join(PREVIEW_UNSUBSCRIBE_URL);
}

/** Merge tags in a template that are not in the supported set (likely typos). */
export function unknownTags(template: string): string[] {
  const known = new Set([...MERGE_FIELDS.map((f) => f.tag), UNSUBSCRIBE_TAG]);
  const found = template.match(/\{\{[^}]*\}\}/g) ?? [];
  return [...new Set(found.filter((t) => !known.has(t)))];
}
