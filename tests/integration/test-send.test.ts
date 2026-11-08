import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_TEST_RECIPIENTS } from "../../src/shared/schemas";
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
});
afterAll(async () => { await h.dispose(); });
beforeEach(async () => {
  google.sendFailure = null;
  google.refreshFails = false;
  google.mailbox.length = 0;
  await h.sql("DELETE FROM test_recipients");
});

async function connectGmail(who: Caller, email: string) {
  const start = await who.api("POST", "/api/sender/gmail/connect");
  expect((await who.text(google.consent(start.json.url, { email }))).status).toBe(302);
}

async function member(accessId: string) {
  const email = uniqueEmail(accessId);
  await h.sql("INSERT INTO users (id,tenant_id,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", `u-${email}`, h.tenantId, "M", email, email, "x", accessId, "Active", 1, 1);
  return h.as(email);
}

const add = (email: unknown, who: Caller = h) => who.api("POST", "/api/test-recipients", { email });
const list = async (who: Caller = h) => ((await who.api("GET", "/api/test-recipients")).json.items as { id: string; email: string; addedBy: string }[]);
const emailsOf = async (who: Caller = h) => (await list(who)).map((r) => r.email);

async function makeCampaign(over: Record<string, unknown> = {}, who: Caller = h) {
  const r = await who.api("POST", "/api/campaigns", { name: "Outreach", subject: "Hello {{firstName}}", htmlBody: '<p>Hi {{firstName}} from {{companyName}}. <a href="{{unsubscribeUrl}}">Unsubscribe</a></p>', ...over });
  expect(r.status).toBe(201);
  return r.json.id as string;
}
const testSend = (id: string, who: Caller = h, body?: unknown) => who.api("POST", `/api/campaigns/${id}/test-send`, body);

/** The decoded parts of a message Gmail was asked to send. */
function decode(raw: string) {
  const head = raw.split("\r\n\r\n")[0]!;
  const parts = raw
    .split(/--=_sendrix_[0-9a-f]+/)
    .slice(1)
    .filter((p) => p.trim() && p.trim() !== "--")
    .map((p) => Buffer.from(p.split("\r\n\r\n").slice(1).join("").replace(/\s+/g, ""), "base64").toString("utf8"));
  return { head, text: parts[0] ?? "", html: parts[1] ?? "" };
}
const header = (raw: string, name: string) => new RegExp(`^${name}: (.*)$`, "m").exec(raw.split("\r\n\r\n")[0]!)?.[1];

describe("the allowlist", () => {
  it("starts empty", async () => {
    expect((await h.api("GET", "/api/test-recipients")).json).toEqual({ items: [] });
  });

  it("saves an address, lists it, and says who added it", async () => {
    const r = await add("QA@Acme.test");
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ email: "QA@Acme.test", addedBy: h.adminEmail });
    expect(r.json.id).toBeTruthy();
    expect(await list()).toHaveLength(1);
    const row = (await h.rows<{ email: string; normalized_email: string; tenant_id: string }>("SELECT * FROM test_recipients"))[0]!;
    expect(row).toMatchObject({ email: "QA@Acme.test", normalized_email: "qa@acme.test", tenant_id: h.tenantId });
  });

  it("keeps the order they were added in, and trims what was typed", async () => {
    await add("  first@acme.test ");
    await add("second@acme.test");
    expect(await emailsOf()).toEqual(["first@acme.test", "second@acme.test"]);
  });

  it("refuses an address that is already there, whatever its letter case", async () => {
    await add("qa@acme.test");
    const r = await add("QA@ACME.TEST");
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("TEST_RECIPIENT_EXISTS");
    expect(r.json.error.details).toEqual([{ path: "email", message: "That address is already on the list" }]);
    expect(await list()).toHaveLength(1);
  });

  it("rejects things that are not a single plain address, and anything else in the body", async () => {
    for (const body of [{ email: "" }, { email: "   " }, { email: "nope" }, { email: "a@b" }, { email: "a@b.test, c@d.test" }, { email: "Name <a@b.test>" }, { email: `${"x".repeat(320)}@a.test` }, { email: 5 }, { email: null }, {}, { email: "a@b.test", tenantId: "other" }]) {
      expect((await h.api("POST", "/api/test-recipients", body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await h.api("POST", "/api/test-recipients", "{nope")).status).toBe(400);
    expect(await list()).toHaveLength(0);
  });

  it(`holds at most ${MAX_TEST_RECIPIENTS} addresses`, async () => {
    for (let i = 0; i < MAX_TEST_RECIPIENTS; i++) expect((await add(`a${i}@acme.test`)).status).toBe(201);
    const r = await add("one-too-many@acme.test");
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("TOO_MANY_TEST_RECIPIENTS");
    expect(await list()).toHaveLength(MAX_TEST_RECIPIENTS);
    const first = (await list())[0]!;
    expect((await h.api("DELETE", `/api/test-recipients/${first.id}`)).status).toBe(204);
    expect((await add("now-it-fits@acme.test")).status).toBe(201);
  });

  it("removes an address, and 404s for one that is not there", async () => {
    const keep = (await add("keep@acme.test")).json;
    const drop = (await add("drop@acme.test")).json;
    expect((await h.api("DELETE", `/api/test-recipients/${drop.id}`)).status).toBe(204);
    expect(await emailsOf()).toEqual(["keep@acme.test"]);
    expect((await h.api("DELETE", `/api/test-recipients/${drop.id}`)).status).toBe(404);
    expect((await h.api("DELETE", "/api/test-recipients/nope")).status).toBe(404);
    expect(keep.id).toBeTruthy();
  });

  it("can be added again after being removed", async () => {
    const r = (await add("again@acme.test")).json;
    await h.api("DELETE", `/api/test-recipients/${r.id}`);
    expect((await add("again@acme.test")).status).toBe(201);
  });

  it("everyone signed in can read it, but only Administrators can change it", async () => {
    const saved = (await add("qa@acme.test")).json;
    for (const level of ["campaign-manager", "viewer"]) {
      const who = await member(level);
      expect(await emailsOf(who), level).toEqual(["qa@acme.test"]);
      expect((await add("sneaky@acme.test", who)).status, level).toBe(403);
      expect((await who.api("DELETE", `/api/test-recipients/${saved.id}`)).status, level).toBe(403);
    }
    expect(await emailsOf()).toEqual(["qa@acme.test"]);
  });

  it("is private to the organization: lists, adds and removals never cross over", async () => {
    const mine = (await add("mine@acme.test")).json;
    const globex = h.as(GLOBEX);
    expect(await emailsOf(globex)).toEqual([]);
    expect((await add("mine@acme.test", globex)).status).toBe(201); // the same address is theirs to add
    expect((await globex.api("DELETE", `/api/test-recipients/${mine.id}`)).status).toBe(404);
    expect(await emailsOf()).toEqual(["mine@acme.test"]);
    expect(await emailsOf(globex)).toEqual(["mine@acme.test"]);
  });

  it("needs a session, and refuses a cross-site request", async () => {
    expect((await h.anonymous.api("GET", "/api/test-recipients")).status).toBe(401);
    expect((await h.anonymous.api("POST", "/api/test-recipients", { email: "a@b.test" })).status).toBe(401);
    expect((await h.api("POST", "/api/test-recipients", { email: "a@b.test" }, { origin: "https://evil.test" })).status).toBe(403);
    expect(await list()).toHaveLength(0);
  });
});

describe("sending a test", () => {
  it("mails every address on the allowlist, one message each, from the connected account, and nobody else", async () => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    await add("pm@acme.test");
    const id = await makeCampaign();
    // contacts and recipients exist, and must not be mailed
    await h.api("POST", "/api/contacts", { email: "customer@real.test", firstName: "Real" });

    const r = await testSend(id);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ sent: ["qa@acme.test", "pm@acme.test"] });
    expect(google.mailbox).toHaveLength(2);
    expect(google.mailbox.map((m) => header(m.raw, "To"))).toEqual(["qa@acme.test", "pm@acme.test"]);
    for (const m of google.mailbox) {
      expect(m.from).toBe(SENDER);
      expect(header(m.raw, "From")).toBe(`"Sabertooth Software Labs" <${SENDER}>`);
      expect(m.raw).not.toContain("customer@real.test");
      expect(header(m.raw, "Cc")).toBeUndefined();
      expect(header(m.raw, "Bcc")).toBeUndefined();
    }
  });

  describe("the sender name", () => {
    const fromOf = () => header(google.mailbox.at(-1)!.raw, "From");
    const rename = (name: string, who: Caller = h) => who.api("PATCH", "/api/tenant", { name });

    it("is the organization's name, with the connected Gmail address behind it", async () => {
      await connectGmail(h, SENDER);
      await add("qa@acme.test");
      await testSend(await makeCampaign());
      expect(fromOf()).toBe(`"Sabertooth Software Labs" <${SENDER}>`);
      expect(fromOf()).not.toContain("Sendrix");
    });

    it("follows a rename of the organization", async () => {
      await connectGmail(h, SENDER);
      await add("qa@acme.test");
      const id = await makeCampaign();
      await rename("Acme Holdings Ltd");
      await testSend(id);
      expect(fromOf()).toBe(`"Acme Holdings Ltd" <${SENDER}>`);
      await rename("Sabertooth Software Labs");
    });

    it("is each organization's own", async () => {
      const globex = h.as(GLOBEX);
      await connectGmail(globex, "sales@globex.test");
      await add("qa@globex.test", globex);
      await testSend(await makeCampaign({}, globex), globex);
      expect(fromOf()).toBe('"Globex Corp" <sales@globex.test>');
    });

    it("cannot be used to inject headers or break the address, and keeps non-English names readable", async () => {
      await connectGmail(h, SENDER);
      await add("qa@acme.test");
      const id = await makeCampaign();
      await rename('Evil "Quote" <x@y.test>');
      await testSend(id);
      expect(fromOf()).toBe(`"Evil Quote x@y.test" <${SENDER}>`);
      expect(header(google.mailbox.at(-1)!.raw, "Bcc")).toBeUndefined();
      await rename("Café Müller GmbH");
      await testSend(id);
      expect(fromOf()).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <sales@sabertooth\.test>$/);
      expect(Buffer.from(/\?B\?(.*?)\?=/.exec(fromOf()!)![1]!, "base64").toString("utf8")).toBe("Café Müller GmbH");
      await rename("Sabertooth Software Labs");
    });
  });

  it("marks the subject as a test and fills in the merge fields with sample data", async () => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    await testSend(await makeCampaign());
    const sent = decode(google.mailbox[0]!.raw);
    expect(header(google.mailbox[0]!.raw, "Subject")).toBe("[TEST] Hello Alex");
    expect(sent.html).toContain("Hi Alex from Example Co.");
    expect(sent.html).not.toContain("{{");
    expect(sent.text).toContain("Hi Alex from Example Co.");
    expect(sent.text).not.toMatch(/<\w|{{/);
  });

  it("uses the plain-text body when the campaign has one, and builds one from the HTML when it does not", async () => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    await testSend(await makeCampaign({ textBody: "Plain hello {{firstName}}" }));
    expect(decode(google.mailbox[0]!.raw).text).toBe("Plain hello Alex");
    google.mailbox.length = 0;
    await testSend(await makeCampaign({ textBody: null, htmlBody: "<style>p{}</style><p>One &amp; two</p><p>Three <a href=\"https://x.test/a\">link</a></p>" }));
    expect(decode(google.mailbox[0]!.raw).text.replace(/\r\n/g, "\n")).toBe("One & two\nThree link (https://x.test/a)");
  });

  it("goes only where the allowlist says: addresses in the request are ignored", async () => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    const id = await makeCampaign();
    for (const body of [{ to: "evil@x.test" }, { email: "evil@x.test" }, { recipients: ["evil@x.test"] }, "evil@x.test"]) {
      google.mailbox.length = 0;
      const r = await testSend(id, h, body);
      expect(r.status, JSON.stringify(body)).toBe(200);
      expect(google.mailbox.map((m) => header(m.raw, "To"))).toEqual(["qa@acme.test"]);
      expect(google.mailbox[0]!.raw).not.toContain("evil@x.test");
    }
  });

  it("uses the list as it is now: an added address receives it, a removed one does not", async () => {
    await connectGmail(h, SENDER);
    const a = (await add("a@acme.test")).json;
    await add("b@acme.test");
    const id = await makeCampaign();
    await h.api("DELETE", `/api/test-recipients/${a.id}`);
    await add("c@acme.test");
    await testSend(id);
    expect(google.mailbox.map((m) => header(m.raw, "To"))).toEqual(["b@acme.test", "c@acme.test"]);
  });

  it("does not launch anything: the campaign and its recipients are untouched", async () => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    const id = await makeCampaign();
    const before = (await h.api("GET", `/api/campaigns/${id}`)).json;
    await testSend(id);
    const after = (await h.api("GET", `/api/campaigns/${id}`)).json;
    expect(after.status).toBe("Draft");
    expect(after).toEqual(before);
    expect(await h.rows("SELECT id FROM campaign_recipients WHERE campaign_id = ?", id)).toHaveLength(0);
  });

  it("works for a campaign that is already running, too", async () => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    const id = await makeCampaign();
    await h.sql("UPDATE campaigns SET status = 'Paused' WHERE id = ?", id);
    expect((await testSend(id)).status).toBe(200);
  });

  it("can be run again and again", async () => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    const id = await makeCampaign();
    await testSend(id);
    await testSend(id);
    expect(google.mailbox).toHaveLength(2);
  });

  it("asks for an address first when the allowlist is empty, and sends nothing", async () => {
    await connectGmail(h, SENDER);
    const r = await testSend(await makeCampaign());
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("NO_TEST_RECIPIENTS");
    expect(google.mailbox).toHaveLength(0);
  });

  it("needs a connected Gmail account", async () => {
    await h.api("DELETE", "/api/sender"); // earlier tests connected one
    await add("qa@acme.test");
    const r = await testSend(await makeCampaign());
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("SENDER_REQUIRED");
    expect(google.mailbox).toHaveLength(0);
  });

  it("is for Administrators and Campaign Managers; a Viewer is refused and nothing is sent", async () => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    const id = await makeCampaign();
    expect((await testSend(id, await member("viewer"))).status).toBe(403);
    expect(google.mailbox).toHaveLength(0);
    expect((await testSend(id, await member("campaign-manager"))).status).toBe(200);
    expect(google.mailbox).toHaveLength(1);
  });

  it("404s for a campaign that is not found or belongs to another organization, and sends nothing", async () => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    const globex = h.as(GLOBEX);
    await connectGmail(globex, "sales@globex.test");
    await add("qa@globex.test", globex);
    const theirs = await makeCampaign({}, globex);
    google.mailbox.length = 0;
    expect((await testSend(theirs)).status).toBe(404);
    expect((await testSend("does-not-exist")).status).toBe(404);
    expect(google.mailbox).toHaveLength(0);
  });

  it("each organization's tests use its own allowlist and its own Gmail account", async () => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    const globex = h.as(GLOBEX);
    await connectGmail(globex, "sales@globex.test");
    await add("qa@globex.test", globex);
    await testSend(await makeCampaign({}, globex), globex);
    expect(google.mailbox).toHaveLength(1);
    expect(google.mailbox[0]).toMatchObject({ from: "sales@globex.test" });
    expect(header(google.mailbox[0]!.raw, "To")).toBe("qa@globex.test");
  });

  it("needs a session, and refuses a cross-site request", async () => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    const id = await makeCampaign();
    expect((await testSend(id, h.anonymous)).status).toBe(401);
    expect((await h.api("POST", `/api/campaigns/${id}/test-send`, undefined, { origin: "https://evil.test" })).status).toBe(403);
    expect(google.mailbox).toHaveLength(0);
  });

  describe("when Gmail refuses", () => {
    const senderStatus = async () => (await h.api("GET", "/api/sender")).json.sender.status;

    it("asks for a reconnect if Google no longer honours the connection, and remembers it", async () => {
      await connectGmail(h, SENDER);
      await add("qa@acme.test");
      const id = await makeCampaign();
      google.refreshFails = true;
      const r = await testSend(id);
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe("SENDER_RECONNECT");
      expect(await senderStatus()).toBe("NeedsReconnect");
      google.refreshFails = false;
      expect((await testSend(id)).json.error.code).toBe("SENDER_RECONNECT"); // refused up front until reconnected
      expect(google.mailbox).toHaveLength(0);
      await connectGmail(h, SENDER);
      expect((await testSend(id)).status).toBe(200);
    });

    it("asks for a reconnect when the send is rejected as unauthorized", async () => {
      await connectGmail(h, SENDER);
      await add("qa@acme.test");
      google.sendFailure = { status: 401 };
      const r = await testSend(await makeCampaign());
      expect(r.json.error.code).toBe("SENDER_RECONNECT");
      expect(await senderStatus()).toBe("NeedsReconnect");
      await connectGmail(h, SENDER);
    });

    it("reports rate limiting as such", async () => {
      await connectGmail(h, SENDER);
      await add("qa@acme.test");
      google.sendFailure = { status: 429 };
      const r = await testSend(await makeCampaign());
      expect(r.status).toBe(429);
      expect(r.json.error.code).toBe("GMAIL_RATE_LIMITED");
      expect(await senderStatus()).toBe("Connected");
    });

    it("reports any other failure plainly, without leaking details", async () => {
      await connectGmail(h, SENDER);
      await add("qa@acme.test");
      google.sendFailure = { status: 500, body: { error: { message: "secret backend detail" } } };
      const r = await testSend(await makeCampaign());
      expect(r.status).toBe(502);
      expect(r.json.error.code).toBe("TEST_SEND_FAILED");
      expect(JSON.stringify(r.json)).not.toContain("secret backend detail");
      expect(await senderStatus()).toBe("Connected");
    });
  });
});
