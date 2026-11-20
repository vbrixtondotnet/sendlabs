import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LIST_UNSUBSCRIBE_HEADERS_ENABLED } from "../../src/shared/merge";
import { startHarness, type Caller, type Harness } from "./harness";

const TOKEN = "integration-test-token";
let h: Harness;
let postmark: { calls: { url: string; init: RequestInit; json: any }[]; reply: { status: number; body: unknown } };

/** A fake Postmark: records each request and answers with `postmark.reply`. */
const fakeFetch = (async (url: string, init: RequestInit) => {
  postmark.calls.push({ url, init, json: JSON.parse(init.body as string) });
  return new Response(JSON.stringify(postmark.reply.body), { status: postmark.reply.status, headers: { "content-type": "application/json" } });
}) as unknown as typeof fetch;
const OK = { status: 200, body: { ErrorCode: 0, Message: "OK", MessageID: "m1" } };

beforeAll(async () => {
  h = await startHarness({ fetch: fakeFetch });
  expect((await h.api("PATCH", "/api/me", { firstName: "Rico", lastName: "Prinsipe" })).status).toBe(200);
});
afterAll(async () => { await h.dispose(); });
beforeEach(async () => {
  postmark = { calls: [], reply: OK };
  await h.sql("DELETE FROM personal_emails");
  await h.sql("DELETE FROM suppressions");
});

const env = { EMAIL_PROVIDER: "postmark", POSTMARK_SERVER_TOKEN: TOKEN, POSTMARK_FROM: "discovery@acme.test", POSTMARK_FROM_NAME: "Marketing Admin" } as const;
const viaPostmark = (extra: Record<string, string> = {}): Caller => h.withEnv({ ...env, ...extra, DEV_ACTOR_EMAIL: h.adminEmail });
const MESSAGE = { to: "jane@client.test", subject: "Quick question", body: "Hi Jane,\n\nDid you get my note?\n\nThanks,\nRico" };

describe("one-to-one email through Postmark", () => {
  it("is reported as sent through Postmark, and needs no Gmail account", async () => {
    await h.api("DELETE", "/api/sender"); // no Gmail account is connected in this suite
    const r = await viaPostmark().api("GET", "/api/personal-emails");
    expect(r.json).toMatchObject({ provider: "postmark", items: [], sentToday: 0 });
  });

  it("sends the message to Postmark's email endpoint with the token in the header, and records it", async () => {
    const r = await viaPostmark().api("POST", "/api/personal-emails", MESSAGE);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ to: "jane@client.test", subject: "Quick question", body: MESSAGE.body, sentBy: h.adminEmail });
    expect(postmark.calls).toHaveLength(1);
    const call = postmark.calls[0]!;
    expect(call.url).toBe("https://api.postmarkapp.com/email");
    expect(call.init.headers).toMatchObject({ "x-postmark-server-token": TOKEN });
    expect(call.json).toEqual({
      From: "Marketing Admin <discovery@acme.test>", To: "jane@client.test", Subject: "Quick question", TextBody: MESSAGE.body,
      HtmlBody: '<div dir="ltr">Hi Jane,<div><br></div><div>Did you get my note?</div><div><br></div><div>Thanks,</div><div>Rico</div></div>',
      MessageStream: "outbound", TrackOpens: false, TrackLinks: "None",
    });
    expect("Headers" in call.json).toBe(false); // no List-Unsubscribe or other extras on a personal email
    const list = await viaPostmark().api("GET", "/api/personal-emails");
    expect(list.json).toMatchObject({ sentToday: 1, provider: "postmark" });
    expect(list.json.items[0].subject).toBe("Quick question");
  });

  it("adds ReplyTo only when one is given", async () => {
    await viaPostmark().api("POST", "/api/personal-emails", { ...MESSAGE, replyTo: "boss@acme.test" });
    expect(postmark.calls[0]!.json.ReplyTo).toBe("boss@acme.test");
  });

  it("uses the sending user's name when no From name is configured", async () => {
    await viaPostmark({ POSTMARK_FROM_NAME: "" }).api("POST", "/api/personal-emails", MESSAGE);
    expect(postmark.calls[0]!.json.From).toBe("Rico Prinsipe <discovery@acme.test>");
  });

  it("still refuses a suppressed address and enforces the daily limit, whatever the provider", async () => {
    await h.sql("INSERT INTO suppressions (id,tenant_id,email,normalized_email,reason,created_at) VALUES (?,?,?,?,?,?)", "s1", h.tenantId, "jane@client.test", "jane@client.test", "Unsubscribed", 1);
    const r = await viaPostmark().api("POST", "/api/personal-emails", MESSAGE);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("RECIPIENT_SUPPRESSED");
    expect(postmark.calls).toHaveLength(0);
  });

  it("says so when Postmark is not configured, and records nothing", async () => {
    const r = await h.withEnv({ EMAIL_PROVIDER: "postmark", POSTMARK_SERVER_TOKEN: "", POSTMARK_FROM: "", DEV_ACTOR_EMAIL: h.adminEmail }).api("POST", "/api/personal-emails", MESSAGE);
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("POSTMARK_NOT_CONFIGURED");
    expect(postmark.calls).toHaveLength(0);
    expect((await viaPostmark().api("GET", "/api/personal-emails")).json.items).toEqual([]);
  });

  it.each([
    [{ status: 422, body: { ErrorCode: 400, Message: "Sender signature not found" } }, 422, /does not recognise the From address/],
    [{ status: 422, body: { ErrorCode: 406, Message: "Inactive" } }, 422, /bounced or was reported as spam/],
    [{ status: 422, body: { ErrorCode: 412, Message: "Account pending approval" } }, 422, /Postmark rejected the email: Account pending approval/],
    [{ status: 401, body: { ErrorCode: 10, Message: "Bad token" } }, 409, /API token/],
    [{ status: 429, body: { ErrorCode: 100, Message: "slow" } }, 429, /limiting sending/],
  ])("explains a Postmark failure (%j) and records nothing", async (reply, status, message) => {
    postmark.reply = reply;
    const r = await viaPostmark().api("POST", "/api/personal-emails", MESSAGE);
    expect(r.status).toBe(status);
    expect(r.json.error.message).toMatch(message);
    expect((await viaPostmark().api("GET", "/api/personal-emails")).json.items).toEqual([]);
  });

  it("answers a Postmark outage with a generic failure that reveals nothing", async () => {
    postmark.reply = { status: 500, body: { ErrorCode: 0, Message: "secret backend detail" } };
    const r = await viaPostmark().api("POST", "/api/personal-emails", MESSAGE);
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.json)).not.toContain("secret backend detail");
    expect(JSON.stringify(r.json)).not.toContain(TOKEN);
  });

  it("never returns the token, in a success or a failure", async () => {
    const ok = await viaPostmark().api("POST", "/api/personal-emails", MESSAGE);
    postmark.reply = { status: 401, body: { ErrorCode: 10, Message: "Bad token" } };
    const bad = await viaPostmark().api("POST", "/api/personal-emails", MESSAGE);
    const list = await viaPostmark().api("GET", "/api/personal-emails");
    for (const r of [ok, bad, list]) expect(JSON.stringify(r.json)).not.toContain(TOKEN);
  });

  it("is the same provider as a campaign's test send: EMAIL_PROVIDER switches both, and neither touches Gmail", async () => {
    const admin = viaPostmark();
    expect((await admin.api("POST", "/api/test-recipients", { email: "qa@acme.test" })).status).toBeLessThan(300);
    const campaign = await admin.api("POST", "/api/campaigns", { name: "Outreach", subject: "Hello", htmlBody: '<p>Hi <a href="{{unsubscribeUrl}}">Unsubscribe</a></p>' });
    expect(campaign.status).toBe(201);
    const test = await admin.api("POST", `/api/campaigns/${campaign.json.id}/test-send`, { to: ["qa@acme.test"] });
    expect(test.status).toBe(200);
    expect(postmark.calls).toHaveLength(1);
    // A campaign test email is campaign mail, so it carries the unsubscribe headers and footer that a one-to-one email does not.
    expect(postmark.calls[0]!.json.Headers?.map((x: { Name: string }) => x.Name)).toEqual(LIST_UNSUBSCRIBE_HEADERS_ENABLED ? ["List-Unsubscribe", "List-Unsubscribe-Post"] : undefined);
    expect(postmark.calls[0]!.json.To).toBe("qa@acme.test");
    expect(postmark.calls[0]!.json.From).toBe("Marketing Admin <discovery@acme.test>");
    expect((await admin.api("POST", "/api/personal-emails", MESSAGE)).status).toBe(201);
    expect(postmark.calls).toHaveLength(2);
    expect("Headers" in postmark.calls[1]!.json).toBe(false);
    expect(postmark.calls[1]!.json.From).toBe(postmark.calls[0]!.json.From); // one sender identity for both
    // Without the setting both are back on Gmail: the one-to-one page then says so.
    const off = h.withEnv({ EMAIL_PROVIDER: "", POSTMARK_SERVER_TOKEN: TOKEN, POSTMARK_FROM: "discovery@acme.test", DEV_ACTOR_EMAIL: h.adminEmail });
    expect((await off.api("GET", "/api/personal-emails")).json.provider).toBe("gmail");
  });
});
