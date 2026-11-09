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
  // Test emails are sent in the name of whoever sends them: the default Administrator is Rico Prinsipe.
  expect((await h.api("PATCH", "/api/me", { firstName: "Rico", lastName: "Prinsipe" })).status).toBe(200);
  expect((await h.as(GLOBEX).api("PATCH", "/api/me", { firstName: "Hank", lastName: "Scorpio" })).status).toBe(200);
});
afterAll(async () => { await h.dispose(); });
beforeEach(async () => {
  google.sendFailure = null;
  google.refreshFails = false;
  google.mailbox.length = 0;
  await h.sql("DELETE FROM test_recipients");
  // The compliance rules have their own tests below; everywhere else they are out of the way.
  await h.sql("UPDATE tenants SET require_unsubscribe_link = 0, one_click_unsubscribe = 1, postal_address = ''");
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
  // MIME turns every line break into CRLF; the tests compare with plain "\n".
  const lf = (t: string) => t.replace(/\r\n/g, "\n");
  return { head, text: lf(parts[0] ?? ""), html: lf(parts[1] ?? "") };
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
      expect(header(m.raw, "From")).toBe(`"Rico Prinsipe" <${SENDER}>`);
      expect(m.raw).not.toContain("customer@real.test");
      expect(header(m.raw, "Cc")).toBeUndefined();
      expect(header(m.raw, "Bcc")).toBeUndefined();
    }
  });

  describe("the sender name", () => {
    const fromOf = () => header(google.mailbox.at(-1)!.raw, "From");
    const profile = (firstName: string, lastName: string, who: Caller = h) => who.api("PATCH", "/api/me", { firstName, lastName });
    const setup = async (who: Caller = h, sender = SENDER) => {
      await connectGmail(who, sender);
      await add("qa@acme.test", who === h ? h : who);
    };

    it("is the full name of the logged-in user, with the connected Gmail address behind it", async () => {
      await setup();
      await testSend(await makeCampaign());
      expect(fromOf()).toBe(`"Rico Prinsipe" <${SENDER}>`);
      expect(fromOf()).not.toContain("Sendrix");
      expect(fromOf()).not.toContain("Sabertooth Software Labs"); // not the company's name any more
    });

    it("follows a change to the user's own name, but not a rename of the company", async () => {
      await setup();
      const id = await makeCampaign();
      await profile("Ada", "Lovelace");
      await testSend(id);
      expect(fromOf()).toBe(`"Ada Lovelace" <${SENDER}>`);
      await h.api("PATCH", "/api/tenant", { name: "Acme Holdings Ltd" });
      await testSend(id);
      expect(fromOf()).toBe(`"Ada Lovelace" <${SENDER}>`); // the company name is not the sender
      await h.api("PATCH", "/api/tenant", { name: "Sabertooth Software Labs" });
      await profile("Rico", "Prinsipe");
    });

    it("is whoever presses Send test: another user of the same organization sends in their own name", async () => {
      await setup();
      const manager = await member("campaign-manager");
      const id = await makeCampaign();
      expect((await manager.api("PATCH", "/api/me", { firstName: "Pat", lastName: "Manager" })).status).toBe(200);
      await testSend(id, manager);
      expect(fromOf()).toBe(`"Pat Manager" <${SENDER}>`); // same Gmail account, the manager's name
      await testSend(id);
      expect(fromOf()).toBe(`"Rico Prinsipe" <${SENDER}>`); // and the Administrator sending is Rico
    });

    it("is each user's own, in every organization", async () => {
      const globex = h.as(GLOBEX);
      await connectGmail(globex, "sales@globex.test");
      await add("qa@globex.test", globex);
      await testSend(await makeCampaign({}, globex), globex);
      expect(fromOf()).toBe('"Hank Scorpio" <sales@globex.test>');
    });

    it("falls back to the company's name, never a bare address, for a user who has no name", async () => {
      await setup();
      const email = uniqueEmail("nameless");
      await h.sql("INSERT INTO users (id,tenant_id,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", `u-${email}`, h.tenantId, "", email, email, "x", "campaign-manager", "Active", 1, 1);
      const nameless = h.as(email);
      await testSend(await makeCampaign(), nameless);
      expect(fromOf()).toBe(`"Sabertooth Software Labs" <${SENDER}>`);
    });

    it("cannot be used to inject headers or break the address, and keeps non-English names readable", async () => {
      await setup();
      const id = await makeCampaign();
      await profile('Evil "Quote"', "<x@y.test>");
      await testSend(id);
      expect(fromOf()).toBe(`"Evil Quote x@y.test" <${SENDER}>`);
      expect(header(google.mailbox.at(-1)!.raw, "Bcc")).toBeUndefined();
      await profile("Café", "Müller");
      await testSend(id);
      expect(fromOf()).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <sales@sabertooth\.test>$/);
      expect(Buffer.from(/\?B\?(.*?)\?=/.exec(fromOf()!)![1]!, "base64").toString("utf8")).toBe("Café Müller");
      await profile("Rico", "Prinsipe");
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

  it("builds the plain-text part from the HTML, since there is no separate plain-text body", async () => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    await testSend(await makeCampaign({ htmlBody: "<style>p{}</style><p>One &amp; two</p><p>Three <a href=\"https://x.test/a\">link</a></p>" }));
    expect(decode(google.mailbox[0]!.raw).text.replace(/\r\n/g, "\n")).toBe("One & two\nThree link (https://x.test/a)");
  });

  it("ignores an old plain-text body: the text and HTML parts always say the same", async () => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    await h.sql("UPDATE campaigns SET text_body = ? WHERE id = ?", "Stale plain text", await makeCampaign({ htmlBody: "<p>Fresh HTML</p>" }));
    const id = (await h.rows<{ id: string }>("SELECT id FROM campaigns WHERE text_body = 'Stale plain text'"))[0]!.id;
    await testSend(id);
    const sent = decode(google.mailbox[0]!.raw);
    expect(sent.text).toBe("Fresh HTML");
    expect(sent.text).not.toContain("Stale");
  });

  describe("the signature", () => {
    const SIGNATURE = "<p>Best regards,<br/>Rico Prinsipe<br/>Marketing Admin | Sabertooth Software Labs<br/>sabertoothsoftwarelabs.net</p>";
    const sentOnce = async (campaign: Record<string, unknown>) => {
      await connectGmail(h, SENDER);
      await add("qa@acme.test");
      google.mailbox.length = 0;
      expect((await testSend(await makeCampaign(campaign))).status).toBe(200);
      return decode(google.mailbox[0]!.raw);
    };

    it("is in the HTML and in the plain text of the test email", async () => {
      const sent = await sentOnce({ htmlBody: "<p>Hello</p>", signature: SIGNATURE });
      expect(sent.html).toContain("Best regards,<br/>Rico Prinsipe<br/>Marketing Admin | Sabertooth Software Labs<br/>sabertoothsoftwarelabs.net");
      expect(sent.text.replace(/\r\n/g, "\n")).toBe(`Hello\n\nBest regards,\nRico Prinsipe\nMarketing Admin | Sabertooth Software Labs\nsabertoothsoftwarelabs.net`);
    });

    it("always goes right after the body, and an old {{signature}} tag in the body is dropped, not shown", async () => {
      const appended = await sentOnce({ htmlBody: "<p>Only body</p>", signature: "Cheers" });
      expect(appended.html.indexOf("Only body")).toBeLessThan(appended.html.indexOf("Cheers"));
      const legacy = await sentOnce({ htmlBody: "<p>Top</p>{{signature}}<p>Bottom</p>", signature: "Cheers" });
      expect(legacy.html).not.toContain("{{signature}}");
      expect(legacy.html.indexOf("Bottom")).toBeLessThan(legacy.html.indexOf("Cheers")); // not moved to where the tag was
      expect(legacy.html.split("Cheers")).toHaveLength(2); // and not added twice
    });

    it("adds nothing, and leaves no stray tag, when the campaign has none", async () => {
      const sent = await sentOnce({ htmlBody: "<p>Hello</p>{{signature}}", signature: "" });
      expect(sent.html).toBe("<p>Hello</p>");
      expect(sent.text).toBe("Hello");
    });

    it("keeps its formatting: bold, italic, links and lists are sent as written", async () => {
      const signature = '<p>Thanks,<br/><strong>Rico</strong> <em>Prinsipe</em></p><ul><li><p>one</p></li><li><p>two</p></li></ul><p><a href="https://acme.test">acme.test</a></p>';
      const sent = await sentOnce({ htmlBody: "<p>Hello</p>", signature });
      expect(sent.html).toContain(signature);
    });

    it("is in the plain-text part as text: formatting dropped, links kept, a list as dashes", async () => {
      const sent = await sentOnce({ htmlBody: "<p>Hello</p>", signature: '<p>Thanks,<br/><strong>Rico</strong></p><ul><li><p>one</p></li><li><p>two</p></li></ul><p><a href="https://acme.test">acme.test</a></p>' });
      expect(sent.text).toContain("Thanks,\nRico");
      expect(sent.text).toContain("- one\n");
      expect(sent.text).toContain("- two");
      expect(sent.text).toContain("acme.test (https://acme.test)");
      expect(sent.text).not.toMatch(/<\w|<\/\w/);
    });

    it("adds nothing for what an empty editor holds", async () => {
      const sent = await sentOnce({ htmlBody: "<p>Hello</p>", signature: "<p></p>" });
      expect(sent.html).toBe("<p>Hello</p>");
    });

    it("has its merge fields filled in with the sample data, like the body", async () => {
      const sent = await sentOnce({ htmlBody: "<p>Hello</p>", signature: "<p>P.S. {{firstName}} at {{companyName}}</p>" });
      expect(sent.html).toContain("P.S. Alex at Example Co");
      expect(sent.html).not.toContain("{{");
    });

    it("is part of what the saved draft says: a later edit is what gets sent", async () => {
      await connectGmail(h, SENDER);
      await add("qa@acme.test");
      const id = await makeCampaign({ signature: "First" });
      await h.api("PATCH", `/api/campaigns/${id}`, { signature: "Second" });
      google.mailbox.length = 0;
      await testSend(id);
      expect(decode(google.mailbox[0]!.raw).html).toContain("Second");
      expect(decode(google.mailbox[0]!.raw).html).not.toContain("First");
    });
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

describe("compliance rules apply to a test send exactly as they will to a real one", () => {
  const settings = (body: Record<string, unknown>) => h.api("PATCH", "/api/tenant", body);
  const sendOne = async (campaign: Record<string, unknown> = {}) => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    google.mailbox.length = 0;
    const r = await testSend(await makeCampaign(campaign));
    return { r, sent: google.mailbox.length ? decode(google.mailbox[0]!.raw) : null, raw: google.mailbox[0]?.raw ?? "" };
  };

  describe("require an unsubscribe link: the standard footer", () => {
    it("is ON for every organization from the start, new and existing", async () => {
      const rows = await h.rows<{ require_unsubscribe_link: number; one_click_unsubscribe: number }>("SELECT require_unsubscribe_link, one_click_unsubscribe FROM tenants");
      expect(rows.length).toBeGreaterThan(1);
      const fresh = await h.addTenant("Brand New Co", "boss@brandnew.test");
      const [row] = await h.rows<{ require_unsubscribe_link: number; one_click_unsubscribe: number }>("SELECT require_unsubscribe_link, one_click_unsubscribe FROM tenants WHERE id = ?", fresh.tenantId);
      expect(row).toEqual({ require_unsubscribe_link: 1, one_click_unsubscribe: 1 });
      expect((await h.as("boss@brandnew.test").api("GET", "/api/me")).json.tenant).toMatchObject({ requireUnsubscribeLink: true, oneClickUnsubscribe: true });
    });

    it("adds the standard footer to every email when ON, to a body that has no link of its own, and so never refuses a campaign", async () => {
      await settings({ requireUnsubscribeLink: true });
      const { r, sent } = await sendOne({ htmlBody: "<p>No link here</p>" });
      expect(r.status).toBe(200);
      expect(sent!.html).toContain("<hr/>\n<p style=\"font-size:12px;color:#666;\">\nYou're receiving this email because we believe our services may be relevant to your business.<br/>\n<a href=\"");
      expect(sent!.html).toContain(">Unsubscribe</a><br/>\nSabertooth Software Labs\n</p>");
    });

    it("is exactly the footer given, with the company name last, and nothing left unfilled", async () => {
      await settings({ requireUnsubscribeLink: true });
      const { sent } = await sendOne({ htmlBody: "<p>Body</p>" });
      const footer = sent!.html.slice(sent!.html.indexOf("<hr/>"));
      expect(footer.replace(/href="[^"]+"/, 'href="LINK"')).toBe(`<hr/>
<p style="font-size:12px;color:#666;">
You're receiving this email because we believe our services may be relevant to your business.<br/>
<a href="LINK">Unsubscribe</a><br/>
Sabertooth Software Labs
</p>`);
      expect(sent!.html).not.toContain("{{");
    });

    it("shows the SENDING company's name, not the recipient's: it follows a rename, and is escaped", async () => {
      await settings({ requireUnsubscribeLink: true, name: "Acme & <Sons>" });
      const { sent } = await sendOne({ htmlBody: "<p>Hi {{companyName}}</p>" });
      expect(sent!.html).toContain("<p>Hi Example Co</p>"); // the body's merge field is the contact's company
      expect(sent!.html).toContain("<br/>\nAcme &amp; &lt;Sons&gt;\n</p>"); // the footer is ours
      await settings({ name: "Sabertooth Software Labs" });
    });

    it("cannot be edited or removed by the campaign: it is not a field, and a body cannot suppress it", async () => {
      await settings({ requireUnsubscribeLink: true });
      expect((await h.api("POST", "/api/campaigns", { name: "N", subject: "S", htmlBody: "<p>x</p>", footer: "<p>mine</p>" })).status).toBe(400);
      const { sent } = await sendOne({ htmlBody: "<p>Mine</p><!-- no footer please -->" });
      expect(sent!.html).toContain("Unsubscribe</a>");
    });

    it("is left out, and nothing is refused, when the organization turned the option off", async () => {
      await settings({ requireUnsubscribeLink: false });
      const { r, sent } = await sendOne({ htmlBody: "<p>No link here</p>" });
      expect(r.status).toBe(200);
      expect(sent!.html).toBe("<p>No link here</p>");
      expect(sent!.html).not.toContain("Unsubscribe");
    });

    it("is each organization's own setting", async () => {
      await settings({ requireUnsubscribeLink: false });
      const globex = h.as(GLOBEX);
      await globex.api("PATCH", "/api/tenant", { requireUnsubscribeLink: true });
      await connectGmail(globex, "sales@globex.test");
      await add("qa@globex.test", globex);
      google.mailbox.length = 0;
      await testSend(await makeCampaign({ htmlBody: "<p>No link</p>" }, globex), globex);
      const theirs = decode(google.mailbox[0]!.raw);
      expect(theirs.html).toContain("Unsubscribe</a><br/>\nGlobex Corp\n</p>");
      await connectGmail(h, SENDER);
      await add("qa@acme.test");
      google.mailbox.length = 0;
      await testSend(await makeCampaign({ htmlBody: "<p>No link</p>" }));
      expect(decode(google.mailbox[0]!.raw).html).toBe("<p>No link</p>");
    });
  });

  describe("the unsubscribe link in the footer", () => {
    const linkIn = (html: string) => /<a href="([^"]+)">Unsubscribe<\/a>/.exec(html)![1]!;
    const tokenOf = (url: string) => url.split("/unsubscribe/")[1]!;

    it("points at the app's unsubscribe page, with a signed token for that recipient", async () => {
      await settings({ requireUnsubscribeLink: true });
      const { sent } = await sendOne();
      const url = linkIn(sent!.html);
      expect(url).toMatch(/^http:\/\/localhost:5173\/unsubscribe\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });

    it("is a working link: the page's endpoint accepts it, and says it came from a test", async () => {
      await settings({ requireUnsubscribeLink: true });
      const { sent } = await sendOne();
      const r = await h.anonymous.api("GET", `/api/unsubscribe/${tokenOf(linkIn(sent!.html))}`);
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ test: true, companyName: "Sabertooth Software Labs", alreadyUnsubscribed: false, email: "q***@acme.test" });
    });

    it("unsubscribes nobody when pressed: the allowlist address is not put on the suppression list", async () => {
      await settings({ requireUnsubscribeLink: true });
      const { sent } = await sendOne();
      const r = await h.anonymous.api("POST", `/api/unsubscribe/${tokenOf(linkIn(sent!.html))}`);
      expect(r.json).toMatchObject({ unsubscribed: false, test: true });
      expect(await h.rows("SELECT id FROM suppressions WHERE normalized_email = 'qa@acme.test'")).toHaveLength(0);
    });

    it("is different for every recipient of a test, and each is for that recipient's own address", async () => {
      await settings({ requireUnsubscribeLink: true });
      await connectGmail(h, SENDER);
      await add("one@acme.test");
      await add("two@acme.test");
      google.mailbox.length = 0;
      await testSend(await makeCampaign());
      const urls = google.mailbox.map((m) => linkIn(decode(m.raw).html));
      expect(new Set(urls).size).toBe(2);
      expect((await h.anonymous.api("GET", `/api/unsubscribe/${tokenOf(urls[0]!)}`)).json.email).toBe("o***@acme.test");
      expect((await h.anonymous.api("GET", `/api/unsubscribe/${tokenOf(urls[1]!)}`)).json.email).toBe("t***@acme.test");
    });

    it("is also where a body's own {{unsubscribeUrl}} points", async () => {
      await settings({ requireUnsubscribeLink: true });
      const { sent } = await sendOne({ htmlBody: '<p><a href="{{unsubscribeUrl}}">stop mailing me</a></p>' });
      const links = [...sent!.html.matchAll(/href="(http:\/\/localhost:5173\/unsubscribe\/[^"]+)"/g)].map((m) => m[1]);
      expect(links).toHaveLength(2);
      expect(links[0]).toBe(links[1]);
    });

    it("is in the plain-text part too, as the full address", async () => {
      await settings({ requireUnsubscribeLink: true });
      const { sent } = await sendOne();
      expect(sent!.text).toMatch(/Unsubscribe \(http:\/\/localhost:5173\/unsubscribe\/[A-Za-z0-9_.-]+\)/);
      expect(sent!.text.replace(/\r\n/g, "\n").trimEnd().endsWith("Sabertooth Software Labs")).toBe(true);
    });
  });

  describe("one-click List-Unsubscribe headers", () => {
    it("are added when ON (the default), with the unsubscribe address and the one-click marker", async () => {
      await settings({ oneClickUnsubscribe: true });
      const { raw } = await sendOne();
      expect(header(raw, "List-Unsubscribe")).toMatch(/^<http:\/\/localhost:5173\/api\/unsubscribe\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+>$/);
      expect(header(raw, "List-Unsubscribe-Post")).toBe("List-Unsubscribe=One-Click");
    });

    it("point at the real one-click endpoint, with the same token as the link in the footer, and a POST there works", async () => {
      await settings({ oneClickUnsubscribe: true, requireUnsubscribeLink: true });
      const { raw, sent } = await sendOne();
      const headerUrl = /<([^>]+)>/.exec(header(raw, "List-Unsubscribe")!)![1]!;
      const pageUrl = /<a href="([^"]+)">Unsubscribe<\/a>/.exec(sent!.html)![1]!;
      expect(headerUrl.split("/api/unsubscribe/")[1]).toBe(pageUrl.split("/unsubscribe/")[1]);
      const path = new URL(headerUrl).pathname;
      const r = await h.anonymous.api("POST", path, "List-Unsubscribe=One-Click", { "content-type": "application/x-www-form-urlencoded" });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ test: true, unsubscribed: false }); // a test email's link changes nothing
    });

    it("are left out when the organization turned them off", async () => {
      await settings({ oneClickUnsubscribe: false });
      const { r, raw } = await sendOne();
      expect(r.status).toBe(200);
      expect(header(raw, "List-Unsubscribe")).toBeUndefined();
      expect(header(raw, "List-Unsubscribe-Post")).toBeUndefined();
    });

    it("are on every message of a test to several addresses", async () => {
      await settings({ oneClickUnsubscribe: true });
      await connectGmail(h, SENDER);
      await add("a@acme.test");
      await add("b@acme.test");
      google.mailbox.length = 0;
      await testSend(await makeCampaign());
      expect(google.mailbox).toHaveLength(2);
      for (const m of google.mailbox) expect(header(m.raw, "List-Unsubscribe-Post")).toBe("List-Unsubscribe=One-Click");
    });

    it("follow the setting as it changes", async () => {
      await settings({ oneClickUnsubscribe: false });
      expect(header((await sendOne()).raw, "List-Unsubscribe")).toBeUndefined();
      await settings({ oneClickUnsubscribe: true });
      expect(header((await sendOne()).raw, "List-Unsubscribe")).toBeTruthy();
    });

    it("do not depend on the other option", async () => {
      await settings({ requireUnsubscribeLink: false, oneClickUnsubscribe: true });
      expect(header((await sendOne({ htmlBody: "<p>No link</p>" })).raw, "List-Unsubscribe")).toBeTruthy();
    });
  });

  describe("the company's postal address in the footer", () => {
    it("is added to the end of every email, after the body and the signature, in the HTML and the plain text", async () => {
      await settings({ postalAddress: "Acme Inc.\n100 Main Street\nSpringfield" });
      const { sent } = await sendOne({ htmlBody: "<p>Hello</p>", signature: "Cheers" });
      expect(sent!.html).toContain('<p style="font-size:12px;color:#666666">Acme Inc.<br/>100 Main Street<br/>Springfield</p>');
      expect(sent!.html.indexOf("Cheers")).toBeLessThan(sent!.html.indexOf("Acme Inc."));
      expect(sent!.html.trimEnd().endsWith("Springfield</p>")).toBe(true);
      const text = sent!.text.replace(/\r\n/g, "\n");
      expect(text).toContain("Cheers");
      expect(text.trimEnd().endsWith("Acme Inc.\n100 Main Street\nSpringfield")).toBe(true);
    });

    it("is the address saved in Company Details: change it and the next email shows the new one", async () => {
      await settings({ postalAddress: "Old Address 1" });
      expect((await sendOne()).sent!.html).toContain("Old Address 1");
      await settings({ postalAddress: "New Address 2" });
      const next = (await sendOne()).sent!;
      expect(next.html).toContain("New Address 2");
      expect(next.html).not.toContain("Old Address 1");
    });

    it("adds nothing when there is no address", async () => {
      const { sent } = await sendOne({ htmlBody: "<p>Hello</p>" });
      expect(sent!.html).toBe("<p>Hello</p>");
    });

    it("is escaped, so markup in it cannot become HTML", async () => {
      await settings({ postalAddress: "<script>alert(1)</script> & Co" });
      const { sent } = await sendOne();
      expect(sent!.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co");
      expect(sent!.html).not.toContain("<script>");
    });

    it("is each organization's own", async () => {
      await settings({ postalAddress: "Acme Street" });
      const globex = h.as(GLOBEX);
      await globex.api("PATCH", "/api/tenant", { postalAddress: "Globex Street" });
      await connectGmail(globex, "sales@globex.test");
      await add("qa@globex.test", globex);
      google.mailbox.length = 0;
      await testSend(await makeCampaign({}, globex), globex);
      const sent = decode(google.mailbox[0]!.raw);
      expect(sent.html).toContain("Globex Street");
      expect(sent.html).not.toContain("Acme Street");
    });
  });
});

describe("the structure of the email: body, signature, standard footer, postal address", () => {
  const sendOne = async (campaign: Record<string, unknown> = {}) => {
    await connectGmail(h, SENDER);
    await add("qa@acme.test");
    google.mailbox.length = 0;
    const r = await testSend(await makeCampaign(campaign));
    return { r, sent: google.mailbox.length ? decode(google.mailbox[0]!.raw) : null };
  };

  it("sends the body, then the signature, then the standard footer, then the postal address, in that order", async () => {
    await h.api("PATCH", "/api/tenant", { requireUnsubscribeLink: true, postalAddress: "Acme Inc.\n1 Road" });
    const { sent } = await sendOne({ htmlBody: "<p>The message</p>", signature: "<p>Best regards,<br/>Rico</p>" });
    const at = (needle: string) => sent!.html.indexOf(needle);
    expect(at("The message")).toBeGreaterThan(-1);
    expect(at("The message")).toBeLessThan(at("Best regards,<br/>Rico"));
    expect(at("Best regards,<br/>Rico")).toBeLessThan(at("<hr/>"));
    expect(at("<hr/>")).toBeLessThan(at("You're receiving this email"));
    expect(at("You're receiving this email")).toBeLessThan(at("Unsubscribe</a>"));
    expect(at("Unsubscribe</a>")).toBeLessThan(at("Acme Inc.<br/>1 Road"));
    expect(sent!.html.trimEnd().endsWith("Acme Inc.<br/>1 Road</p>")).toBe(true);
  });

  it("has the same order in the plain-text part", async () => {
    await h.api("PATCH", "/api/tenant", { requireUnsubscribeLink: true, postalAddress: "Acme Inc.\n1 Road" });
    const { sent } = await sendOne({ htmlBody: "<p>The message</p>", signature: "Cheers" });
    const text = sent!.text.replace(/\r\n/g, "\n");
    const at = (needle: string) => text.indexOf(needle);
    expect(at("The message")).toBeLessThan(at("Cheers"));
    expect(at("Cheers")).toBeLessThan(at("You're receiving this email"));
    expect(at("You're receiving this email")).toBeLessThan(at("Acme Inc."));
  });

  it("adds no footer of its own beyond these: the body is just what the user wrote", async () => {
    await h.api("PATCH", "/api/tenant", { requireUnsubscribeLink: true, postalAddress: "" });
    const { sent } = await sendOne({ htmlBody: "<p>The message</p>", signature: "" });
    expect(sent!.html.startsWith("<p>The message</p>\n<hr/>")).toBe(true);
    expect((sent!.html.match(/<hr\/>/g) ?? []).length).toBe(1);
  });
});
