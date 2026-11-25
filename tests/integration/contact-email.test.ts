import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTACT_LOOKUP_COST } from "../../src/shared/credits";
import { pickBest, type HunterEmail } from "../../src/server/services/hunter";
import { startHarness, type Harness } from "./harness";

const KEY = "hunter-secret-key-xyz";

const hunterEmail = (over: Record<string, unknown> = {}) => ({ value: "x@acme.test", type: "personal", confidence: 90, first_name: "", last_name: "", position: "", department: "", ...over });

/** A stand-in for Hunter: records every request address and answers with `emails` (or an error status). */
function hunterWorld(emails: unknown[] = [], status = 200) {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (!url.startsWith("https://api.hunter.io/")) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(status === 200 ? { data: { domain: "acme.test", emails } } : { errors: [{ details: "x" }] }), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe("choosing the address", () => {
  const e = (email: string, over: Partial<HunterEmail> = {}): HunterEmail => ({ email, name: "", position: "", department: "", type: "generic", confidence: 80, ...over });

  it("prefers HR, then management, then careers@/jobs@, then info@, and ignores low confidence", () => {
    expect(pickBest([e("info@a.test"), e("jobs@a.test"), e("ceo@a.test", { department: "executive", type: "personal" }), e("pat@a.test", { department: "hr", type: "personal", position: "Talent Lead" })])?.email).toBe("pat@a.test");
    expect(pickBest([e("info@a.test"), e("jobs@a.test"), e("ceo@a.test", { department: "executive" })])?.email).toBe("ceo@a.test");
    expect(pickBest([e("info@a.test"), e("careers@a.test")])?.email).toBe("careers@a.test");
    expect(pickBest([e("info@a.test", { confidence: 99 }), e("hr@a.test", { confidence: 49 })])?.email).toBe("info@a.test"); // 49 is below the line
    expect(pickBest([e("a@a.test", { confidence: 10 })])).toBeNull();
    expect(pickBest([])).toBeNull();
  });
});

describe("Get Email Address: POST /api/jobs/contact-email", () => {
  let h: Harness;
  // The app uses one fetch for its whole life; each test points it at the stand-in for Hunter it wants.
  let hunterFetch: typeof fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
  beforeAll(async () => { h = await startHarness({ fetch: ((i: never, init?: never) => hunterFetch(i, init)) as typeof fetch }); });
  afterAll(async () => { await h.dispose(); });

  const credits = async (email = "jobseeker@sendrix.app") => (await h.rows<{ credits: number }>("SELECT credits FROM users WHERE normalized_email = ?", email))[0]!.credits;
  const ledger = (email = "jobseeker@sendrix.app") =>
    h.rows<{ delta: number; reason: string; note: string }>("SELECT t.delta, t.reason, t.note FROM credit_transactions t JOIN users u ON u.id = t.user_id WHERE u.normalized_email = ? AND t.reason = 'job_contact_lookup'", email);
  const as = (hw: ReturnType<typeof hunterWorld> | null, key: string | null = KEY, actor = "jobseeker@sendrix.app") => {
    if (hw) hunterFetch = hw.fetchFn;
    return h.withEnv({ DEV_ACTOR_EMAIL: actor, ...(key ? { HUNTER_API_KEY: key } : {}) });
  };

  it("asks Hunter for the company by name, fills in the best address and takes 10 credits, once", async () => {
    const before = await credits();
    const hw = hunterWorld([hunterEmail({ value: "info@acme.test", type: "generic" }), hunterEmail({ value: "pat@acme.test", department: "hr", position: "Talent Lead", first_name: "Pat", last_name: "Recruiter", confidence: 93 })]);
    const r = await as(hw).api("POST", "/api/jobs/contact-email", { companyName: "Acme Corp" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ email: "pat@acme.test", name: "Pat Recruiter", position: "Talent Lead", confidence: 93, charged: true, credits: before - CONTACT_LOOKUP_COST });
    expect(await credits()).toBe(before - CONTACT_LOOKUP_COST);
    expect(await ledger()).toEqual([{ delta: -CONTACT_LOOKUP_COST, reason: "job_contact_lookup", note: "acme corp" }]);
    expect(hw.calls).toHaveLength(1);
    expect(hw.calls[0]).toContain("company=Acme%20Corp");
    expect(r.headers.get("cache-control")).toBe("no-store");

    // The same account asking again is neither charged nor sent to Hunter again.
    const again = await as(hunterWorld()).api("POST", "/api/jobs/contact-email", { companyName: "  ACME   corp " });
    expect(again.json).toMatchObject({ email: "pat@acme.test", charged: false, credits: before - CONTACT_LOOKUP_COST });
    expect(await credits()).toBe(before - CONTACT_LOOKUP_COST);
  });

  it("uses the cache for another account (no Hunter call) but still charges it", async () => {
    await h.addAccount("Other Seeker", "other.seeker@example.test", "JobSeeker");
    const hw = hunterWorld();
    const r = await as(hw, KEY, "other.seeker@example.test").api("POST", "/api/jobs/contact-email", { companyName: "Acme Corp" });
    expect(r.json).toMatchObject({ email: "pat@acme.test", charged: true });
    expect(hw.calls).toHaveLength(0);
    expect(await credits("other.seeker@example.test")).toBe(100 - CONTACT_LOOKUP_COST);
  });

  it("finds nothing: 404, nothing charged, and the miss is remembered for a day", async () => {
    const before = await credits();
    const hw = hunterWorld([]);
    const r = await as(hw).api("POST", "/api/jobs/contact-email", { companyName: "Ghost Ltd" });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe("NO_EMAIL");
    expect(await credits()).toBe(before);
    await as(hw).api("POST", "/api/jobs/contact-email", { companyName: "Ghost Ltd" });
    expect(hw.calls).toHaveLength(1);
  });

  it("treats Hunter's 'no such company' answer as nothing found, not an error", async () => {
    const r = await as(hunterWorld([], 404)).api("POST", "/api/jobs/contact-email", { companyName: "Nowhere Inc" });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe("NO_EMAIL");
  });

  it("refuses with 402 and changes nothing when there are fewer than 10 credits", async () => {
    await h.sql("UPDATE users SET credits = 9 WHERE normalized_email = 'jobseeker@sendrix.app'");
    const hw = hunterWorld([hunterEmail({ value: "jobs@poor.test" })]);
    const r = await as(hw).api("POST", "/api/jobs/contact-email", { companyName: "Poor Co" });
    expect(r.status).toBe(402);
    expect(r.json.error.code).toBe("INSUFFICIENT_CREDITS");
    expect(await credits()).toBe(9);
    expect((await ledger()).filter((l) => l.note === "poor co")).toEqual([]);
    await h.sql("UPDATE users SET credits = 100 WHERE normalized_email = 'jobseeker@sendrix.app'");
  });

  it("cannot overspend or double-charge when pressed several times at once", async () => {
    await h.sql("UPDATE users SET credits = 15 WHERE normalized_email = 'jobseeker@sendrix.app'");
    const hw = hunterWorld([hunterEmail({ value: "jobs@race.test" })]);
    const rs = await Promise.all([1, 2, 3, 4].map(() => as(hw).api("POST", "/api/jobs/contact-email", { companyName: "Race Co" })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => r.json.charged)).toHaveLength(1);
    expect(await credits()).toBe(5);
    await h.sql("UPDATE users SET credits = 100 WHERE normalized_email = 'jobseeker@sendrix.app'");
  });

  it("is switched off without a key (503, nothing charged), and never shows the key in an error", async () => {
    const before = await credits();
    expect((await as(null, null).api("POST", "/api/jobs/contact-email", { companyName: "Acme Corp" })).status).toBe(503);
    expect(await credits()).toBe(before);
    const bad = await as(hunterWorld([], 401)).api("POST", "/api/jobs/contact-email", { companyName: "Locked Co" });
    expect(bad.status).toBe(502);
    expect(JSON.stringify(bad.json)).not.toContain(KEY);
    const busy = await as(hunterWorld([], 429)).api("POST", "/api/jobs/contact-email", { companyName: "Busy Co" });
    expect(busy.status).toBe(429);
    expect(JSON.stringify(busy.json)).not.toContain(KEY);
    expect(await credits()).toBe(before);
  });

  it("validates the company name, and is for JobSeeker only", async () => {
    expect(await as(hunterWorld()).api("POST", "/api/jobs/contact-email", { companyName: "  " }).then((r) => r.status)).toBe(400);
    expect(await as(hunterWorld()).api("POST", "/api/jobs/contact-email", { companyName: "A", extra: 1 }).then((r) => r.status)).toBe(400);
    for (const who of [h, h.superAdmin]) expect((await who.api("POST", "/api/jobs/contact-email", { companyName: "Acme" })).status).toBe(403);
    expect((await h.anonymous.api("POST", "/api/jobs/contact-email", { companyName: "Acme" })).status).toBe(401);
  });
});

describe("Add to Contacts: POST /api/jobs/companies/add-contact", () => {
  let h: Harness;
  let hunterFetch: typeof fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
  beforeAll(async () => { h = await startHarness({ fetch: ((i: never, init?: never) => hunterFetch(i, init)) as typeof fetch }); });
  afterAll(async () => { await h.dispose(); });

  const email = "jobseeker@sendrix.app";
  const credits = async () => (await h.rows<{ credits: number }>("SELECT credits FROM users WHERE normalized_email = ?", email))[0]!.credits;
  const myContacts = () => h.rows<{ email: string; first_name: string; last_name: string; title: string; company_name: string; consent_source: string }>(
    "SELECT c.email, c.first_name, c.last_name, c.title, c.company_name, c.consent_source FROM contacts c JOIN users u ON u.id = c.user_id WHERE u.normalized_email = ?", email);
  const add = (hw: ReturnType<typeof hunterWorld> | null, company: string, key: string | null = KEY) => {
    if (hw) hunterFetch = hw.fetchFn;
    return h.withEnv({ DEV_ACTOR_EMAIL: email, ...(key ? { HUNTER_API_KEY: key } : {}) }).api("POST", "/api/jobs/companies/add-contact", { companyName: company });
  };
  const pat = () => hunterEmail({ value: "pat@acme.test", department: "hr", position: "Talent Lead", first_name: "Jullie", last_name: "Willis", confidence: 93 });

  it("adds the company's contact person to the user's contacts and takes 1 credit", async () => {
    const before = await credits();
    const hw = hunterWorld([pat()]);
    const r = await add(hw, "Acme Corp");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ email: "pat@acme.test", name: "Jullie Willis", position: "Talent Lead", charged: true, credits: before - 1 });
    expect(await credits()).toBe(before - 1);
    expect(await myContacts()).toEqual([{ email: "pat@acme.test", first_name: "Jullie", last_name: "Willis", title: "Talent Lead", company_name: "Acme Corp", consent_source: "Hiring companies" }]);
    const ledger = await h.rows<{ delta: number; reason: string; contact_id: string }>("SELECT t.delta, t.reason, t.contact_id FROM credit_transactions t JOIN users u ON u.id = t.user_id WHERE u.normalized_email = ? AND t.reason = 'company_contact_add'", email);
    expect(ledger).toEqual([{ delta: -1, reason: "company_contact_add", contact_id: r.json.contactId }]);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("does not charge again for a person who is already a contact, and shares Hunter's cache with Get Email Address", async () => {
    const before = await credits();
    const hw = hunterWorld();
    const r = await add(hw, "acme   CORP");
    expect(r.json).toMatchObject({ email: "pat@acme.test", charged: false, credits: before });
    expect(hw.calls).toHaveLength(0); // answered from the cache
    expect(await myContacts()).toHaveLength(1);
  });

  it("finds nobody: 404, nothing charged and no contact created", async () => {
    const before = await credits();
    const r = await add(hunterWorld([]), "Ghost Ltd");
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe("NO_EMAIL");
    expect(await credits()).toBe(before);
    expect(await myContacts()).toHaveLength(1);
  });

  it("refuses with 402 and creates nothing when there is no credit left", async () => {
    await h.sql("UPDATE users SET credits = 0 WHERE normalized_email = ?", email);
    const r = await add(hunterWorld([hunterEmail({ value: "jobs@poor.test", first_name: "Poor", last_name: "Co" })]), "Poor Co");
    expect(r.status).toBe(402);
    expect(r.json.error.code).toBe("INSUFFICIENT_CREDITS");
    expect(await credits()).toBe(0);
    expect((await myContacts()).some((c) => c.email === "jobs@poor.test")).toBe(false);
    await h.sql("UPDATE users SET credits = 100 WHERE normalized_email = ?", email);
  });

  it("cannot overspend or add twice when pressed several times at once", async () => {
    await h.sql("UPDATE users SET credits = 1 WHERE normalized_email = ?", email);
    const hw = hunterWorld([hunterEmail({ value: "jobs@race.test", first_name: "Race", last_name: "Co" })]);
    const rs = await Promise.all([1, 2, 3, 4].map(() => add(hw, "Race Co")));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => r.json.charged)).toHaveLength(1);
    expect(await credits()).toBe(0);
    expect((await myContacts()).filter((c) => c.email === "jobs@race.test")).toHaveLength(1);
    await h.sql("UPDATE users SET credits = 100 WHERE normalized_email = ?", email);
  });

  it("is switched off without a key (503), validates the name, and is for JobSeeker only", async () => {
    expect((await add(null, "Acme Corp", null)).status).toBe(503);
    expect((await add(hunterWorld(), "  ")).status).toBe(400);
    for (const who of [h, h.superAdmin]) expect((await who.api("POST", "/api/jobs/companies/add-contact", { companyName: "Acme" })).status).toBe(403);
    expect((await h.anonymous.api("POST", "/api/jobs/companies/add-contact", { companyName: "Acme" })).status).toBe(401);
  });
});
