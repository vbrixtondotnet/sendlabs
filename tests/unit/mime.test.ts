import { describe, expect, it } from "vitest";
import { buildMime, cleanHeaderValue, encodeHeader, escapeHtml, toBase64Url } from "../../src/server/lib/mime";

/** A minimal reader, so the tests check what a mail client would see, not just what we wrote. */
function parse(raw: string) {
  const [head = "", ...rest] = raw.split("\r\n\r\n");
  const unfolded = head.replace(/\r\n[ \t]+/g, " ");
  const headers = new Map<string, string>();
  const names: string[] = [];
  for (const line of unfolded.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) { headers.set(line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()); names.push(line.slice(0, i).toLowerCase()); }
  }
  return { headers, names, body: rest.join("\r\n\r\n") };
}
const decodeB64 = (s: string) => Buffer.from(s.replace(/\r?\n/g, ""), "base64").toString("utf8");
/** Decodes RFC 2047 encoded words, joining adjacent ones. */
const decodeWords = (v: string) => v.replace(/(=\?UTF-8\?B\?[^?]*\?=)\s+(?==\?UTF-8\?B\?)/g, "$1").replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_m, b) => Buffer.from(b, "base64").toString("utf8"));

const base = { from: "sales@acme.test", to: "pat@example.test", subject: "Hello", text: "Plain body\nline two" };

describe("buildMime", () => {
  it("makes a multipart/alternative message with the plain text first and the HTML second", () => {
    const raw = buildMime({ ...base, html: "<p>Hi <b>there</b></p>" });
    const { headers, body } = parse(raw);
    expect(headers.get("from")).toBe("sales@acme.test");
    expect(headers.get("to")).toBe("pat@example.test");
    expect(headers.get("mime-version")).toBe("1.0");
    const boundary = /boundary="([^"]+)"/.exec(headers.get("content-type")!)![1]!;
    expect(headers.get("content-type")).toMatch(/^multipart\/alternative;/);
    const parts = body.split(`--${boundary}`).filter((p) => p.trim() && p.trim() !== "--");
    expect(parts).toHaveLength(2);
    const [plain, html] = parts.map((p) => { const m = parse(p.replace(/^\r\n/, "")); return { type: m.headers.get("content-type")!, text: decodeB64(m.body) }; }) as [{ type: string; text: string }, { type: string; text: string }];
    expect(plain.type).toMatch(/^text\/plain/);
    expect(plain.text.replace(/\r\n/g, "\n")).toBe("Plain body\nline two");
    expect(html.type).toMatch(/^text\/html/);
    expect(html.text).toBe("<p>Hi <b>there</b></p>");
    expect(raw.trimEnd().endsWith(`--${boundary}--`)).toBe(true); // properly closed
  });

  it("shows a display name on From when given, and keeps it from injecting headers or breaking the address", () => {
    expect(parse(buildMime({ ...base, fromName: "Sendrix" })).headers.get("from")).toBe('"Sendrix" <sales@acme.test>');
    expect(parse(buildMime({ ...base, fromName: "" })).headers.get("from")).toBe("sales@acme.test");
    const evil = parse(buildMime({ ...base, fromName: 'X" <evil@x.test>\r\nBcc: a@b.test' }));
    expect(evil.names).not.toContain("bcc");
    expect(evil.headers.get("from")).toMatch(/<sales@acme\.test>$/);
    expect(evil.headers.get("from")).not.toContain("evil@x.test>"  + " <");
    const accented = parse(buildMime({ ...base, fromName: "Café Sendrix" })).headers.get("from")!;
    expect(accented).toMatch(/^[\x20-\x7e]+$/);
    expect(decodeWords(accented)).toBe("Café Sendrix <sales@acme.test>");
  });

  it("sends a single plain-text part when there is no HTML", () => {
    const { headers, body } = parse(buildMime(base));
    expect(headers.get("content-type")).toMatch(/^text\/plain/);
    expect(decodeB64(body).replace(/\r\n/g, "\n")).toBe("Plain body\nline two");
  });

  it("has a unique Message-ID on the sender's domain, and a Date", () => {
    const a = parse(buildMime(base)).headers;
    const b = parse(buildMime(base)).headers;
    expect(a.get("message-id")).toMatch(/^<[0-9a-f-]{36}@acme\.test>$/);
    expect(a.get("message-id")).not.toBe(b.get("message-id"));
    expect(new Date(a.get("date")!).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("uses CRLF line endings and base64 lines of at most 76 characters", () => {
    const raw = buildMime({ ...base, text: "x".repeat(5000), html: "<p>" + "y".repeat(5000) + "</p>" });
    expect(raw).not.toMatch(/[^\r]\n/); // no bare LF anywhere
    for (const line of raw.split("\r\n")) expect(line.length, line.slice(0, 40)).toBeLessThanOrEqual(/^[A-Za-z0-9+/=]+$/.test(line) ? 76 : 998); // base64 lines 76; any line under RFC 5322's hard 998
  });

  it("carries non-ASCII text intact, in the body and in the subject", () => {
    const raw = buildMime({ ...base, subject: "Café Münster has invited you — 日本語", text: "Привет, 🌍", html: "<p>Привет, 🌍</p>" });
    const { headers, body } = parse(raw);
    expect(decodeWords(headers.get("subject")!)).toBe("Café Münster has invited you — 日本語");
    expect(headers.get("subject")).toMatch(/^[\x20-\x7e]+$/); // the header itself is pure ASCII
    expect(body).not.toMatch(/Привет|🌍/); // base64, so nothing in the body can be read as a header
    expect(raw).toContain(Buffer.from("Привет, 🌍").toString("base64").slice(0, 8));
  });

  it("cannot be tricked into extra headers through the subject", () => {
    const attacks = ["Hi\r\nBcc: attacker@evil.test", "Hi\nBcc: attacker@evil.test", "Hi\u2028Bcc: attacker@evil.test", "Hi\r\n\r\nInjected body", "Hi\u0000Bcc: x@y.test"];
    for (const subject of attacks) {
      const { names } = parse(buildMime({ ...base, subject }));
      expect(names, JSON.stringify(subject)).not.toContain("bcc");
      expect(names.filter((n) => n === "subject")).toHaveLength(1);
    }
  });

  it("rejects an address that is not a plain valid address (no names, brackets, commas or line breaks)", () => {
    const bad = ["pat@example.test\r\nBcc: x@y.test", "Pat <pat@example.test>", "a@b.test, c@d.test", "pat@example", "", "pat example@x.test", "<pat@example.test>", "pat@example.test;x@y.test"];
    for (const to of bad) expect(() => buildMime({ ...base, to }), JSON.stringify(to)).toThrow(/Invalid To address/);
    expect(() => buildMime({ ...base, from: "a b@c.test" })).toThrow(/Invalid From address/);
  });
});

describe("header helpers", () => {
  it("cleanHeaderValue strips line breaks and control characters and collapses whitespace", () => {
    expect(cleanHeaderValue("a\r\nb\tc   d\u0000e")).toBe("a b c d e");
    expect(cleanHeaderValue("  trimmed  ")).toBe("trimmed");
  });

  it("encodeHeader leaves ASCII alone and encodes the rest in words no longer than 75 characters", () => {
    expect(encodeHeader("Plain subject")).toBe("Plain subject");
    const long = encodeHeader("é".repeat(120));
    for (const word of long.split(" ")) expect(word.length).toBeLessThanOrEqual(75);
    expect(decodeWords(long)).toBe("é".repeat(120));
  });

  it("never splits a multi-byte character across two encoded words", () => {
    const text = "🌍".repeat(40); // 4 bytes each
    expect(decodeWords(encodeHeader(text))).toBe(text);
  });

  it("escapeHtml neutralizes markup in names", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')"> & more`)).toBe("&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; more");
  });

  it("toBase64Url is URL-safe, unpadded, and decodes back", () => {
    const raw = "Subject: ¿Qué?\r\n\r\nbody ~~~ ???>>>";
    const b = toBase64Url(raw);
    expect(b).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(b.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).toBe(raw);
  });
});

describe("List-Unsubscribe headers", () => {
  const base = { from: "sales@acme.test", to: "a@b.test", subject: "S", text: "T" };
  const head = (raw: string) => raw.split("\r\n\r\n")[0]!;

  it("adds the address, and the one-click marker when asked", () => {
    const h = head(buildMime({ ...base, listUnsubscribe: { url: "https://acme.test/u/abc", oneClick: true } }));
    expect(h).toContain("List-Unsubscribe: <https://acme.test/u/abc>");
    expect(h).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  });
  it("can add just the address, without the one-click marker", () => {
    const h = head(buildMime({ ...base, listUnsubscribe: { url: "http://acme.test/u/abc?x=1&y=2", oneClick: false } }));
    expect(h).toContain("List-Unsubscribe: <http://acme.test/u/abc?x=1&y=2>");
    expect(h).not.toContain("List-Unsubscribe-Post");
  });
  it("adds neither header when not asked", () => {
    expect(head(buildMime(base))).not.toContain("List-Unsubscribe");
  });
  it("works for a message with an HTML part too, with the headers in the header block", () => {
    const raw = buildMime({ ...base, html: "<p>x</p>", listUnsubscribe: { url: "https://acme.test/u", oneClick: true } });
    expect(head(raw)).toContain("List-Unsubscribe-Post");
    expect(raw.split("\r\n\r\n").slice(1).join("")).not.toContain("List-Unsubscribe");
  });
  it("refuses an address that is not a plain http(s) one, so nothing can be injected through it", () => {
    for (const url of ["", "javascript:alert(1)", "mailto:a@b.test", "ftp://acme.test", "https://acme.test/u\r\nBcc: evil@x.test", "https://acme.test/a b", "https://acme.test/>, <https://evil.test", "https://acme.test/u,https://evil.test", "https://", "//acme.test/u", "https://acme.test/\u0000"]) {
      expect(() => buildMime({ ...base, listUnsubscribe: { url, oneClick: true } }), JSON.stringify(url)).toThrow();
    }
  });
});
