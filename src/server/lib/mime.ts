import { isValidEmail } from "../../shared/email";
import { bytesToB64, type EmailAttachment } from "./attachments";

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
  /** Shown to the recipient instead of the bare address, e.g. "Sendrix". Optional. */
  fromName?: string;
  to: string;
  /** Where replies go, when that is not the sender. Adds `Reply-To`; left out otherwise. A plain address, validated. */
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * Adds the `List-Unsubscribe` header (so mail apps can show their own "Unsubscribe" button) and, with `oneClick`, the
   * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header that lets them unsubscribe without opening a page (RFC 8058).
   * `url` must be a plain http(s) address: anything else is refused, so it cannot add headers or other addresses.
   */
  listUnsubscribe?: { url: string; oneClick: boolean };
  /** Files to attach (already checked by `readAttachments`). The message then becomes multipart/mixed: the words, then each file. */
  attachments?: EmailAttachment[];
}

const CRLF = "\r\n";
const enc = new TextEncoder();

/** Base64 of bytes: in slices (see `bytesToB64`), because a whole message with attachments is millions of bytes. */
const toB64 = bytesToB64;

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

/** `Sendrix <sales@acme.test>`, or just the address when there is no (usable) name. Non-ASCII names are RFC 2047 encoded. */
function fromDisplay(name: string | undefined, address: string): string {
  const clean = cleanHeaderValue(name ?? "").replace(/["\\<>]/g, "");
  if (!clean) return address;
  // Plain names are quoted; encoded-words must NOT be inside quotes (RFC 2047), so they go bare.
  return `${/^[\x20-\x7e]*$/.test(clean) ? `"${clean}"` : encodeHeader(clean)} <${address}>`;
}

/** `filename="a.pdf"` for a plain name; `filename*=UTF-8''...` (RFC 2231), with a plain fallback, for one with other characters. */
function filenameParams(name: string): { ascii: string; disposition: string } {
  const clean = cleanHeaderValue(name).replace(/["\\]/g, "");
  if (/^[ -~]*$/.test(clean)) return { ascii: clean, disposition: `filename="${clean}"` };
  const ascii = clean.replace(/[^ -~]/g, "_");
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return { ascii, disposition: `filename="${ascii}"; filename*=UTF-8''${encoded}` };
}

/** One attachment as a MIME part. The type is one of our own (never the browser's claim), the name is cleaned. */
function attachmentPart(boundary: string, a: EmailAttachment): string {
  if (!/^[a-z]+\/[a-z0-9.+-]+$/i.test(a.contentType)) throw new Error("Invalid attachment type");
  const b64 = (bytesToB64(a.content).match(/.{1,76}/g) ?? [""]).join(CRLF);
  const names = filenameParams(a.filename);
  return [
    `--${boundary}`,
    `Content-Type: ${a.contentType}; name="${names.ascii}"`,
    `Content-Disposition: attachment; ${names.disposition}`,
    "Content-Transfer-Encoding: base64",
    "",
    b64,
  ].join(CRLF);
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
  const boundary = `=_sendrix_${crypto.randomUUID().replace(/-/g, "")}`;

  const headers = [
    // The display name is cleaned of line breaks and quoted, so it cannot add headers or break the address.
    `From: ${fromDisplay(msg.fromName, from)}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
  ];
  if (msg.replyTo) headers.push(`Reply-To: ${addressOf(msg.replyTo, "Reply-To")}`);
  if (msg.listUnsubscribe) {
    const url = msg.listUnsubscribe.url.trim();
    if (!/^https?:\/\/[^\s<>",;\\\u0000-\u001f\u007f]+$/i.test(url)) throw new Error("Invalid List-Unsubscribe address");
    headers.push(`List-Unsubscribe: <${url}>`);
    if (msg.listUnsubscribe.oneClick) headers.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  }

  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", base64Body(body)].join(CRLF);

  // The words: plain text alone, or plain text and HTML as alternatives.
  const words =
    msg.html === undefined
      ? ['Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", base64Body(msg.text)]
      : [`Content-Type: multipart/alternative; boundary="${boundary}"`, "", part("text/plain", msg.text), part("text/html", msg.html), `--${boundary}--`, ""];

  const files = msg.attachments ?? [];
  if (files.length === 0) return [...headers, ...words].join(CRLF);

  // With files, the whole thing is multipart/mixed: the words first, then each file.
  const mixed = `=_sendrix_mixed_${crypto.randomUUID().replace(/-/g, "")}`;
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    ...words,
    ...files.map((f) => attachmentPart(mixed, f)),
    `--${mixed}--`,
    "",
  ].join(CRLF);
}

/** Gmail wants the message as base64url of its UTF-8 bytes. */
export function toBase64Url(raw: string): string {
  return toB64(enc.encode(raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** What a built message holds, in a form a person can read: its headers, and each body part decoded. For diagnostics only. */
export interface MimeInspection {
  headers: { name: string; value: string }[];
  parts: { contentType: string; text: string }[];
}

const decodeB64Text = (b64: string): string => {
  try {
    const bin = atob(b64.replace(/\s+/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))).replace(/\r\n/g, "\n"); // shown with plain line breaks
  } catch {
    return "(could not decode)";
  }
};

const parseHeaders = (block: string) =>
  block
    .replace(/\r\n[ \t]+/g, " ") // unfold continuation lines
    .split("\r\n")
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(":");
      return { name: line.slice(0, i), value: line.slice(i + 1).trim() };
    });

/**
 * Reads a message made by `buildMime` back into headers and decoded parts, so what is about to be submitted can be
 * checked by eye. It holds only the message itself: the access token travels in the HTTP request, never in the message.
 */
export function inspectMime(raw: string): MimeInspection {
  const split = raw.indexOf(CRLF + CRLF);
  const headers = parseHeaders(split < 0 ? raw : raw.slice(0, split));
  const body = split < 0 ? "" : raw.slice(split + 4);
  const type = headers.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "";
  const boundary = /boundary="([^"]+)"/.exec(type)?.[1];
  if (!boundary) return { headers, parts: [{ contentType: type, text: decodeB64Text(body) }] };
  const parts = body
    .split(`--${boundary}`)
    .map((p) => p.trim())
    .filter((p) => p && p !== "--")
    .map((p) => {
      const at = p.indexOf(CRLF + CRLF);
      const h = parseHeaders(p.slice(0, at));
      return { contentType: h.find((x) => x.name.toLowerCase() === "content-type")?.value ?? "", text: decodeB64Text(p.slice(at + 4)) };
    });
  return { headers, parts };
}
