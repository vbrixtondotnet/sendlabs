import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SHARE_CONFIRM_DELAY_MS, SHARE_DAILY_REWARD_CAP, shareWindowUrl } from "../../src/shared/shares";
import { sharedRemotiveCache } from "../../src/server/services/remotive-jobs";
import { sharedArbeitnowCache } from "../../src/server/services/arbeitnow-jobs";
import { startHarness, type Caller, type Harness } from "./harness";

const job = (id: number) => ({
  id, url: `https://remotive.com/remote-jobs/software-dev/job-${id}`, title: `Share Test Role ${id}`, company_name: "Acme Corp", company_logo: `https://remotive.com/job/${id}/logo`,
  category: "Software Development", tags: ["react"], job_type: "full_time", publication_date: "2026-11-19T14:58:42", candidate_required_location: "Worldwide", salary: "$3,000", description: "<p>Hello from the description</p>",
});
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const fetchFn = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.startsWith("https://himalayas.app/")) return json({ totalCount: 0, jobs: [] });
  if (url.startsWith("https://jobicy.com/")) return url.includes("get=") ? json({ industries: [], locations: [] }) : json({ apiVersion: "2", jobCount: 0, jobs: [] });
  if (url.startsWith("https://www.arbeitnow.com/")) return json({ data: [], links: {}, meta: {} });
  return json(url.includes("/categories") ? { jobs: [] } : { "job-count": 2, jobs: [job(1), job(2)] });
}) as typeof fetch;

let h: Harness;
beforeAll(async () => { h = await startHarness({ fetch: fetchFn }); });
afterAll(async () => { await h.dispose(); });
beforeEach(() => { sharedRemotiveCache.clear(); sharedArbeitnowCache.clear(); });

const start = (who: Caller, jobId = "remotive:1", network = "linkedin") => who.api("POST", "/api/jobs/share", { jobId, title: `Share Test Role ${jobId.split(":")[1]}`, network });
const confirm = (who: Caller, id: string) => who.api("POST", `/api/jobs/share/${id}/confirm`);
const credits = async (who: Caller) => (await who.api("GET", "/api/me")).json.user.credits as number;
const userId = async (who: Caller) => (await who.api("GET", "/api/me")).json.user.id as string;
/** Pretend the share window was opened a while ago. */
const backdate = (id: string) => h.sql(`UPDATE job_shares SET started_at = started_at - ${SHARE_CONFIRM_DELAY_MS + 1000} WHERE id = ?`, id);

describe("share windows", () => {
  it("opens LinkedIn's and Facebook's own share pages for the public link", () => {
    expect(shareWindowUrl("linkedin", "https://sendrix.app/share/x y")).toBe("https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fsendrix.app%2Fshare%2Fx%20y");
    expect(shareWindowUrl("facebook", "https://sendrix.app/share/x")).toBe("https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fsendrix.app%2Fshare%2Fx");
  });
});

describe("starting a share: POST /api/jobs/share", () => {
  it("is for a JobSeeker only", async () => {
    expect((await start(h.anonymous)).status).toBe(401);
    expect((await start(h)).status).toBe(403); // an Agency
    expect((await start(h.superAdmin)).status).toBe(403);
  });

  it("saves our own copy of the job and answers with the public link", async () => {
    const r = await start(h.jobSeeker);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ network: "linkedin", alreadyRewarded: false, confirmAfterMs: SHARE_CONFIRM_DELAY_MS });
    expect(r.json.url).toBe(`http://localhost:5173/share/${r.json.shareId}`);
    const [row] = await h.rows<{ snapshot: { job: { title: string; companyName: string }; blocks: unknown[] } }>("SELECT snapshot FROM job_shares WHERE id = ?", r.json.shareId);
    expect(row!.snapshot.job).toMatchObject({ title: "Share Test Role 1", companyName: "Acme Corp" });
    expect(row!.snapshot.blocks.length).toBeGreaterThan(0);
  });

  it("reuses the link for the same job and network, and gives each network its own", async () => {
    const a = await start(h.jobSeeker, "remotive:2", "facebook");
    const b = await start(h.jobSeeker, "remotive:2", "facebook");
    const c = await start(h.jobSeeker, "remotive:2", "linkedin");
    expect(b.json.shareId).toBe(a.json.shareId);
    expect(c.json.shareId).not.toBe(a.json.shareId);
  });

  it("refuses a job that is not listed, an unknown network and extra fields", async () => {
    expect((await h.jobSeeker.api("POST", "/api/jobs/share", { jobId: "remotive:999", title: "Share Test Role 999", network: "linkedin" })).status).toBe(404);
    expect((await start(h.jobSeeker, "remotive:1", "myspace")).status).toBe(400);
    expect((await h.jobSeeker.api("POST", "/api/jobs/share", { jobId: "remotive:1", title: "Share Test Role 1", network: "linkedin", userId: "x" })).status).toBe(400);
  });
});

describe("the public page's data: GET /api/share/:id", () => {
  it("needs no sign-in, shows the job and its description, and nothing about who shared it", async () => {
    const { json: s } = await start(h.jobSeeker);
    const r = await h.anonymous.api("GET", `/api/share/${s.shareId}`);
    expect(r.status).toBe(200);
    expect(r.json.job).toMatchObject({ id: "remotive:1", title: "Share Test Role 1", companyName: "Acme Corp" });
    expect(r.json.blocks.length).toBeGreaterThan(0);
    expect(Object.keys(r.json).sort()).toEqual(["blocks", "job"]);
    expect(JSON.stringify(r.json)).not.toContain("jobseeker@sendrix.app");
  });

  it("answers 404 for an unknown link", async () => {
    expect((await h.anonymous.api("GET", "/api/share/nope")).status).toBe(404);
  });
});

describe("the credit: POST /api/jobs/share/:id/confirm", () => {
  it("is refused before the delay, so a click straight away earns nothing", async () => {
    const { json: s } = await start(h.jobSeeker, "remotive:1", "facebook");
    const before = await credits(h.jobSeeker);
    const r = await confirm(h.jobSeeker, s.shareId);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("SHARE_TOO_EARLY");
    expect(await credits(h.jobSeeker)).toBe(before);
  });

  it("gives one credit, writes the ledger row, and only once for the same job and network", async () => {
    const { json: s } = await start(h.jobSeeker, "remotive:2", "linkedin");
    await backdate(s.shareId);
    const before = await credits(h.jobSeeker);
    const r = await confirm(h.jobSeeker, s.shareId);
    expect(r.json).toEqual({ rewarded: true, credits: before + 1 });
    expect(await credits(h.jobSeeker)).toBe(before + 1);
    const ledger = await h.rows<{ delta: number; reason: string; note: string }>("SELECT delta, reason, note FROM credit_transactions WHERE user_id = ? AND reason = 'social_share' ORDER BY created_at DESC LIMIT 1", await userId(h.jobSeeker));
    expect(ledger[0]).toEqual({ delta: 1, reason: "social_share", note: "linkedin:remotive:2" });
    // again: nothing more, and sharing it again says so
    expect(await confirm(h.jobSeeker, s.shareId)).toMatchObject({ status: 200, json: { rewarded: false, credits: before + 1 } });
    expect((await start(h.jobSeeker, "remotive:2", "linkedin")).json.alreadyRewarded).toBe(true);
  });

  it("two clicks at the same moment pay once", async () => {
    const seeker = await h.addAccount("Double Seeker", "double-seeker@sendrix.app", "JobSeeker");
    const who = h.as("double-seeker@sendrix.app");
    const { json: s } = await start(who, "remotive:1", "linkedin");
    await backdate(s.shareId);
    const before = await credits(who);
    const results = await Promise.all([confirm(who, s.shareId), confirm(who, s.shareId)]);
    expect(results.filter((r) => r.json.rewarded === true)).toHaveLength(1);
    expect(await credits(who)).toBe(before + 1);
    expect(seeker.userId).toBeTruthy();
  });

  it("is only for the person who shared it", async () => {
    const { json: s } = await start(h.jobSeeker, "remotive:1", "facebook");
    await backdate(s.shareId);
    await h.addAccount("Other Seeker", "other-seeker@sendrix.app", "JobSeeker");
    expect((await confirm(h.as("other-seeker@sendrix.app"), s.shareId)).status).toBe(404);
    expect((await confirm(h.anonymous, s.shareId)).status).toBe(401);
  });

  it("stops at the daily limit", async () => {
    const seeker = await h.addAccount("Capped Seeker", "capped-seeker@sendrix.app", "JobSeeker");
    const who = h.as("capped-seeker@sendrix.app");
    for (let i = 0; i < SHARE_DAILY_REWARD_CAP; i++) {
      await h.sql(`INSERT INTO job_shares (id, user_id, job_id, network, snapshot, started_at, rewarded_at, created_at) VALUES (?, ?, ?, 'linkedin', '{}'::jsonb, 1, ?, 1)`, `cap-${i}`, seeker.userId, `remotive:cap${i}`, Date.now());
    }
    const { json: s } = await start(who, "remotive:1", "linkedin");
    await backdate(s.shareId);
    const before = await credits(who);
    const r = await confirm(who, s.shareId);
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe("SHARE_DAILY_LIMIT");
    expect(await credits(who)).toBe(before);
  });
});

describe("the page people open: GET /share/:id", () => {
  const index = `<!doctype html><html><head><title>Sendrix</title></head><body><div id="root"></div></body></html>`;
  const assets = { fetch: async () => new Response(index, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;

  it("is the app's page with the job's title, company and logo as link-preview tags (escaped)", async () => {
    const { json: s } = await start(h.jobSeeker, "remotive:1", "linkedin");
    await h.sql(`UPDATE job_shares SET snapshot = jsonb_set(snapshot, '{job,title}', '"Dev <script>alert(1)</script> & co"') WHERE id = ?`, s.shareId);
    const r = await h.withEnv({ ASSETS: assets }).text(`/share/${s.shareId}`);
    expect(r.status).toBe(200);
    expect(r.body).toContain('<meta property="og:title" content="Dev &lt;script&gt;alert(1)&lt;/script&gt; &amp; co at Acme Corp">');
    expect(r.body).toContain('<meta property="og:image" content="https://remotive.com/job/1/logo">');
    expect(r.body).not.toContain("<script>alert(1)");
    expect(r.body).toContain('<div id="root">');
  });

  it("serves the plain app for an unknown link", async () => {
    const r = await h.withEnv({ ASSETS: assets }).text("/share/nope");
    expect(r.status).toBe(200);
    expect(r.body).toBe(index);
  });
});
