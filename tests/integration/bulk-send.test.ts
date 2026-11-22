import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EMAIL_FOOTER_ENABLED, LIST_UNSUBSCRIBE_HEADERS_ENABLED } from "../../src/shared/merge";
import { GoogleOAuth } from "../../src/server/services/google-oauth";
import { FakeGoogle } from "./fake-google";
import { startHarness, uniqueEmail, type Caller, type Harness } from "./harness";

const google = new FakeGoogle();
let h: Harness;
const SENDER = "sales@sabertooth.test";
/**
 * The tests pretend to be at these times, in the far future on purpose: launch marks a campaign due at the REAL time, so a
 * pretend time in the past would find nothing due. 15 Jan 2030 is standard time in Los Angeles (UTC-8).
 * 16:59 there is inside the default 09:00 to 17:00 window with one minute of it left, so a pass sends the full batch.
 */
const LAST_MINUTE = Date.UTC(2030, 0, 16, 0, 59, 0);
const NINE_PM = Date.UTC(2030, 0, 16, 5, 0, 0); // 21:00 in Los Angeles: outside the window
const TEN_AM = Date.UTC(2030, 0, 15, 18, 0, 0); // 10:00 in Los Angeles
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  h = await startHarness({ google: new GoogleOAuth(google.fetch) });
  expect((await h.api("PATCH", "/api/me", { firstName: "Rico", lastName: "Prinsipe" })).status).toBe(200);
  expect((await h.api("PATCH", "/api/tenant", { postalAddress: "1 Road\nCebu City" })).status).toBe(200);
  const start = await h.api("POST", "/api/sender/gmail/connect");
  expect((await h.text(google.consent(start.json.url, { email: SENDER }))).status).toBe(302);
  expect((await h.api("PATCH", "/api/sender", { senderName: "Marketing Admin" })).status).toBe(200);
});
afterAll(async () => { await h.dispose(); });
beforeEach(async () => {
  google.sendFailure = null;
  google.refreshFails = false;
  google.mailbox.length = 0;
  await h.sql("DELETE FROM suppressions"); // these point at the campaign an unsubscribe came from
  await h.sql("DELETE FROM campaign_recipients");
  await h.sql("DELETE FROM campaigns");
  await h.sql("DELETE FROM contacts");
  await h.sql("UPDATE sender_accounts SET status = 'Connected'");
  await h.api("PATCH", "/api/tenant", { postalAddress: "1 Road\nCebu City" });
});

const header = (raw: string, name: string) => new RegExp(`^${name}: (.*)$`, "m").exec(raw.split("\r\n\r\n")[0]!)?.[1];
const parts = (raw: string) => {
  const [text = "", html = ""] = raw.split(/--=_sendrix_[0-9a-f]+/).slice(1).filter((p) => p.trim() && p.trim() !== "--")
    .map((p) => Buffer.from(p.split("\r\n\r\n").slice(1).join("").replace(/\s+/g, ""), "base64").toString("utf8").replace(/\r\n/g, "\n"));
  return { text, html };
};
/** The recipient's own unsubscribe link, from the footer of the HTML part (campaign emails carry no List-Unsubscribe header). */
const footerLink = (raw: string) => /href="([^"]*\/unsubscribe\/[^"]+)"/.exec(parts(raw).html)![1]!;
const tokenOf = (raw: string) => JSON.parse(Buffer.from(/\/unsubscribe\/([^."]+)\./.exec(footerLink(raw))![1]!, "base64url").toString("utf8")) as { t: string; e: string; c: string; k: string };

async function contact(email: string, firstName = "", industry = "") {
  const r = await h.api("POST", "/api/contacts", { email, firstName, industry });
  expect(r.status, email).toBe(201);
  return r.json;
}
async function campaign(over: Record<string, unknown> = {}, who: Caller = h) {
  const r = await who.api("POST", "/api/campaigns", { name: "Outreach", subject: "Hello {{firstName}}", htmlBody: "<p>Hi {{firstName}} at {{companyName}}</p>", dailyLimit: 2000, ...over });
  expect(r.status).toBe(201);
  return r.json.id as string;
}
const launch = (id: string, who: Caller = h) => who.api("POST", `/api/campaigns/${id}/launch`);
const tick = (now = LAST_MINUTE, who: Caller = h) => who.api("POST", "/api/campaigns/run-tick", { now });
const get = async (id: string) => (await h.api("GET", `/api/campaigns/${id}`)).json;
const statuses = async (id: string) => (await h.rows<{ email_snapshot: string; status: string; skip_reason: string | null }>("SELECT email_snapshot, status, skip_reason FROM campaign_recipients WHERE campaign_id = ? ORDER BY sequence", id));
const sentTo = () => google.mailbox.map((m) => header(m.raw, "To"));

describe("launching a campaign", () => {
  it("freezes one Pending recipient per contact, in order with their details, makes the campaign Sending, and sends nothing itself", async () => {
    await contact("ann@x.test", "Ann");
    await contact("bob@x.test", "Bob");
    const id = await campaign();
    const r = await launch(id);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ recipients: 2, excluded: 0, campaign: { id, status: "Sending", totals: { Pending: 2 } } });
    expect(r.json.campaign.launchedAt).toBeTruthy();
    expect(google.mailbox).toHaveLength(0);
    expect(await statuses(id)).toEqual([{ email_snapshot: "ann@x.test", status: "Pending", skip_reason: null }, { email_snapshot: "bob@x.test", status: "Pending", skip_reason: null }]);
    const [snap] = await h.rows<{ personalization_snapshot: Record<string, unknown> }>("SELECT personalization_snapshot FROM campaign_recipients WHERE email_snapshot = 'ann@x.test'");
    expect(snap!.personalization_snapshot).toMatchObject({ email: "ann@x.test", firstName: "Ann" }); // jsonb comes back parsed
  });

  it("locks the campaign: its content can no longer be edited, and it cannot be launched twice", async () => {
    await contact("ann@x.test");
    const id = await campaign();
    expect((await launch(id)).status).toBe(200);
    expect((await h.api("PATCH", `/api/campaigns/${id}`, { subject: "Changed" })).status).toBe(409);
    const again = await launch(id);
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("CAMPAIGN_NOT_DRAFT");
    expect((await statuses(id))).toHaveLength(1);
  });

  it("leaves out suppressed and withdrawn contacts, and says how many", async () => {
    await contact("ann@x.test");
    await contact("gone@x.test");
    await contact("withdrew@x.test");
    await h.sql("INSERT INTO suppressions (id,tenant_id,email,normalized_email,reason,created_at) VALUES (?,?,?,?,?,?)", "s1", h.tenantId, "gone@x.test", "gone@x.test", "Unsubscribed", 1);
    await h.sql("UPDATE contacts SET consent_status = 'Withdrawn' WHERE normalized_email = 'withdrew@x.test'");
    const id = await campaign();
    const r = await launch(id);
    expect(r.json).toMatchObject({ recipients: 1, excluded: 2 });
    expect((await statuses(id)).map((s) => s.email_snapshot)).toEqual(["ann@x.test"]);
  });

  it("sends to the chosen industries only", async () => {
    await contact("a@x.test", "A", "construction");
    await contact("b@x.test", "B", "digital marketing");
    await contact("c@x.test", "C", "construction");
    const id = await campaign({ recipientIndustries: ["construction"] });
    expect((await launch(id)).json).toMatchObject({ recipients: 2 });
    expect((await statuses(id)).map((s) => s.email_snapshot).sort()).toEqual(["a@x.test", "c@x.test"]);
  });

  it("refuses when it is not ready, and changes nothing: no address, no sender, nobody to send to, a bad merge field", async () => {
    await contact("ann@x.test");
    const id = await campaign();
    if (EMAIL_FOOTER_ENABLED) {
      // The postal address is only needed while the footer that shows it is on.
      await h.api("PATCH", "/api/tenant", { postalAddress: "" });
      const noAddress = await launch(id);
      expect(noAddress.status).toBe(409);
      expect(noAddress.json.error.code).toBe("POSTAL_ADDRESS_REQUIRED");
      await h.api("PATCH", "/api/tenant", { postalAddress: "1 Road" });
    }

    const typo = await campaign({ subject: "Hi {{frstName}}" });
    const bad = await launch(typo);
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.json.error.details)).toContain("Unknown merge field: {{frstName}}");

    await h.sql("DELETE FROM contacts");
    const nobody = await launch(await campaign());
    expect(nobody.status).toBe(409);
    expect(nobody.json.error.code).toBe("NO_RECIPIENTS");

    await h.sql("UPDATE sender_accounts SET status = 'NeedsReconnect'");
    await contact("ann@x.test");
    const reconnect = await launch(await campaign());
    expect(reconnect.status).toBe(409);
    expect(reconnect.json.error.code).toBe("SENDER_RECONNECT");

    expect((await get(id)).status).toBe("Draft");
    expect(await statuses(id)).toEqual([]);
  });

  it.runIf(!EMAIL_FOOTER_ENABLED)("launches without a postal address while the footer that shows it is off", async () => {
    await contact("ann@x.test");
    await h.api("PATCH", "/api/tenant", { postalAddress: "" });
    const id = await campaign();
    const r = await launch(id);
    expect(r.status).toBe(200);
    expect(r.json.campaign.status).toBe("Sending");
  });

  it("is for Administrators and Campaign Managers, not Viewers", async () => {
    await contact("ann@x.test");
    const id = await campaign();
    const email = uniqueEmail("viewer");
    await h.sql("INSERT INTO users (id,tenant_id,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", `u-${email}`, h.tenantId, "V", email, email, "x", "viewer", "Active", 1, 1);
    expect((await launch(id, h.as(email))).status).toBe(403);
    expect((await h.anonymous.api("POST", `/api/campaigns/${id}/launch`)).status).toBe(401);
    expect((await get(id)).status).toBe("Draft");
  });
});

describe("the scheduled sender", () => {
  it("sends each recipient their own email: their name, their own unsubscribe link, the From name, and the campaign headers", async () => {
    await contact("ann@x.test", "Ann");
    await contact("bob@x.test", "Bob");
    const id = await campaign();
    await launch(id);
    const r = await tick();
    expect(r.json).toMatchObject({ campaigns: 1, accepted: 2, skipped: 0, failed: 0 });
    expect(sentTo()).toEqual(["ann@x.test", "bob@x.test"]);
    const [ann, bob] = google.mailbox;
    expect(header(ann!.raw, "Subject")).toBe("Hello Ann");
    expect(header(bob!.raw, "Subject")).toBe("Hello Bob");
    expect(header(ann!.raw, "From")).toBe(`"Marketing Admin" <${SENDER}>`);
    expect(parts(ann!.raw).html).toContain("<p>Hi Ann at your company</p>");
    if (EMAIL_FOOTER_ENABLED) expect(parts(ann!.raw).html).toContain("1 Road<br/>Cebu City"); // the postal address
    else for (const gone of ["<hr", "Unsubscribe</a>", "Cebu City"]) expect(parts(ann!.raw).html, gone).not.toContain(gone); // the footer is switched off
    // Like a one-to-one email, a campaign email carries no List-Unsubscribe headers (they send mail to Promotions).
    expect(header(ann!.raw, "List-Unsubscribe") !== undefined).toBe(LIST_UNSUBSCRIBE_HEADERS_ENABLED);
    expect(header(ann!.raw, "List-Unsubscribe-Post") !== undefined).toBe(LIST_UNSUBSCRIBE_HEADERS_ENABLED);
    // Each link is that recipient's own, and a live one (not a test link).
    expect(tokenOf(ann!.raw)).toMatchObject({ t: h.tenantId, e: "ann@x.test", c: id, k: "l" });
    expect(tokenOf(bob!.raw)).toMatchObject({ e: "bob@x.test", k: "l" });
    expect((await statuses(id)).map((s) => s.status)).toEqual(["Accepted", "Accepted"]);
  });

  it("completes the campaign when everyone has been sent to", async () => {
    await contact("ann@x.test");
    const id = await campaign();
    await launch(id);
    await tick();
    const done = await get(id);
    expect(done.status).toBe("Completed");
    expect(done.completedAt).toBeTruthy();
    expect(done.totals.Accepted).toBe(1);
    google.mailbox.length = 0;
    await tick(); // a finished campaign is never served again
    expect(google.mailbox).toHaveLength(0);
  });

  it("a live unsubscribe link works: it puts the address on the suppression list, so it is never emailed again", async () => {
    await contact("ann@x.test", "Ann");
    const id = await campaign();
    await launch(id);
    await tick();
    const token = /\/unsubscribe\/([^"]+)$/.exec(footerLink(google.mailbox[0]!.raw))![1]!; // the footer link's token is the one-click endpoint's too
    const r = await h.anonymous.api("POST", `/api/unsubscribe/${token}`, "List-Unsubscribe=One-Click", { "content-type": "application/x-www-form-urlencoded" });
    expect(r.json).toMatchObject({ unsubscribed: true, test: false });
    const [row] = await h.rows<{ n: number }>("SELECT count(*) AS n FROM suppressions WHERE normalized_email = 'ann@x.test'");
    expect(row!.n).toBe(1);
  });

  it("sends nothing outside the daily window, and keeps to the daily limit across days", async () => {
    for (const n of ["a", "b", "c", "d", "e"]) await contact(`${n}@x.test`, n.toUpperCase());
    const id = await campaign({ dailyLimit: 3 });
    await launch(id);
    expect((await tick(NINE_PM)).json.accepted).toBe(0); // 21:00 in Los Angeles
    expect(google.mailbox).toHaveLength(0);
    expect((await tick(LAST_MINUTE)).json.accepted).toBe(3);
    expect((await tick(LAST_MINUTE + 1000)).json.accepted).toBe(0); // today's limit is used up
    expect((await get(id)).totals).toMatchObject({ Accepted: 3, Pending: 2 });
    expect((await tick(LAST_MINUTE + DAY)).json.accepted).toBe(2); // the next day sends the rest
    expect((await get(id)).status).toBe("Completed");
    expect(sentTo()).toEqual(["a@x.test", "b@x.test", "c@x.test", "d@x.test", "e@x.test"]); // in the order of the list
  });

  it("starts immediately on the launch day whatever the time, then follows the daily window from the next day", async () => {
    for (const n of ["a", "b", "c", "d", "e"]) await contact(`${n}@x.test`, n.toUpperCase());
    const id = await campaign({ dailyLimit: 3 });
    await launch(id);
    // Pretend the launch happened at 21:00 in Los Angeles (outside the 09:00 to 17:00 window) on the pretend day.
    await h.sql("UPDATE campaigns SET launched_at = ? WHERE id = ?", NINE_PM - 1000, id);
    expect((await tick(NINE_PM)).json.accepted).toBe(1); // launch day: sends although outside the window
    expect((await tick(NINE_PM + DAY)).json.accepted).toBe(0); // next day, 21:00: the window applies again
    expect((await tick(LAST_MINUTE + DAY)).json.accepted).toBe(3); // next day, inside the window: a fresh daily allowance of 3
  });

  it("spreads the day's allowance over the window instead of sending it in one burst", async () => {
    for (let i = 0; i < 30; i++) await contact(`p${String(i).padStart(2, "0")}@x.test`);
    const id = await campaign({ dailyLimit: 30 });
    await launch(id);
    // Ten o'clock in the morning of a seven-hour window: 30 over 420 minutes is a trickle, not 30 at once.
    const r = await tick(TEN_AM);
    expect(r.json.accepted).toBe(1);
    expect((await get(id)).totals).toMatchObject({ Accepted: 1, Pending: 29 });
  });

  it("skips someone who unsubscribed after the launch, and says why", async () => {
    await contact("ann@x.test");
    await contact("bob@x.test");
    const id = await campaign();
    await launch(id);
    await h.sql("INSERT INTO suppressions (id,tenant_id,email,normalized_email,reason,created_at) VALUES (?,?,?,?,?,?)", "s1", h.tenantId, "bob@x.test", "bob@x.test", "Unsubscribed", 1);
    const r = await tick();
    expect(r.json).toMatchObject({ accepted: 1, skipped: 1 });
    expect(sentTo()).toEqual(["ann@x.test"]);
    expect(await statuses(id)).toEqual([{ email_snapshot: "ann@x.test", status: "Accepted", skip_reason: null }, { email_snapshot: "bob@x.test", status: "Skipped", skip_reason: "Suppressed" }]);
    expect((await get(id)).status).toBe("Completed");
  });

  it("sends each recipient exactly once even when two passes run at the same moment", async () => {
    for (let i = 0; i < 6; i++) await contact(`p${i}@x.test`);
    const id = await campaign();
    await launch(id);
    await Promise.all([tick(), tick(), tick()]);
    const to = sentTo();
    expect(new Set(to).size).toBe(to.length);
    expect(to.sort()).toEqual(["p0@x.test", "p1@x.test", "p2@x.test", "p3@x.test", "p4@x.test", "p5@x.test"]);
    expect((await get(id)).totals).toMatchObject({ Accepted: 6, Pending: 0, Queued: 0, Processing: 0 });
  });

  it("does not serve a paused or cancelled campaign, and resumes where it stopped", async () => {
    await contact("ann@x.test");
    await contact("bob@x.test");
    const id = await campaign();
    await launch(id);
    expect((await h.api("POST", `/api/campaigns/${id}/pause`)).status).toBe(200);
    expect((await tick()).json.campaigns).toBe(0);
    expect(google.mailbox).toHaveLength(0);
    expect((await h.api("POST", `/api/campaigns/${id}/resume`)).status).toBe(200);
    expect((await tick()).json.accepted).toBe(2);
    const other = await campaign();
    await launch(other); // nobody left to send to... but cancelled campaigns are never sent
    await h.api("POST", `/api/campaigns/${other}/cancel`);
    google.mailbox.length = 0;
    await tick();
    expect(google.mailbox).toHaveLength(0);
  });
});

describe("when sending goes wrong", () => {
  it("a rejected Gmail connection stops the campaign as Failed, loses nobody, and resume continues after reconnecting", async () => {
    await contact("ann@x.test");
    await contact("bob@x.test");
    const id = await campaign();
    await launch(id);
    google.sendFailure = { status: 401 };
    await tick();
    const stopped = await get(id);
    expect(stopped.status).toBe("Failed");
    expect(stopped.totals.Accepted).toBe(0);
    expect(stopped.totals.Failed).toBe(0); // nobody was written off for a connection problem
    expect((await h.api("GET", "/api/sender")).json.sender.status).toBe("NeedsReconnect");
    // Reconnect, then resume.
    google.sendFailure = null;
    await h.sql("UPDATE sender_accounts SET status = 'Connected'");
    expect((await h.api("POST", `/api/campaigns/${id}/resume`)).status).toBe(200);
    expect((await tick()).json.accepted).toBe(2);
    expect((await get(id)).status).toBe("Completed");
  });

  it("when Gmail is limiting sending, it backs off for a while and tries again later without failing anyone", async () => {
    await contact("ann@x.test");
    const id = await campaign();
    await launch(id);
    google.sendFailure = { status: 429 };
    await tick();
    const waiting = await get(id);
    expect(waiting).toMatchObject({ status: "Sending", totals: { Accepted: 0, Failed: 0 } });
    expect(new Date(waiting.nextRunAt).getTime()).toBe(LAST_MINUTE + 15 * 60_000); // not before fifteen minutes later
    google.sendFailure = null;
    expect((await tick(LAST_MINUTE + 60_000)).json.campaigns).toBe(0); // still backing off
    expect(google.mailbox).toHaveLength(0);
    expect((await tick(LAST_MINUTE + DAY)).json.accepted).toBe(1); // the next day it goes out
    expect((await get(id)).status).toBe("Completed");
  });

  it("a message Gmail refuses is Failed for that recipient only, the campaign completes with errors, and retry sends it again", async () => {
    await contact("ann@x.test");
    await contact("bob@x.test");
    const id = await campaign();
    await launch(id);
    google.sendFailure = { status: 400, body: { error: { message: "Invalid To header" } } };
    await tick();
    google.sendFailure = null;
    const done = await get(id);
    expect(done.status).toBe("CompletedWithErrors");
    expect(done.totals.Failed).toBe(2);
    const retry = await h.api("POST", `/api/campaigns/${id}/retry-failed`);
    expect(retry.status).toBe(200);
    expect(retry.json).toMatchObject({ status: "Sending", totals: { Pending: 2, Failed: 0 } });
    await tick();
    expect((await get(id))).toMatchObject({ status: "Completed", totals: { Accepted: 2 } });
    expect((await h.api("POST", `/api/campaigns/${id}/retry-failed`)).status).toBe(409); // nothing left to retry
  });

  it("a recipient whose address cannot be used is Skipped, and the rest are still sent", async () => {
    await contact("ann@x.test");
    await contact("bob@x.test");
    const id = await campaign();
    await launch(id);
    await h.sql("UPDATE campaign_recipients SET email_snapshot = 'bad address' WHERE campaign_id = ? AND sequence = 1", id);
    const r = await tick();
    expect(r.json).toMatchObject({ accepted: 1, skipped: 1 });
    expect((await statuses(id))[0]).toMatchObject({ email_snapshot: "bad address", status: "Skipped", skip_reason: "InvalidEmail" });
    expect(sentTo()).toEqual(["bob@x.test"]);
    expect((await get(id)).status).toBe("Completed");
  });

  it("returns a send that died half way to the pool once its lease runs out, and sends it", async () => {
    await contact("ann@x.test");
    const id = await campaign();
    await launch(id);
    await h.sql("UPDATE campaign_recipients SET status = 'Processing', lease_expires_at = ?, attempt_count = 1 WHERE campaign_id = ?", LAST_MINUTE - 1000, id);
    expect((await tick()).json.accepted).toBe(1);
    expect((await get(id)).status).toBe("Completed");
  });
});

describe("the address the unsubscribe links point at", () => {
  const PUBLIC = "https://sabertoothsoftwarelabs.net";
  const as = (extra: Record<string, string>) => h.withEnv({ ...extra, DEV_ACTOR_EMAIL: h.adminEmail });

  it("a campaign's test email uses UNSUBSCRIBE_BASE_URL for the header and the same address for the one-click POST", async () => {
    await contact("ann@x.test");
    const id = await campaign();
    expect((await h.api("POST", "/api/test-recipients", { email: "qa@x.test" })).status).toBeLessThan(300);
    const r = await as({ UNSUBSCRIBE_BASE_URL: PUBLIC }).api("POST", `/api/campaigns/${id}/test-send`, { to: ["qa@x.test"] });
    expect(r.status).toBe(200);
    expect(footerLink(google.mailbox[0]!.raw)).toMatch(/^https:\/\/sabertoothsoftwarelabs\.net\/unsubscribe\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(header(google.mailbox[0]!.raw, "List-Unsubscribe") !== undefined).toBe(LIST_UNSUBSCRIBE_HEADERS_ENABLED);
    await h.api("DELETE", "/api/test-recipients/" + (await h.api("GET", "/api/test-recipients")).json.items[0].id);
  });

  it("real sends use it too, with each recipient's own token", async () => {
    await contact("ann@x.test");
    await contact("bob@x.test");
    const id = await campaign();
    await launch(id);
    const r = await as({ UNSUBSCRIBE_BASE_URL: PUBLIC }).api("POST", "/api/campaigns/run-tick", { now: LAST_MINUTE });
    expect(r.json.accepted).toBe(2);
    for (const m of google.mailbox) expect(footerLink(m.raw)).toContain(`${PUBLIC}/unsubscribe/`);
    expect(new Set(google.mailbox.map((m) => footerLink(m.raw))).size).toBe(2);
  });

  it("falls back to the app's own address when the setting is missing or not a good address", async () => {
    await contact("ann@x.test");
    const id = await campaign();
    await launch(id);
    await as({ UNSUBSCRIBE_BASE_URL: "http://sabertoothsoftwarelabs.net" }).api("POST", "/api/campaigns/run-tick", { now: LAST_MINUTE }); // http, not localhost: ignored
    expect(footerLink(google.mailbox[0]!.raw)).toContain("http://localhost:5173/unsubscribe/");
  });
});

describe("running a pass by hand (local development only)", () => {
  it("is refused anywhere but a local environment, and for anyone but an Administrator", async () => {
    await contact("ann@x.test");
    const id = await campaign();
    await launch(id);
    expect((await h.withEnv({ ENVIRONMENT: "production", DEV_ACTOR_EMAIL: h.adminEmail }).api("POST", "/api/campaigns/run-tick")).status).toBeGreaterThanOrEqual(403);
    expect((await h.anonymous.api("POST", "/api/campaigns/run-tick")).status).toBe(401);
    expect(google.mailbox).toHaveLength(0);
  });

  it("rejects a body it does not understand", async () => {
    expect((await h.api("POST", "/api/campaigns/run-tick", { now: "yesterday" })).status).toBe(400);
    expect((await h.api("POST", "/api/campaigns/run-tick", { later: 1 })).status).toBe(400);
  });
});
