import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LIST_UNSUBSCRIBE_HEADERS_ENABLED } from "../../src/shared/merge";
import { PERSONAL_EMAILS_PER_DAY } from "../../src/shared/schemas";
import { GoogleOAuth } from "../../src/server/services/google-oauth";
import { FakeGoogle } from "./fake-google";
import { startHarness, uniqueEmail, type Caller, type Harness } from "./harness";

const google = new FakeGoogle();
let h: Harness;
const GLOBEX = "admin@globex.test";
const SENDER = "sales@sabertooth.test";

beforeAll(async () => {
  h = await startHarness({ google: new GoogleOAuth(google.fetch) });
  await h.addTenant("Globex Corp", GLOBEX);
  expect((await h.api("PATCH", "/api/me", { firstName: "Rico", lastName: "Prinsipe" })).status).toBe(200);
});
afterAll(async () => { await h.dispose(); });
beforeEach(async () => {
  google.sendFailure = null;
  google.mailbox.length = 0;
  await h.sql("DELETE FROM personal_emails");
  await h.sql("DELETE FROM suppressions");
  await h.api("PATCH", "/api/sender", { senderName: "" });
});

async function connectGmail(who: Caller, email: string) {
  const start = await who.api("POST", "/api/sender/gmail/connect");
  expect((await who.text(google.consent(start.json.url, { email }))).status).toBe(302);
}

async function member(accessId: string) {
  const email = uniqueEmail(accessId);
  await h.sql("INSERT INTO users (id,tenant_id,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", `u-${email}`, h.tenantId, "Pat Member", email, email, "x", accessId, "Active", 1, 1);
  return h.as(email);
}

const send = (body: unknown, who: Caller = h) => who.api("POST", "/api/personal-emails", body);
const header = (raw: string, name: string) => new RegExp(`^${name}: (.*)$`, "m").exec(raw.split("\r\n\r\n")[0]!)?.[1];
const headerNames = (raw: string) => raw.split("\r\n\r\n")[0]!.split("\r\n").map((l) => l.split(":")[0]!);
/** The decoded text part and HTML part of a text-plus-HTML message. */
function parts(raw: string) {
  const [text = "", html = ""] = raw
    .split(/--=_sendrix_[0-9a-f]+/)
    .slice(1)
    .filter((p) => p.trim() && p.trim() !== "--")
    .map((p) => Buffer.from(p.split("\r\n\r\n").slice(1).join("").replace(/\s+/g, ""), "base64").toString("utf8").replace(/\r\n/g, "\n"));
  return { text, html };
}
const MESSAGE = { to: "jane@client.test", subject: "Quick question", body: "Hi Jane,\n\nDid you get my note?\n\nThanks,\nRico" };

describe("one-to-one email: sending", () => {
  it("starts empty, with the daily allowance shown", async () => {
    expect((await h.api("GET", "/api/personal-emails")).json).toEqual({ items: [], sentToday: 0, dailyLimit: PERSONAL_EMAILS_PER_DAY, provider: "gmail" });
  });

  it("sends the message exactly as written, laid out like a mail program's, with nothing a person's own email would not have", async () => {
    await connectGmail(h, SENDER);
    const r = await send(MESSAGE);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ to: "jane@client.test", subject: "Quick question", body: MESSAGE.body, sentBy: h.adminEmail });
    expect(google.mailbox).toHaveLength(1);
    const raw = google.mailbox[0]!.raw;
    expect(headerNames(raw)).toEqual(["From", "To", "Subject", "Date", "Message-ID", "MIME-Version", "Content-Type"]);
    expect(header(raw, "Content-Type")).toMatch(/^multipart\/alternative;/); // text plus HTML, as Gmail on the web sends
    expect(header(raw, "To")).toBe("jane@client.test");
    expect(header(raw, "Subject")).toBe("Quick question");
    const sent = parts(raw);
    expect(sent.text).toBe(MESSAGE.body); // no footer, no unsubscribe, no postal address, no signature added
    // The same words, laid out exactly the way Gmail on the web writes a message.
    expect(sent.html).toBe('<div dir="ltr">Hi Jane,<div><br></div><div>Did you get my note?</div><div><br></div><div>Thanks,</div><div>Rico</div></div>');
    expect(sent.html).not.toMatch(/unsubscribe|href|<img|<hr|<a /i);
  });

  it("is sent in the connected mailbox's sender name, or the sending user's when none is set", async () => {
    await connectGmail(h, SENDER);
    await send(MESSAGE);
    expect(header(google.mailbox[0]!.raw, "From")).toBe(`"Rico Prinsipe" <${SENDER}>`);
    await h.api("PATCH", "/api/sender", { senderName: "Marketing Admin" });
    google.mailbox.length = 0;
    await send(MESSAGE);
    expect(header(google.mailbox[0]!.raw, "From")).toBe(`"Marketing Admin" <${SENDER}>`);
  });

  it("adds Reply-To only when one is given", async () => {
    await connectGmail(h, SENDER);
    await send(MESSAGE);
    expect(header(google.mailbox[0]!.raw, "Reply-To")).toBeUndefined();
    google.mailbox.length = 0;
    expect((await send({ ...MESSAGE, replyTo: "boss@sabertooth.test" })).status).toBe(201);
    expect(header(google.mailbox[0]!.raw, "Reply-To")).toBe("boss@sabertooth.test");
  });

  it("is listed, newest first, with the allowance used", async () => {
    await connectGmail(h, SENDER);
    await send({ ...MESSAGE, subject: "First" });
    await send({ ...MESSAGE, to: "bob@client.test", subject: "Second" });
    const r = await h.api("GET", "/api/personal-emails");
    expect(r.json.sentToday).toBe(2);
    expect(r.json.items.map((i: { subject: string }) => i.subject)).toEqual(["Second", "First"]);
    expect(r.json.items[0]).toMatchObject({ to: "bob@client.test", body: MESSAGE.body, sentBy: h.adminEmail });
  });

  it("keeps a line break or markup in the subject or body from adding headers or HTML", async () => {
    await connectGmail(h, SENDER);
    const r = await send({ to: "jane@client.test", subject: "Hi\r\nBcc: spy@x.test", body: "<b>not bold</b> & <script>x</script>" });
    expect(r.status).toBe(201);
    const raw = google.mailbox[0]!.raw;
    expect(header(raw, "Bcc")).toBeUndefined();
    expect(header(raw, "Subject")).toBe("Hi Bcc: spy@x.test"); // flattened onto the one Subject line
    expect(headerNames(raw)).not.toContain("Bcc");
    const sent = parts(raw);
    expect(sent.text).toBe("<b>not bold</b> & <script>x</script>");
    expect(sent.html).toBe('<div dir="ltr">&lt;b&gt;not bold&lt;/b&gt; &amp; &lt;script&gt;x&lt;/script&gt;</div>'); // text stays text, in the HTML part too
  });
});

describe("one-to-one email: the same Gmail account as a campaign's test send", () => {
  it("is Gmail by default, and the one-to-one email and the test email leave from the same connected account, in the same name", async () => {
    await connectGmail(h, SENDER);
    await h.api("PATCH", "/api/sender", { senderName: "Marketing Admin" });
    expect((await h.api("GET", "/api/personal-emails")).json.provider).toBe("gmail");
    expect((await h.api("POST", "/api/test-recipients", { email: "qa@acme.test" })).status).toBeLessThan(300);
    const campaign = await h.api("POST", "/api/campaigns", { name: "Outreach", subject: "Hello", htmlBody: '<p>Hi <a href="{{unsubscribeUrl}}">Unsubscribe</a></p>' });
    expect((await h.api("POST", `/api/campaigns/${campaign.json.id}/test-send`, { to: ["qa@acme.test"] })).status).toBe(200);
    expect((await send(MESSAGE)).status).toBe(201);
    expect(google.mailbox).toHaveLength(2);
    const [test, personal] = google.mailbox;
    expect(test!.from).toBe(SENDER);
    expect(personal!.from).toBe(SENDER);
    expect(header(test!.raw, "From")).toBe(`"Marketing Admin" <${SENDER}>`);
    expect(header(personal!.raw, "From")).toBe(header(test!.raw, "From"));
    // The campaign's test is campaign mail (unsubscribe headers); the one-to-one email is not.
    expect(header(test!.raw, "List-Unsubscribe") !== undefined).toBe(LIST_UNSUBSCRIBE_HEADERS_ENABLED); // off: campaign mail is like a one-to-one email
    expect(header(personal!.raw, "List-Unsubscribe")).toBeUndefined();
    await h.api("DELETE", "/api/test-recipients/" + (await h.api("GET", "/api/test-recipients")).json.items[0].id);
  });
});

describe("one-to-one email: validation and limits", () => {
  it("rejects a missing or bad address, subject or message, anything extra, and a bad Reply-To", async () => {
    await connectGmail(h, SENDER);
    const bad: unknown[] = [
      { ...MESSAGE, to: "not-an-email" }, { ...MESSAGE, to: "a@b.test, c@d.test" }, { ...MESSAGE, subject: "" }, { ...MESSAGE, subject: "   " },
      { ...MESSAGE, body: "" }, { ...MESSAGE, body: "   " }, { ...MESSAGE, body: "x".repeat(20_001) }, { ...MESSAGE, replyTo: "nope" },
      { ...MESSAGE, cc: "x@y.test" }, { ...MESSAGE, html: "<p>x</p>" }, { to: MESSAGE.to }, "just a string",
    ];
    for (const body of bad) expect((await send(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    expect(google.mailbox).toHaveLength(0);
    expect((await h.api("GET", "/api/personal-emails")).json.items).toEqual([]);
  });

  it("refuses a message or subject that still has a merge tag in it, naming the tag, and sends nothing", async () => {
    await connectGmail(h, SENDER);
    const inBody = await send({ ...MESSAGE, body: "Hi Jane, I checked out {{companyName}} and would love to talk. Is {{companyName}} hiring?" });
    expect(inBody.status).toBe(400);
    expect(inBody.json.error.details).toEqual([{ path: "body", message: "Replace {{companyName}} with the real text. A one-to-one email is sent exactly as you write it, so merge fields are not filled in" }]);
    const inSubject = await send({ ...MESSAGE, subject: "Ideas for {{companyName}}" });
    expect(inSubject.status).toBe(400);
    expect(inSubject.json.error.details[0]).toMatchObject({ path: "subject" });
    expect(google.mailbox).toHaveLength(0);
    expect((await h.api("GET", "/api/personal-emails")).json.items).toEqual([]);
    // Ordinary braces are fine.
    expect((await send({ ...MESSAGE, body: "Use { and } freely, even {single} ones." })).status).toBe(201);
  });

  it("refuses an address on the suppression list, whatever its letter case, and sends nothing", async () => {
    await connectGmail(h, SENDER);
    await h.sql("INSERT INTO suppressions (id,tenant_id,email,normalized_email,reason,created_at) VALUES (?,?,?,?,?,?)", "sup1", h.tenantId, "Jane@Client.test", "jane@client.test", "Unsubscribed", 1);
    const r = await send({ ...MESSAGE, to: "JANE@client.test" });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("RECIPIENT_SUPPRESSED");
    expect(google.mailbox).toHaveLength(0);
    expect((await send({ ...MESSAGE, to: "someone.else@client.test" })).status).toBe(201);
  });

  it("another organization's suppression list does not block this one", async () => {
    await connectGmail(h, SENDER);
    await h.sql("INSERT INTO suppressions (id,tenant_id,email,normalized_email,reason,created_at) SELECT 'sup2', id, 'jane@client.test', 'jane@client.test', 'Unsubscribed', 1 FROM tenants WHERE name = 'Globex Corp'");
    expect((await send(MESSAGE)).status).toBe(201);
  });

  it(`allows ${PERSONAL_EMAILS_PER_DAY} in 24 hours, then asks to use a campaign, and sends nothing more`, async () => {
    await connectGmail(h, SENDER);
    const now = Date.now();
    for (let i = 0; i < PERSONAL_EMAILS_PER_DAY; i++) {
      await h.sql("INSERT INTO personal_emails (id,tenant_id,recipient,normalized_recipient,subject,body,sent_by,created_at) VALUES (?,?,?,?,?,?,?,?)", `p${i}`, h.tenantId, `r${i}@x.test`, `r${i}@x.test`, "S", "B", h.userId, now - i * 1000);
    }
    const r = await send(MESSAGE);
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe("PERSONAL_EMAIL_LIMIT");
    expect(r.json.error.message).toContain("use a campaign");
    expect(google.mailbox).toHaveLength(0);
    // One that is more than a day old no longer counts.
    await h.sql("UPDATE personal_emails SET created_at = ? WHERE id = 'p0'", now - 25 * 60 * 60 * 1000);
    expect((await send(MESSAGE)).status).toBe(201);
  });

  it("counts each organization on its own", async () => {
    await connectGmail(h, SENDER);
    await send(MESSAGE);
    expect((await h.as(GLOBEX).api("GET", "/api/personal-emails")).json).toEqual({ items: [], sentToday: 0, dailyLimit: PERSONAL_EMAILS_PER_DAY, provider: "gmail" });
  });
});

describe("one-to-one email: the connection, failures and access", () => {
  it("needs a connected Gmail account, and records nothing without one", async () => {
    expect((await h.api("DELETE", "/api/sender")).status).toBeLessThan(300);
    const r = await send(MESSAGE);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("SENDER_REQUIRED");
    expect((await h.api("GET", "/api/personal-emails")).json.items).toEqual([]);
  });

  it("does not record a message that failed to send, and says why when it can", async () => {
    await connectGmail(h, SENDER);
    google.sendFailure = { status: 429 };
    const limited = await send(MESSAGE);
    expect(limited.status).toBe(429);
    google.sendFailure = { status: 500, body: { error: { message: "secret backend detail" } } };
    const broken = await send(MESSAGE);
    expect(broken.status).toBe(502);
    expect(JSON.stringify(broken.json)).not.toContain("secret backend detail");
    google.sendFailure = null;
    expect((await h.api("GET", "/api/personal-emails")).json).toMatchObject({ items: [], sentToday: 0 });
  });

  it("is for Administrators and Campaign Managers; a Viewer is refused and nothing is sent", async () => {
    await connectGmail(h, SENDER);
    expect((await send(MESSAGE, await member("campaign-manager"))).status).toBe(201);
    google.mailbox.length = 0;
    const viewer = await member("viewer");
    expect((await send(MESSAGE, viewer)).status).toBe(403);
    expect((await viewer.api("GET", "/api/personal-emails")).status).toBe(403);
    expect((await h.anonymous.api("POST", "/api/personal-emails", MESSAGE)).status).toBe(401);
    expect((await send(MESSAGE, h.as("superadmin@sabertoothsoftwarelabs.net"))).status).toBeGreaterThanOrEqual(401);
    expect(google.mailbox).toHaveLength(0);
  });

  it("refuses a cross-site request", async () => {
    await connectGmail(h, SENDER);
    expect((await h.api("POST", "/api/personal-emails", MESSAGE, { origin: "https://evil.test" })).status).toBe(403);
    expect(google.mailbox).toHaveLength(0);
  });

  it("is private to the organization: another organization never sees these", async () => {
    await connectGmail(h, SENDER);
    await send(MESSAGE);
    expect((await h.as(GLOBEX).api("GET", "/api/personal-emails")).json.items).toEqual([]);
  });
});
