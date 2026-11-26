import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApplicationConfirmation } from "../../src/server/services/application-confirmation";
import { GoogleOAuth } from "../../src/server/services/google-oauth";
import { CloudflareEmailMailer, DEFAULT_FROM, systemMailConfig } from "../../src/server/services/system-mail";
import { resetApplicationEmailLimits } from "../../src/server/services/job-application-email";
import { FakeGoogle } from "./fake-google";
import { startHarness, type Harness } from "./harness";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const TOKEN = "cf-secret-token-xyz";
const ENV = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_EMAIL_API_TOKEN: TOKEN, SYSTEM_EMAIL_FROM: "jobs@sendrix.app", SYSTEM_EMAIL_FROM_NAME: "Sendrix" };

describe("the system mailer's settings", () => {
  it("needs a real account id and a token, and defaults the sender to jobs@sendrix.app", () => {
    expect(systemMailConfig({})).toBeNull();
    expect(systemMailConfig({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT })).toBeNull();
    expect(systemMailConfig({ CLOUDFLARE_EMAIL_API_TOKEN: TOKEN })).toBeNull();
    expect(systemMailConfig({ CLOUDFLARE_ACCOUNT_ID: "../../evil", CLOUDFLARE_EMAIL_API_TOKEN: TOKEN })).toBeNull(); // it goes into a URL
    expect(systemMailConfig({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_EMAIL_API_TOKEN: TOKEN })).toEqual({ accountId: ACCOUNT, token: TOKEN, from: DEFAULT_FROM, fromName: "Sendrix" });
    expect(DEFAULT_FROM).toBe("jobs@sendrix.app");
    expect(systemMailConfig({ ...ENV, SYSTEM_EMAIL_FROM: "not an address" })).toBeNull();
  });
});

describe("the Cloudflare mailer", () => {
  const mail = { to: "me@example.test", subject: "S", text: "T", html: "<p>T</p>" };
  const cfg = systemMailConfig(ENV)!;
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

  it("POSTs to the account's email/sending/send endpoint with the token, as jobs@sendrix.app", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify({ success: true, errors: [], result: { delivered: ["me@example.test"], permanent_bounces: [], queued: [] } })); }) as unknown as typeof fetch;
    await new CloudflareEmailMailer(cfg, f).send(mail);
    expect(seen[0]!.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/email/sending/send`);
    expect(seen[0]!.init.method).toBe("POST");
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ to: "me@example.test", from: { address: "jobs@sendrix.app", name: "Sendrix" }, subject: "S", text: "T", html: "<p>T</p>" });
  });

  it("maps Cloudflare's failures onto send-failure kinds, and never puts the token in a message", async () => {
    const cases: [number, unknown, string][] = [
      [401, { success: false, errors: [{ code: 10101 }] }, "auth"],
      [403, { success: false, errors: [{ code: 10102 }] }, "auth"],
      [403, { success: false, errors: [{ code: 10208 }] }, "permanent"],
      [429, { success: false, errors: [{ code: 10004 }] }, "rate_limit"],
      [500, { success: false, errors: [{ code: 10002 }] }, "transient"],
      [400, { success: false, errors: [{ code: 10001 }] }, "permanent"],
    ];
    for (const [status, body, kind] of cases) {
      const e = await new CloudflareEmailMailer(cfg, reply(status, body)).send(mail).catch((x) => x as Error);
      expect(e, `${status}`).toMatchObject({ name: "EmailSendError", kind });
      expect(`${(e as Error).message} ${(e as { userMessage?: string }).userMessage}`).not.toContain(TOKEN);
    }
    const down = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    expect(await new CloudflareEmailMailer(cfg, down).send(mail).catch((x) => x)).toMatchObject({ kind: "transient" });
    const bounced = reply(200, { success: true, result: { delivered: [], permanent_bounces: ["me@example.test"] } });
    expect(await new CloudflareEmailMailer(cfg, bounced).send(mail).catch((x) => x)).toMatchObject({ kind: "permanent" });
  });
});

describe("the confirmation email", () => {
  const base = { to: "me@example.test", jobTitle: "Senior .NET Developer", companyName: "Acme Corp", sentTo: "hiring@acme.test", sentAt: new Date(Date.UTC(2026, 10, 26, 9, 30)), attachmentNames: ["resume.pdf", "cover.docx"], appUrl: "https://sendrix.app/" };

  it("says what was sent, to whom, when and which files, and nothing of the message", () => {
    const m = buildApplicationConfirmation({ ...base });
    expect(m.to).toBe("me@example.test");
    expect(m.subject).toBe("Your application to Acme Corp was sent");
    expect(m.text).toContain("Your application for Senior .NET Developer at Acme Corp was sent.");
    expect(m.text).toContain("Sent to: hiring@acme.test");
    expect(m.text).toContain("Sent on: Thu, 26 Nov 2026 09:30:00 GMT");
    expect(m.text).toContain("Attachments: resume.pdf, cover.docx");
    expect(m.text).toContain("Open Sendrix: https://sendrix.app");
    expect(m.text).toContain("Please do not reply");
    expect(m.html).toContain("<strong>Senior .NET Developer at Acme Corp</strong>");
  });

  it("copes with an unknown job and no files, and escapes everything a person supplied", () => {
    const bare = buildApplicationConfirmation({ ...base, jobTitle: undefined, companyName: undefined, attachmentNames: [], appUrl: "" });
    expect(bare.subject).toBe("Your application was sent");
    expect(bare.text).toContain("Your application for a job was sent.");
    expect(bare.text).not.toContain("Attachments");
    expect(bare.text).not.toContain("Open Sendrix");
    const evil = buildApplicationConfirmation({ ...base, jobTitle: '<img src=x onerror="alert(1)">\r\nBcc: x@evil.test', companyName: "A & B <b>", attachmentNames: ['"><script>.pdf'] });
    expect(evil.html).not.toContain("<img");
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).toContain("A &amp; B &lt;b&gt;");
    expect(evil.subject).not.toMatch(/[\r\n]/);
    expect(evil.text.split("\n").some((l) => l.startsWith("Bcc:"))).toBe(false);
  });
});

describe("after an application is sent (POST /api/jobs/apply-email)", () => {
  const google = new FakeGoogle();
  let h: Harness;
  let cloudflare: { calls: { url: string; body: any; auth: string }[]; respond: () => Response };
  const GOOD: Record<string, string> = { to: "hiring@acme.test", subject: "Application for Senior .NET Developer", body: "Hello, I would like to apply.", jobTitle: "Senior .NET Developer", companyName: "Acme Corp" };

  const form = (fields: Record<string, string> = GOOD, files: File[] = []) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    for (const file of files) f.append("attachments", file, file.name);
    return f;
  };
  const withMail = () => h.withEnv({ DEV_ACTOR_EMAIL: "jobseeker@sendrix.app", ...ENV });
  const apply = (who = withMail(), fields = GOOD, files: File[] = []) => who.postForm("/api/jobs/apply-email", form(fields, files));
  /** The confirmation is sent after the answer, so wait for it. */
  const settle = () => new Promise((r) => setTimeout(r, 30));

  beforeAll(async () => {
    const stub = (async (url: string, init: RequestInit) => {
      cloudflare.calls.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).authorization ?? "" });
      return cloudflare.respond();
    }) as unknown as typeof fetch;
    h = await startHarness({ google: new GoogleOAuth(google.fetch), fetch: stub });
    const start = await h.jobSeeker.api("POST", "/api/sender/gmail/connect");
    expect((await h.jobSeeker.text(google.consent(start.json.url, { email: "sales@sabertooth.test" }))).status).toBe(302);
  });
  afterAll(async () => { await h.dispose(); });
  beforeEach(() => {
    cloudflare = { calls: [], respond: () => new Response(JSON.stringify({ success: true, errors: [], result: { delivered: ["x"], permanent_bounces: [], queued: [] } })) };
    google.sendFailure = null;
    google.mailbox.length = 0;
    resetApplicationEmailLimits();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("emails the account's own address once, from jobs@sendrix.app, with the job and the file names", async () => {
    const r = await apply(withMail(), GOOD, [new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, ...new Array(50).fill(0x41)])], "resume.pdf", { type: "application/pdf" })]);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ sent: true, attachments: 1 });
    await settle();
    expect(cloudflare.calls).toHaveLength(1);
    const c = cloudflare.calls[0]!;
    expect(c.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/email/sending/send`);
    expect(c.auth).toBe(`Bearer ${TOKEN}`);
    expect(c.body.to).toBe("jobseeker@sendrix.app"); // the account's address, not the employer's
    expect(c.body.from).toEqual({ address: "jobs@sendrix.app", name: "Sendrix" });
    expect(c.body.subject).toBe("Your application to Acme Corp was sent");
    expect(c.body.text).toContain("Senior .NET Developer at Acme Corp");
    expect(c.body.text).toContain("Sent to: hiring@acme.test");
    expect(c.body.text).toContain("Attachments: resume.pdf");
    expect(c.body.text).not.toContain("I would like to apply"); // not the message itself
    expect(google.mailbox).toHaveLength(1); // the application itself still went out through their Gmail
  });

  it("sends nothing when the application fails", async () => {
    google.sendFailure = { status: 500 } as never;
    const r = await apply();
    expect(r.status).toBeGreaterThanOrEqual(400);
    await settle();
    expect(cloudflare.calls).toHaveLength(0);
  });

  it("does not change the application's answer when Cloudflare fails, and logs no token or address", async () => {
    cloudflare.respond = () => new Response(JSON.stringify({ success: false, errors: [{ code: 10002 }] }), { status: 500 });
    const r = await apply();
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ sent: true, attachments: 0 });
    await settle();
    expect(cloudflare.calls).toHaveLength(1);
    const logged = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().map(String).join("\n");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("jobseeker@sendrix.app");
    expect(logged).not.toContain("hiring@acme.test");
    expect(logged).toContain("confirmation_email_failed");
  });

  it("sends nothing, and does not fail, when system email is not set up", async () => {
    const r = await apply(h.withEnv({ DEV_ACTOR_EMAIL: "jobseeker@sendrix.app" }));
    expect(r.status).toBe(200);
    await settle();
    expect(cloudflare.calls).toHaveLength(0);
  });

  it("still refuses unknown form fields, and works without the job fields", async () => {
    expect((await apply(withMail(), { ...GOOD, cc: "x@y.test" })).status).toBe(400);
    const r = await apply(withMail(), { to: "hiring@acme.test", subject: "Application", body: "Hello, I would like to apply." });
    expect(r.status).toBe(200);
    await settle();
    expect(cloudflare.calls.at(-1)!.body.subject).toBe("Your application was sent");
  });
});
