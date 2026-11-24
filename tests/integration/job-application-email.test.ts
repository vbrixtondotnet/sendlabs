import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_APPLY_FORM_BYTES, MAX_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES, attachmentProblem } from "../../src/shared/email-attachments";
import { safeFilename } from "../../src/server/lib/attachments";
import { buildMime } from "../../src/server/lib/mime";
import { MAX_APPLICATION_EMAILS_PER_HOUR, resetApplicationEmailLimits } from "../../src/server/services/job-application-email";
import { postmarkPayload } from "../../src/server/services/providers/postmark";
import { GoogleOAuth } from "../../src/server/services/google-oauth";
import { FakeGoogle } from "./fake-google";
import { startHarness, uniqueEmail, type Caller, type Harness } from "./harness";

const google = new FakeGoogle();
let h: Harness;
const SENDER = "sales@sabertooth.test";

beforeAll(async () => {
  h = await startHarness({ google: new GoogleOAuth(google.fetch) });
  expect((await h.jobSeeker.api("PATCH", "/api/me", { firstName: "Rico", lastName: "Prinsipe" })).status).toBe(200);
  const start = await h.jobSeeker.api("POST", "/api/sender/gmail/connect");
  expect((await h.jobSeeker.text(google.consent(start.json.url, { email: SENDER }))).status).toBe(302);
});
afterAll(async () => { await h.dispose(); });
beforeEach(() => {
  google.sendFailure = null;
  google.refreshFails = false;
  google.mailbox.length = 0;
  resetApplicationEmailLimits();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/** Real-looking files: they start with the bytes that make each kind what it is. */
const pdf = (name = "resume.pdf", extra = 100) => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, ...new Array(extra).fill(0x41)])], name, { type: "application/pdf" });
const docx = (name = "cover-letter.docx") => new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5])], name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
const doc = (name = "old-resume.doc") => new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 9, 9])], name, { type: "application/msword" });

function formOf(fields: Record<string, string>, files: File[] = []) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const file of files) f.append("attachments", file);
  return f;
}
const GOOD = { to: "hiring@acme.test", subject: "Application for Senior Developer", body: "Hello,\n\nI would like to be considered.\n\nBest regards,\nRico" };
const send = (fields: Record<string, string> = GOOD, files: File[] = [], who: Caller = h.jobSeeker) => who.postForm("/api/jobs/apply-email", formOf(fields, files));

const header = (raw: string, name: string) => new RegExp(`^${name}: (.*)$`, "im").exec(raw.split("\r\n\r\n")[0]!)?.[1];
/** The attachment parts of a sent message: their headers and their decoded bytes. */
function attachmentsOf(raw: string) {
  const boundary = /boundary="(=_sendrix_mixed_[0-9a-f]+)"/.exec(raw)?.[1];
  if (!boundary) return [];
  return raw.split(`--${boundary}`).slice(1).filter((p) => /Content-Disposition: attachment/i.test(p)).map((p) => {
    const [head, ...rest] = p.trim().split("\r\n\r\n");
    return { head: head!, bytes: Buffer.from(rest.join("").replace(/\s+/g, "").replace(/--$/, ""), "base64") };
  });
}

describe("POST /api/jobs/apply-email", () => {
  it("sends one plain-text email as the connected Gmail account, with the PDF and Word files attached byte for byte", async () => {
    const files = [pdf("resume.pdf", 3000), docx("cover-letter.docx"), doc("old-resume.doc")];
    const r = await send(GOOD, files);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ sent: true, attachments: 3 });
    expect(google.mailbox).toHaveLength(1);
    const { from, raw } = google.mailbox[0]!;
    expect(from).toBe(SENDER);
    expect(header(raw, "To")).toBe("hiring@acme.test");
    expect(header(raw, "Subject")).toBe("Application for Senior Developer");
    expect(header(raw, "From")).toContain("Rico Prinsipe");
    expect(header(raw, "Content-Type")).toMatch(/^multipart\/mixed;/);
    for (const forbidden of ["Cc", "Bcc", "List-Unsubscribe", "List-Unsubscribe-Post"]) expect(header(raw, forbidden), forbidden).toBeUndefined();
    const parts = attachmentsOf(raw);
    expect(parts).toHaveLength(3);
    expect(parts[0]!.head).toMatch(/Content-Type: application\/pdf; name="resume.pdf"/);
    expect(parts[0]!.head).toMatch(/Content-Disposition: attachment; filename="resume.pdf"/);
    expect(parts[1]!.head).toMatch(/application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document; name="cover-letter.docx"/);
    expect(parts[2]!.head).toMatch(/application\/msword; name="old-resume.doc"/);
    for (const [i, f] of files.entries()) expect(Buffer.compare(parts[i]!.bytes, Buffer.from(await f.arrayBuffer()))).toBe(0);
    const words = Buffer.from(raw.split("Content-Transfer-Encoding: base64\r\n\r\n")[1]!.split("\r\n--")[0]!.replace(/\s+/g, ""), "base64").toString("utf8");
    expect(words).toContain("I would like to be considered.");
    expect(words).not.toMatch(/unsubscribe/i); // nothing is added to the person's own words
  });

  it("sends a plain single-part message when there is no attachment", async () => {
    expect((await send()).json).toEqual({ sent: true, attachments: 0 });
    const raw = google.mailbox[0]!.raw;
    expect(header(raw, "Content-Type")).toMatch(/^text\/plain/);
    expect(attachmentsOf(raw)).toEqual([]);
  });

  it("has no CC or BCC: a form that carries one is refused, and nothing is sent", async () => {
    for (const field of ["cc", "bcc", "Cc", "BCC"]) {
      const r = await send({ ...GOOD, [field]: "boss@acme.test" });
      expect(r.status, field).toBe(400);
      expect(r.json.error.details).toEqual([{ path: field, message: "This field is not accepted" }]);
    }
    expect(google.mailbox).toHaveLength(0);
  });

  it("validates the words: one valid address, a subject, a message", async () => {
    expect((await send({ ...GOOD, to: "not-an-email" })).status).toBe(400);
    expect((await send({ ...GOOD, to: "a@b.test, c@d.test" })).status).toBe(400); // one address, not a list
    expect((await send({ ...GOOD, subject: "  " })).status).toBe(400);
    expect((await send({ ...GOOD, body: "" })).status).toBe(400);
    expect((await send({ ...GOOD, body: "x".repeat(20_001) })).status).toBe(400);
    expect(google.mailbox).toHaveLength(0);
  });

  it("cannot be made to add headers through the subject or the file name", async () => {
    const r = await send({ ...GOOD, subject: "Hi\r\nBcc: spy@evil.test" }, [pdf('resume"; x="y.pdf')]);
    expect(r.status).toBe(200);
    const raw = google.mailbox[0]!.raw;
    expect(header(raw, "Bcc")).toBeUndefined();
    expect(raw.split("\r\n\r\n")[0]).not.toMatch(/^Bcc:/im);
    const part = attachmentsOf(raw)[0]!.head;
    expect(part).not.toMatch(/x="y/);
    expect(part).toMatch(/filename="[^"]*\.pdf"/);
  });
});

describe("attachments: only PDF and Word", () => {
  const rejected = async (files: File[], status = 400) => {
    const r = await send(GOOD, files);
    expect(r.status).toBe(status);
    expect(r.json.error.code).toBe("ATTACHMENT_REJECTED");
    expect(google.mailbox).toHaveLength(0);
    return r.json.error.message as string;
  };

  it("refuses other kinds of file, by name", async () => {
    for (const name of ["virus.exe", "notes.txt", "photo.png", "sheet.xlsx", "page.html", "archive.zip", "resume.pdf.exe", "no-extension"]) {
      expect(await rejected([new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], name)]), name).toMatch(/not a PDF or Word document/);
    }
  });

  it("refuses a file that is not what its name says (a program renamed to .pdf, text renamed to .docx)", async () => {
    expect(await rejected([new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2])], "resume.pdf", { type: "application/pdf" })])).toMatch(/does not look like a real \.pdf/);
    expect(await rejected([new File(["just some text"], "letter.docx")])).toMatch(/does not look like a real \.docx/);
    expect(await rejected([new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "report.doc")])).toMatch(/does not look like a real \.doc/); // a PDF called .doc
  });

  it("accepts the extension in any case, whatever type the browser claims", async () => {
    const odd = new File([await pdf().arrayBuffer()], "RESUME.PDF", { type: "application/octet-stream" });
    expect((await send(GOOD, [odd])).status).toBe(200);
    expect(attachmentsOf(google.mailbox[0]!.raw)[0]!.head).toContain("application/pdf"); // our own table decides, not the browser
  });

  it("refuses an empty file, more than 3 files, and more than 5 MB in all", async () => {
    expect(await rejected([new File([], "empty.pdf")])).toMatch(/is empty/);
    expect(await rejected([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf"), pdf("d.pdf")])).toMatch(/at most 3/);
    expect(MAX_ATTACHMENTS).toBe(3);
    const big = (name: string) => pdf(name, Math.floor(MAX_TOTAL_ATTACHMENT_BYTES * 0.6));
    expect(await rejected([big("one.pdf"), big("two.pdf")], 413)).toMatch(/at most 5\.0 MB in all/);
  });

  it("accepts files that together are just under the limit, even a large one (no stack overflow)", async () => {
    const r = await send(GOOD, [pdf("large.pdf", MAX_TOTAL_ATTACHMENT_BYTES - 1000)]);
    expect(r.status).toBe(200);
    expect(attachmentsOf(google.mailbox[0]!.raw)[0]!.bytes.length).toBe(MAX_TOTAL_ATTACHMENT_BYTES - 1000 + 9);
  });

  it("refuses a request that is far too large before reading it", async () => {
    const r = await h.jobSeeker.postForm("/api/jobs/apply-email", formOf(GOOD, [new File([new Uint8Array(MAX_APPLY_FORM_BYTES + 1000)], "huge.pdf")]));
    expect(r.status).toBe(413);
    expect(r.json.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(google.mailbox).toHaveLength(0);
  });

  it("names the file safely and keeps its extension", () => {
    expect(safeFilename('C:\\Users\\me\\My "Résumé"; v2.pdf', "pdf")).toBe("My Résumé v2.pdf");
    expect(safeFilename("../../etc/passwd.pdf", "pdf")).toBe("passwd.pdf");
    expect(safeFilename(".pdf", "pdf")).toBe("attachment.pdf");
    expect(safeFilename(`${"x".repeat(300)}.docx`, "docx").length).toBeLessThanOrEqual(100);
    expect(safeFilename("a\u0000b\r\nc.pdf", "pdf")).toBe("a b c.pdf");
  });

  it("agrees with the page: the same rules, checked on name and size alone", () => {
    expect(attachmentProblem({ name: "cv.pdf", size: 10 }, [])).toBeNull();
    expect(attachmentProblem({ name: "cv.docx", size: 10 }, [])).toBeNull();
    expect(attachmentProblem({ name: "cv.exe", size: 10 }, [])).toMatch(/Only \.pdf, \.doc and \.docx/);
    expect(attachmentProblem({ name: "cv.pdf", size: 0 }, [])).toMatch(/empty/);
    expect(attachmentProblem({ name: "cv.pdf", size: 10 }, [{ name: "cv.pdf", size: 10 }])).toMatch(/already attached/);
    expect(attachmentProblem({ name: "d.pdf", size: 10 }, [{ name: "a.pdf", size: 1 }, { name: "b.pdf", size: 1 }, { name: "c.pdf", size: 1 }])).toMatch(/at most 3/);
  });
});

describe("who can send, and what happens when sending fails", () => {
  it("needs a signed-in account: a visitor is refused", async () => {
    expect((await send(GOOD, [], h.anonymous)).status).toBe(401);
    expect((await send(GOOD, [])).status).toBe(200);
  });

  it("says to connect Gmail when the account has not", async () => {
    const other = uniqueEmail("globex");
    await h.addAccount("Globex Corp", other, "JobSeeker");
    const r = await send(GOOD, [], h.as(other));
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("SENDER_REQUIRED");
  });

  it("explains a Gmail connection that must be redone (409), a Gmail limit (429), and any other failure (502)", async () => {
    google.refreshFails = true;
    const reconnect = await send();
    expect(reconnect.status).toBe(409);
    expect(reconnect.json.error.code).toBe("SENDER_RECONNECT");
    // the connection is now marked: put it back for the next tests
    const start = await h.jobSeeker.api("POST", "/api/sender/gmail/connect");
    google.refreshFails = false;
    await h.jobSeeker.text(google.consent(start.json.url, { email: SENDER }));

    google.sendFailure = { status: 429, body: { error: { code: 429, message: "Rate Limit Exceeded", errors: [{ reason: "rateLimitExceeded" }] } } };
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe("GMAIL_RATE_LIMITED");

    google.sendFailure = { status: 500, body: { error: { code: 500, message: "Backend Error" } } };
    const broken = await send();
    expect(broken.status).toBe(502);
    expect(broken.json.error.code).toBe("EMAIL_SEND_FAILED");
  });

  it("allows 20 emails an hour for each person, then asks them to wait", async () => {
    for (let i = 0; i < MAX_APPLICATION_EMAILS_PER_HOUR; i++) expect((await send()).status).toBe(200);
    const r = await send();
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe("TOO_MANY_EMAILS");
    expect(google.mailbox).toHaveLength(MAX_APPLICATION_EMAILS_PER_HOUR);
  });
});

describe("the message builder and the other provider", () => {
  const base = { from: "me@acme.test", to: "you@acme.test", subject: "Hi", text: "Body" };

  it("builds multipart/mixed with the words first and each file after, and plain text when there are none", () => {
    expect(buildMime(base)).not.toContain("multipart/mixed");
    const raw = buildMime({ ...base, attachments: [{ filename: "a.pdf", contentType: "application/pdf", content: new Uint8Array([1, 2, 3]) }] });
    expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="=_sendrix_mixed_[0-9a-f]+"/);
    expect(raw.indexOf('text/plain')).toBeLessThan(raw.indexOf("application/pdf"));
    expect(attachmentsOf(raw)[0]!.bytes).toEqual(Buffer.from([1, 2, 3]));
  });

  it("puts HTML and text alternatives inside the mixed message when there is HTML as well", () => {
    const raw = buildMime({ ...base, html: "<p>Body</p>", attachments: [{ filename: "a.doc", contentType: "application/msword", content: new Uint8Array([7]) }] });
    expect(raw).toContain("multipart/mixed");
    expect(raw).toContain("multipart/alternative");
    expect(attachmentsOf(raw)).toHaveLength(1);
  });

  it("encodes a file name with other characters (RFC 2231) and keeps a plain fallback", () => {
    const raw = buildMime({ ...base, attachments: [{ filename: "Résumé – José.pdf", contentType: "application/pdf", content: new Uint8Array([1]) }] });
    expect(raw).toMatch(/filename="R_sum_ _ Jos_\.pdf"; filename\*=UTF-8''R%C3%A9sum%C3%A9%20%E2%80%93%20Jos%C3%A9\.pdf/);
  });

  it("refuses an attachment type it does not recognise as a type", () => {
    expect(() => buildMime({ ...base, attachments: [{ filename: "a.pdf", contentType: "text/plain\r\nBcc: x@y.test", content: new Uint8Array([1]) }] })).toThrow(/attachment type/);
  });

  it("sends attachments to Postmark as base64 with their names and types, and none when there are none", () => {
    const cfg = { token: "t", from: "me@acme.test", fromName: "Me", messageStream: "outbound" };
    const m = { fromName: "Me", to: "you@acme.test", subject: "Hi", text: "Body" };
    expect(postmarkPayload(cfg, m)).not.toHaveProperty("Attachments");
    expect(postmarkPayload(cfg, { ...m, attachments: [{ filename: "a.pdf", contentType: "application/pdf", content: new Uint8Array([1, 2, 3]) }] }).Attachments).toEqual([{ Name: "a.pdf", Content: "AQID", ContentType: "application/pdf" }]);
  });
});
