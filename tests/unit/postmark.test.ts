import { describe, expect, it } from "vitest";
import { EmailSendError } from "../../src/server/services/email-provider";
import { PostmarkProvider, postmarkConfig, postmarkPayload, type PostmarkConfig } from "../../src/server/services/providers/postmark";

const TOKEN = "secret-server-token-123";
const CFG: PostmarkConfig = { token: TOKEN, from: "discovery@acme.test", fromName: "Marketing Admin", messageStream: "outbound" };
const MSG = { fromName: "Marketing Admin", to: "jane@client.test", subject: "Quick question", text: "Hi Jane", html: '<div dir="ltr">Hi Jane</div>' };

/** A fake Postmark that records what it was sent and answers as told. */
function fake(reply: { status?: number; body?: unknown } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const doFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply.body ?? { ErrorCode: 0, Message: "OK", MessageID: "m1" }), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, doFetch };
}

describe("postmarkConfig", () => {
  it("needs both a token and a From address, trims them, and defaults the stream to outbound", () => {
    expect(postmarkConfig({})).toBeNull();
    expect(postmarkConfig({ POSTMARK_SERVER_TOKEN: "t" })).toBeNull();
    expect(postmarkConfig({ POSTMARK_FROM: "a@b.test" })).toBeNull();
    expect(postmarkConfig({ POSTMARK_SERVER_TOKEN: " t ", POSTMARK_FROM: " a@b.test " })).toEqual({ token: "t", from: "a@b.test", fromName: "", messageStream: "outbound" });
    expect(postmarkConfig({ POSTMARK_SERVER_TOKEN: "t", POSTMARK_FROM: "a@b.test", POSTMARK_FROM_NAME: "Acme", POSTMARK_MESSAGE_STREAM: "broadcast" })).toMatchObject({ fromName: "Acme", messageStream: "broadcast" });
  });
});

describe("postmarkPayload", () => {
  it("is the message as Postmark takes it, with no tracking and no extra headers for a personal email", () => {
    expect(postmarkPayload(CFG, MSG)).toEqual({
      From: "Marketing Admin <discovery@acme.test>", To: "jane@client.test", Subject: "Quick question", TextBody: "Hi Jane", HtmlBody: '<div dir="ltr">Hi Jane</div>',
      MessageStream: "outbound", TrackOpens: false, TrackLinks: "None",
    });
  });

  it("adds ReplyTo only when given, and no HtmlBody for a text-only message", () => {
    const p = postmarkPayload(CFG, { fromName: "", to: "a@b.test", subject: "S", text: "T", replyTo: "boss@acme.test" });
    expect(p).toMatchObject({ From: "discovery@acme.test", ReplyTo: "boss@acme.test" });
    expect("HtmlBody" in p).toBe(false);
    expect("ReplyTo" in postmarkPayload(CFG, MSG)).toBe(false);
  });

  it("carries the unsubscribe headers for campaign mail, and the one-click marker only when asked", () => {
    const p = postmarkPayload(CFG, { ...MSG, listUnsubscribe: { url: "https://x.test/u", oneClick: true } });
    expect(p.Headers).toEqual([{ Name: "List-Unsubscribe", Value: "<https://x.test/u>" }, { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" }]);
    expect(postmarkPayload(CFG, { ...MSG, listUnsubscribe: { url: "https://x.test/u", oneClick: false } }).Headers).toEqual([{ Name: "List-Unsubscribe", Value: "<https://x.test/u>" }]);
  });

  it("strips quotes, angle brackets and line breaks from the sender name, so it cannot add an address", () => {
    expect(postmarkPayload(CFG, { ...MSG, fromName: 'Evil" <x@y.test>\r\nBcc: z@y.test' }).From).toBe("Evil x@y.test Bcc: z@y.test <discovery@acme.test>");
  });
});

describe("PostmarkProvider", () => {
  it("is not usable without configuration, and says so", async () => {
    await expect(new PostmarkProvider(null).open()).rejects.toMatchObject({ status: 503, code: "POSTMARK_NOT_CONFIGURED" });
  });

  it("posts the payload to Postmark's email endpoint with the token in the header only", async () => {
    const f = fake();
    const channel = await new PostmarkProvider(CFG, f.doFetch).open();
    expect(channel.fromName).toBe("Marketing Admin");
    await channel.send(MSG);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe("https://api.postmarkapp.com/email");
    const init = f.calls[0]!.init;
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "x-postmark-server-token": TOKEN, "content-type": "application/json", accept: "application/json" });
    expect(init.body as string).not.toContain(TOKEN);
    expect(JSON.parse(init.body as string)).toEqual(postmarkPayload(CFG, MSG));
  });

  it("shows what would be sent without sending, and without the token", async () => {
    const f = fake();
    const channel = await new PostmarkProvider(CFG, f.doFetch).open();
    const seen = channel.inspect(MSG);
    expect(f.calls).toHaveLength(0);
    expect(seen.headers.map((h) => h.name)).toEqual(["From", "To", "Subject"]);
    expect(seen.parts.map((p) => p.contentType)).toEqual(["text/plain", "text/html"]);
    expect(JSON.stringify(seen)).not.toContain(TOKEN);
  });

  const failure = async (reply: { status?: number; body?: unknown }) => {
    const channel = await new PostmarkProvider(CFG, fake(reply).doFetch).open();
    return channel.send(MSG).then(() => null, (e: unknown) => e as EmailSendError);
  };

  it.each([
    [401, { ErrorCode: 10, Message: "Bad or missing API token" }, "auth"],
    [429, { ErrorCode: 100, Message: "slow down" }, "rate_limit"],
    [422, { ErrorCode: 400, Message: "Sender signature not found" }, "permanent"],
    [422, { ErrorCode: 406, Message: "Inactive recipient" }, "permanent"],
    [422, { ErrorCode: 300, Message: "Invalid email request" }, "permanent"],
    [500, { ErrorCode: 0, Message: "oops" }, "transient"],
  ])("maps HTTP %i %j to %s", async (status, body, kind) => {
    const e = await failure({ status, body });
    expect(e).toBeInstanceOf(EmailSendError);
    expect(e!.kind).toBe(kind);
    expect(JSON.stringify([e!.message, e!.userMessage])).not.toContain(TOKEN);
  });

  it("explains the errors a person can act on, in plain words", async () => {
    expect((await failure({ status: 422, body: { ErrorCode: 400, Message: "x" } }))!.userMessage).toMatch(/does not recognise the From address/);
    expect((await failure({ status: 422, body: { ErrorCode: 406, Message: "x" } }))!.userMessage).toMatch(/bounced or was reported as spam/);
    expect((await failure({ status: 401, body: { ErrorCode: 10, Message: "x" } }))!.userMessage).toMatch(/API token/);
    expect((await failure({ status: 422, body: { ErrorCode: 412, Message: "Account pending approval" } }))!.userMessage).toBe("Postmark rejected the email: Account pending approval");
  });

  it("treats an unreachable Postmark, or a non-JSON answer, as a temporary failure or by its status", async () => {
    const down = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    const channel = await new PostmarkProvider(CFG, down).open();
    expect(await channel.send(MSG).then(() => null, (e: unknown) => (e as EmailSendError).kind)).toBe("transient");
    const html = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    expect(await (await new PostmarkProvider(CFG, html).open()).send(MSG).then(() => null, (e: unknown) => (e as EmailSendError).kind)).toBe("transient");
  });
});
