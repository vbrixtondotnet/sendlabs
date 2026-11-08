import { isValidEmail } from "../../shared/email";

/**
 * Builds an email as RFC 5322 text, ready for Gmail's `messages.send` (which takes the whole message,
 * base64url encoded). Plain text plus an optional HTML alternative, so a client that cannot show HTML still
 * gets the full message and the link.
 *
 * Header injection is the danger here: a value containing a line break can add headers such as `Bcc:`. Values
 * that come from people (a tenant's name ends up in the subject) are therefore stripped of control characters,
 * and addresses must pass strict validation. Bodies are base64, so nothing in them can be read as a header.
 */
export interface OutgoingEmail {
  /** The connected account's address. Gmail sends as this account regardless. */
  from: string;
  /** Shown to the recipient instead of the bare address, e.g. "SendLab". Optional. */
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const CRLF = "\r\n";
const enc = new TextEncoder();

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** Control characters, DEL and the Unicode line separators U+2028/U+2029, built from codes so no literal separator sits in source. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\u0000-\u001f\u007f" + String.fromCharCode(0x2028, 0x2029) + "]+", "g");

/** Removes everything that could break out of a single header line, and collapses whitespace. */
export function cleanHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

/** RFC 2047 encoded-words (`=?UTF-8?B?...?=`) for a header that is not plain ASCII. Split so no word exceeds 75 characters. */
export function encodeHeader(value: string): string {
  const clean = cleanHeaderValue(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const words: string[] = [];
  let chunk = "";
  for (const ch of clean) {
    // 45 bytes of text become 60 base64 characters, which keeps each encoded word well under the 75 limit.
    if (enc.encode(chunk + ch).length > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${toB64(enc.encode(w))}?=`).join(" ");
}

/** An address for a header. Rejects anything that is not a plain, valid address: no names, no angle brackets, no commas. */
function addressOf(value: string, label: string): string {
  const v = value.trim();
  if (!isValidEmail(v.toLowerCase()) || /[<>",;\s]/.test(v)) throw new Error(`Invalid ${label} address`);
  return v;
}

/** `SendLab <sales@acme.test>`, or just the address when there is no (usable) name. Non-ASCII names are RFC 2047 encoded. */
function fromDisplay(name: string | undefined, address: string): string {
  const clean = cleanHeaderValue(name ?? "").replace(/["\\<>]/g, "");
  if (!clean) return address;
  // Plain names are quoted; encoded-words must NOT be inside quotes (RFC 2047), so they go bare.
  return `${/^[\x20-\x7e]*$/.test(clean) ? `"${clean}"` : encodeHeader(clean)} <${address}>`;
}

/** Base64 at 76 characters per line, as MIME requires. */
function base64Body(text: string): string {
  const b64 = toB64(enc.encode(text.replace(/\r?\n/g, CRLF)));
  return (b64.match(/.{1,76}/g) ?? [""]).join(CRLF);
}

export function buildMime(msg: OutgoingEmail): string {
  const from = addressOf(msg.from, "From");
  const to = addressOf(msg.to, "To");
  const domain = from.split("@")[1] ?? "localhost";
  const boundary = `=_sendlab_${crypto.randomUUID().replace(/-/g, "")}`;

  const headers = [
    // The display name is cleaned of line breaks and quoted, so it cannot add headers or break the address.
    `From: ${fromDisplay(msg.fromName, from)}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
  ];

  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", base64Body(body)].join(CRLF);

  if (msg.html === undefined) {
    return [...headers, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", base64Body(msg.text)].join(CRLF);
  }
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    part("text/plain", msg.text),
    part("text/html", msg.html),
    `--${boundary}--`,
    "",
  ].join(CRLF);
}

/** Gmail wants the message as base64url of its UTF-8 bytes. */
export function toBase64Url(raw: string): string {
  return toB64(enc.encode(raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
