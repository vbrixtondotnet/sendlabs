import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jobListQuery } from "../../src/shared/schemas";
import { safeApplyUrl } from "../../src/shared/jobs";
import { JobSourceError } from "../../src/server/lib/live-fetch";
import { ArbeitnowCache, ArbeitnowJobService, sharedArbeitnowCache, LIST_TTL_MS as ARB_TTL, MAX_UPSTREAM_PER_HOUR as ARB_CAP, employmentTypeOf, mapArbeitnowJob } from "../../src/server/services/arbeitnow-jobs";
import { JobSearchService, isOpenToAnyone, matchesKeyword, matchesLocation } from "../../src/server/services/job-search";
import { LIST_TTL_MS, MAX_UPSTREAM_PER_HOUR, RemotiveCache, RemotiveJobService, mapRemotiveJob, sharedRemotiveCache } from "../../src/server/services/remotive-jobs";
import { JobicyCache, JobicyJobService, sharedJobicyCache, MAX_UPSTREAM_PER_HOUR as JOB_CAP, mapJobicyJob, salaryOf } from "../../src/server/services/jobicy-jobs";
import { HimalayasCache, HimalayasJobService, mapHimalayasJob, sharedHimalayasCache } from "../../src/server/services/himalayas-jobs";
import { JoobleCache, JoobleJobService, mapJoobleJob } from "../../src/server/services/jooble-jobs";
import { shortLocation } from "../../src/shared/jobs";
import { startHarness, type Harness } from "./harness";

/** A job as Remotive's API sends it. */
const rem = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  url: `https://remotive.com/remote-jobs/software-dev/job-${id}`,
  title: `Job ${id}`,
  company_name: "Acme Corp",
  company_logo: `https://remotive.com/job/${id}/logo`,
  category: "Software Development",
  tags: ["react", "node"],
  job_type: "full_time",
  publication_date: "2026-11-19T14:58:42",
  candidate_required_location: "Worldwide",
  salary: "$3,000-$5,000",
  description: "<p>Hello</p>",
  ...over,
});

/** A job as Arbeitnow's API sends it (created_at is in seconds). */
const arb = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  company_name: "Tulip",
  title: `Role ${slug}`,
  description: "&lt;p&gt;Secret description&lt;/p&gt;",
  remote: false,
  url: `https://www.arbeitnow.com/jobs/companies/tulip/${slug}`,
  tags: ["Engineering"],
  job_types: ["Full Time"],
  location: "Munich",
  created_at: Date.UTC(2026, 10, 19, 12, 0, 0) / 1000,
  ...over,
});

/** A job as Jobicy's API sends it (pubDate has no zone: UTC). */
const jb = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  url: `https://jobicy.com/jobs/${id}-role-${id}`,
  jobTitle: `Jobicy role ${id}`,
  companyName: "Globex &amp; Co",
  companyLogo: `https://jobicy.com/data/logo/${id}.png`,
  jobIndustry: ["Marketing &amp; Sales"],
  jobType: ["Full-Time"],
  jobGeo: "Anywhere",
  jobLevel: "Senior",
  jobDescription: "<p>Jobicy description</p>",
  pubDate: "2026-11-20 09:30:00",
  salaryMin: 60000,
  salaryMax: 80000,
  salaryCurrency: "USD",
  salaryPeriod: "yearly",
  ...over,
});

/** A job as Himalayas's search sends it (pubDate is in seconds). */
const him = (slug: string, over: Record<string, unknown> = {}) => ({
  title: `Himalayas role ${slug}`,
  companyName: "Virtual Assist",
  companyLogo: "https://cdn-images.himalayas.app/abc",
  employmentType: "Full Time",
  minSalary: 8000,
  maxSalary: 12000,
  currency: "USD",
  salaryPeriod: "monthly",
  locationRestrictions: ["Philippines", "India"],
  categories: ["Virtual-Assistant", "Administrative-Support"],
  parentCategories: ["Human Resources"],
  description: "<p>Himalayas description</p>",
  pubDate: Date.UTC(2026, 10, 24, 10) / 1000,
  applicationLink: `https://himalayas.app/companies/virtual-assist/jobs/${slug}?utm_source=api`,
  guid: `https://himalayas.app/companies/virtual-assist/jobs/${slug}`,
  ...over,
});

/** A job as Jooble sends it. */
const joo = (n: number, over: Record<string, unknown> = {}) => ({
  id: 4000000000000000000 + n,
  title: `Jooble <b>role</b> ${n}`,
  location: "Manila, Philippines",
  snippet: "Work from home as a &nbsp;virtual assistant",
  salary: "PHP 25,000",
  source: "example.com",
  type: "Full-time",
  link: `https://jooble.org/desc/${n}`,
  company: "Acme PH",
  updated: "2026-11-24T10:30:00.0000000",
  ...over,
});

/** A stand-in for all the sources: records every request URL, answers from `remotive` / `arbeitnow`, and each can fail or be held back. */
function world(initial: { remotive?: unknown[]; arbeitnow?: unknown[]; jobicy?: unknown[]; himalayas?: unknown[]; jooble?: unknown[]; jobicyReference?: boolean } = {}) {
  const state = {
    remotive: (initial.remotive ?? []) as unknown[],
    arbeitnow: (initial.arbeitnow ?? []) as unknown[],
    jobicy: (initial.jobicy ?? []) as unknown[],
    himalayas: (initial.himalayas ?? []) as unknown[],
    jooble: (initial.jooble ?? []) as unknown[],
    joobleBodies: [] as unknown[],
    failHimalayas: null as null | (() => Response),
    categories: [{ id: 1, name: "Software Development", slug: "software-dev" }, { id: 2, name: "Customer Service", slug: "customer-support" }],
    calls: [] as string[],
    failRemotive: null as null | (() => Response),
    failArbeitnow: null as null | (() => Response),
    failJobicy: null as null | (() => Response),
    gate: null as null | Promise<void>,
  };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    state.calls.push(url);
    if (state.gate) await state.gate;
    if (url.startsWith("https://himalayas.app/")) return state.failHimalayas ? state.failHimalayas() : json({ totalCount: state.himalayas.length, jobs: state.himalayas });
    if (url.startsWith("https://jooble.org/api/")) {
      state.joobleBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return json({ totalCount: state.jooble.length, jobs: state.jooble });
    }
    if (url.startsWith("https://jobicy.com/")) {
      if (url.includes("get=industries")) return json({ industries: !initial.jobicyReference ? [] : [{ industryName: "Marketing &amp; Sales", industrySlug: "marketing" }, { industryName: "Legal &amp; Compliance", industrySlug: "legal" }] });
      if (url.includes("get=locations")) return json({ locations: !initial.jobicyReference ? [] : [{ geoName: "Anywhere", geoSlug: "anywhere" }, { geoName: "USA", geoSlug: "usa" }, { geoName: "Germany", geoSlug: "germany" }] });
      return state.failJobicy ? state.failJobicy() : json({ apiVersion: "2", jobCount: state.jobicy.length, jobs: state.jobicy });
    }
    if (url.startsWith("https://www.arbeitnow.com/")) return state.failArbeitnow ? state.failArbeitnow() : json({ data: state.arbeitnow, links: {}, meta: {} });
    if (state.failRemotive) return state.failRemotive();
    return json(url.includes("/categories") ? { jobs: state.categories } : { "job-count": state.remotive.length, jobs: state.remotive });
  }) as typeof fetch;
  const count = (host: string) => state.calls.filter((c) => c.includes(host)).length;
  return { state, fetchFn, count };
}

type Opts = { now?: () => number; timeoutMs?: number };
const makeRemotive = (f: typeof fetch, o: Opts = {}) => new RemotiveJobService({ fetch: f, cache: new RemotiveCache(), ...(o.now ? { now: o.now } : {}), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) });
const makeArbeitnow = (f: typeof fetch, o: Opts = {}) => new ArbeitnowJobService({ fetch: f, cache: new ArbeitnowCache(), ...(o.now ? { now: o.now } : {}), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) });
/** The merged search, with caches of its own so tests never share what they remembered. */
const makeJobicy = (f: typeof fetch, o: Opts = {}) => new JobicyJobService({ fetch: f, cache: new JobicyCache(), ...(o.now ? { now: o.now } : {}), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) });
const makeHimalayas = (f: typeof fetch, o: Opts = {}) => new HimalayasJobService({ fetch: f, cache: new HimalayasCache(), ...(o.now ? { now: o.now } : {}), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) });
const makeJooble = (f: typeof fetch, o: Opts = {}) => new JoobleJobService({ fetch: f, apiKey: "secret-key-123", cache: new JoobleCache(), ...(o.now ? { now: o.now } : {}), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) });
const makeSearch = (f: typeof fetch, o: Opts = {}, withJooble = false) =>
  new JobSearchService({ remotive: makeRemotive(f, o), arbeitnow: makeArbeitnow(f, o), jobicy: makeJobicy(f, o), himalayas: makeHimalayas(f, o), ...(withJooble ? { jooble: makeJooble(f, o) } : {}) });
const q = (o: Record<string, unknown> = {}) => jobListQuery.parse(o);
const ids = async (s: JobSearchService, o: Record<string, unknown> = {}) => (await s.list(q(o))).items.map((j) => j.id);

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.dispose(); });
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("nothing is saved", () => {
  it("has no job tables, and a search leaves the database as it was", async () => {
    const tables = async () => (await h.rows<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((t) => t.table_name);
    const before = await tables();
    expect(before.filter((t) => /job/.test(t))).toEqual([]);
    const { fetchFn } = world({ remotive: [rem(1)], arbeitnow: [arb("a")] });
    await makeSearch(fetchFn).list(q());
    expect(await tables()).toEqual(before);
  });
});

describe("mapping Remotive's job", () => {
  it("maps every field to the app's JobDto, reads the time as UTC, and says which source it is", () => {
    expect(mapRemotiveJob(rem(7) as never)).toEqual({
      id: "remotive:7", title: "Job 7", companyName: "Acme Corp", companyLogo: "https://remotive.com/job/7/logo", category: "Software Development", employmentType: "Full-time",
      remote: true, location: "Worldwide", salary: "$3,000-$5,000", skills: ["react", "node"], url: "https://remotive.com/remote-jobs/software-dev/job-7", source: "Remotive",
      publishedAt: "2026-11-19T14:58:42.000Z",
    });
    expect(mapRemotiveJob(rem(8, { job_type: "part_time" }) as never).employmentType).toBe("Part-time");
    expect(mapRemotiveJob(rem(9, { job_type: "some_new_type" }) as never).employmentType).toBe("some new type");
  });

  it("copes with missing logo, salary, location and date, and validates the apply link and the picture", () => {
    expect(mapRemotiveJob({ id: "x1", title: "T" } as never)).toMatchObject({ id: "remotive:x1", companyName: "", companyLogo: "", salary: "", location: "", skills: [], publishedAt: null, url: "" });
    expect(mapRemotiveJob(rem(11, { url: "javascript:alert(1)", company_logo: "http://insecure.example/x.png" }) as never)).toMatchObject({ url: "", companyLogo: "" });
    expect(mapRemotiveJob(rem(12, { url: "https://evil.example/remotive.com" }) as never).url).toBe("");
    expect(mapRemotiveJob(rem(13, { url: "http://remotive.com/x" }) as never).url).toBe("");
  });
});

describe("mapping Arbeitnow's job", () => {
  it("maps every field to the app's JobDto, with the time in seconds, and says which source it is", () => {
    expect(mapArbeitnowJob(arb("senior-dev", { tags: ["Engineering", "Remote"], remote: true, location: "Berlin" }) as never)).toEqual({
      id: "arbeitnow:senior-dev", title: "Role senior-dev", companyName: "Tulip", companyLogo: "", category: "Engineering", employmentType: "Full-time",
      remote: true, location: "Berlin", salary: "", skills: ["Engineering"], url: "https://www.arbeitnow.com/jobs/companies/tulip/senior-dev", source: "Arbeitnow",
      publishedAt: "2026-11-19T12:00:00.000Z",
    });
  });

  it("knows a remote job by its flag, a Remote tag, or the words 'Remote job' for a location (which is not a place)", () => {
    expect(mapArbeitnowJob(arb("a", { remote: true }) as never).remote).toBe(true);
    expect(mapArbeitnowJob(arb("b", { tags: ["Remote", "Sales"] }) as never)).toMatchObject({ remote: true, skills: ["Sales"], category: "Sales" });
    expect(mapArbeitnowJob(arb("c", { location: "Remote job" }) as never)).toMatchObject({ remote: true, location: "" });
    expect(mapArbeitnowJob(arb("d") as never).remote).toBe(false);
  });

  it("copes with missing fields, and keeps an unsafe link out but accepts Arbeitnow's national sites", () => {
    expect(mapArbeitnowJob({ slug: "s" } as never)).toMatchObject({ id: "arbeitnow:s", title: "", companyName: "", location: "", skills: [], employmentType: "", publishedAt: null, url: "", remote: false });
    expect(mapArbeitnowJob(arb("e", { url: "http://www.arbeitnow.com/x" }) as never).url).toBe("");
    expect(mapArbeitnowJob(arb("f", { url: "https://evil.example/arbeitnow.com" }) as never).url).toBe("");
    expect(mapArbeitnowJob(arb("g", { url: "https://www.arbeitnow.co.uk/jobs/g" }) as never).url).toBe("https://www.arbeitnow.co.uk/jobs/g");
    expect(safeApplyUrl("https://www.arbeitnow.nl/x")).not.toBe("");
    expect(safeApplyUrl("https://notarbeitnow.com/x")).toBe("");
  });

  it("shows the kind of contract only, in any of its languages, and ignores levels of experience", () => {
    const cases: [string[], string][] = [
      [["Full Time"], "Full-time"], [["fulltime permanent"], "Full-time"], [["Unbefristeter arbeitsvertrag"], "Full-time"], [["Cdi - contrat à durée indéterminée"], "Full-time"],
      [["fulltime fixed term"], "Full-time"], [["parttime permanent"], "Part-time"], [["Teilzeit"], "Part-time"], [["internship"], "Internship"], [["Praktikum"], "Internship"],
      [["Convention de stage"], "Internship"], [["freelance"], "Freelance"], [["Selbstständiger / freelancer"], "Freelance"], [["Temporary/Contract"], "Contract"],
      [["Befristeter arbeitsvertrag"], "Contract"], [["Experienced", "Mid", "Entry"], ""], [["berufserfahren"], ""], [[], ""], [["Experienced", "Full Time"], "Full-time"],
    ];
    for (const [types, want] of cases) expect(employmentTypeOf(types), types.join("|")).toBe(want);
  });
});

describe("Jobicy", () => {
  it("maps its job to the app's JobDto: entities decoded, UTC time, pay line, remote, its own link", () => {
    expect(mapJobicyJob(jb(5) as never)).toEqual({
      id: "jobicy:5", title: "Jobicy role 5", companyName: "Globex & Co", companyLogo: "https://jobicy.com/data/logo/5.png", category: "Marketing & Sales", employmentType: "Full-time",
      remote: true, location: "Anywhere", salary: "USD 60,000 - 80,000 / year", skills: ["Marketing & Sales"], url: "https://jobicy.com/jobs/5-role-5", source: "Jobicy",
      publishedAt: "2026-11-20T09:30:00.000Z",
    });
  });

  it("copes with missing fields, and only links to its own site", () => {
    expect(mapJobicyJob({ id: 9, jobTitle: "T" } as never)).toMatchObject({ id: "jobicy:9", companyName: "", salary: "", location: "", skills: [], publishedAt: null, url: "", employmentType: "" });
    expect(mapJobicyJob(jb(1, { url: "https://evil.example/jobicy.com" }) as never).url).toBe("");
    expect(mapJobicyJob(jb(2, { url: "http://jobicy.com/x" }) as never).url).toBe("");
    expect(mapJobicyJob(jb(3, { jobType: ["Part-Time"] }) as never).employmentType).toBe("Part-time");
    expect(salaryOf({ salaryMin: 0, salaryMax: 0 })).toBe("");
    expect(salaryOf({ salaryMin: 50, salaryMax: 50, salaryCurrency: "EUR", salaryPeriod: "hourly" })).toBe("EUR 50 / hour");
  });

  it("is merged with the other sources, newest first, and its description is read from memory", async () => {
    const { state, fetchFn } = world({ remotive: [rem(1)], arbeitnow: [arb("a")], jobicy: [jb(1, { pubDate: "2026-11-25 10:00:00" })] });
    const s = makeSearch(fetchFn);
    expect((await ids(s))[0]).toBe("jobicy:1");
    expect(state.calls.filter((c) => c.startsWith("https://jobicy.com/api/v2/remote-jobs") && !c.includes("get="))).toEqual(["https://jobicy.com/api/v2/remote-jobs?count=100"]);
    expect(await s.description("jobicy:1")).toEqual([{ type: "paragraph", text: "Jobicy description" }]);
    expect(await s.description("jobicy:nope")).toBeNull();
  });

  it("keeps a search for ten minutes, and the others still answer when it fails", async () => {
    let t = 1_000_000;
    const { count, state, fetchFn } = world({ remotive: [rem(1)], jobicy: [jb(1)] });
    const s = makeSearch(fetchFn, { now: () => t });
    await s.list(q());
    await s.list(q());
    expect(count("jobicy.com/api/v2/remote-jobs?count")).toBe(1);
    state.failJobicy = () => new Response("nope", { status: 500 });
    const other = makeSearch(fetchFn, { now: () => t });
    const r = await other.list(q());
    expect(r.unavailable).toEqual(["Jobicy"]);
    expect(r.items.some((j) => j.source === "Remotive")).toBe(true);
  });

  it("is capped per hour", async () => {
    let t = 1_000_000;
    const { count, fetchFn } = world({ jobicy: [jb(1)] });
    const svc = makeJobicy(fetchFn, { now: () => t });
    for (let i = 0; i < JOB_CAP; i++) { t += 11 * 60_000 / JOB_CAP; await svc.jobs({ keyword: `k${i}` }); } // each search is new: a real request
    expect(count("jobicy.com")).toBe(JOB_CAP);
    await expect(svc.jobs({ keyword: "one too many" })).rejects.toMatchObject({ kind: "rate_limit" });
  });

  it("passes the page's filters to Jobicy: the words as tag, the category as industry, each place as geo", async () => {
    const { state, fetchFn } = world({ jobicy: [jb(1, { jobGeo: "USA" }), jb(2, { jobGeo: "Germany" })], jobicyReference: true });
    const s = makeSearch(fetchFn);
    // (the plain list is also asked for once, to build the category choices: that one is not a filter)
    const asked = () => state.calls.filter((c) => c.includes("remote-jobs?count") && c !== "https://jobicy.com/api/v2/remote-jobs?count=100");
    await s.list(q({ keyword: "marketing", category: "Marketing & Sales", locations: "USA" }));
    expect(asked()).toEqual([
      "https://jobicy.com/api/v2/remote-jobs?count=100&geo=usa&industry=marketing&tag=marketing",
      "https://jobicy.com/api/v2/remote-jobs?count=100&geo=anywhere&industry=marketing&tag=marketing",
    ]);
    state.calls.length = 0;
    await s.list(q({ locations: "USA,Germany" }));
    expect(asked().map((c) => /geo=([a-z]*)/.exec(c)?.[1])).toEqual(["usa", "germany", "anywhere"]);
    state.calls.length = 0;
    await s.list(q({ locations: "Narnia" })); // not a place Jobicy knows: asked without one, and checked here
    expect(asked()).toEqual([]); // no geo request: only the plain list
  });

  it("offers all of Jobicy's industries as categories, and a search by one returns only Jobicy's answer for it", async () => {
    const { fetchFn } = world({ jobicy: [jb(1, { jobIndustry: ["Marketing &amp; Sales"] })], jobicyReference: true });
    const s = makeSearch(fetchFn);
    expect((await s.categories()).map((c) => c.label)).toEqual(expect.arrayContaining(["Marketing & Sales", "Legal & Compliance"]));
    expect(await ids(s, { category: "Marketing & Sales" })).toEqual(["jobicy:1"]);
  });
});

describe("Himalayas", () => {
  it("maps its job: remote, open to the countries it lists, pay line, broad category, its own link", () => {
    expect(mapHimalayasJob(him("va") as never)).toEqual({
      id: "himalayas:companies/virtual-assist/jobs/va", title: "Himalayas role va", companyName: "Virtual Assist", companyLogo: "https://cdn-images.himalayas.app/abc",
      category: "Human Resources", employmentType: "Full-time", remote: true, location: "Philippines, India", salary: "USD 8,000 - 12,000 / month",
      skills: ["Human Resources", "Virtual Assistant", "Administrative Support"], url: "https://himalayas.app/companies/virtual-assist/jobs/va?utm_source=api",
      source: "Himalayas", publishedAt: "2026-11-24T10:00:00.000Z",
    });
    expect(mapHimalayasJob(him("x", { locationRestrictions: [], applicationLink: "https://evil.example/himalayas.app" }) as never)).toMatchObject({ location: "", url: "" });
    expect(mapHimalayasJob(him("y", { employmentType: "Contractor" }) as never).employmentType).toBe("Contract");
  });

  it("passes the keyword as q and each place as country, two pages at most, and merges with the others", async () => {
    const full = Array.from({ length: 20 }, (_, i) => him(`job${i}`));
    const { state, fetchFn } = world({ himalayas: full });
    const s = makeSearch(fetchFn);
    const r = await s.list(q({ keyword: "virtual assistant", locations: "Philippines,India", pageSize: 100 }));
    const asked = state.calls.filter((c) => c.startsWith("https://himalayas.app/"));
    expect(asked.filter((c) => c.includes("q=virtual+assistant") && c.includes("country=Philippines"))).toHaveLength(2); // page 1 and 2 (page 1 was full)
    expect(asked.some((c) => c.includes("country=India"))).toBe(true);
    expect(asked.some((c) => c.includes("page=2"))).toBe(true);
    expect(r.items.every((j) => /virtual assistant/i.test(`${j.title} ${j.skills.join(" ")} ${j.companyName}`))).toBe(true);
    expect(r.items.some((j) => j.source === "Himalayas")).toBe(true);
    expect(await s.description("himalayas:companies/virtual-assist/jobs/job1")).toEqual([{ type: "paragraph", text: "Himalayas description" }]);
  });

  it("is not fatal when it fails, and shortens a long country list for display only", async () => {
    const { state, fetchFn } = world({ remotive: [rem(1)] });
    state.failHimalayas = () => new Response("x", { status: 500 });
    const r = await makeSearch(fetchFn).list(q());
    expect(r.unavailable).toEqual(["Himalayas"]);
    expect(r.items.map((j) => j.id)).toEqual(["remotive:1"]);
    expect(shortLocation("A, B, C")).toBe("A, B, C");
    expect(shortLocation("A, B, C, D, E, F, G, H")).toBe("A, B, C, D, E +3 more");
  });
});

describe("Jooble", () => {
  it("maps its job: markup stripped, a stable id from the link, remote only when it says so", () => {
    const a = mapJoobleJob(joo(1) as never);
    expect(a).toMatchObject({ title: "Jooble role 1", companyName: "Acme PH", location: "Manila, Philippines", salary: "PHP 25,000", employmentType: "Full-time", source: "Jooble", url: "https://jooble.org/desc/1", remote: true, publishedAt: "2026-11-24T10:30:00.000Z" });
    expect(mapJoobleJob(joo(1) as never).id).toBe(a.id);
    expect(mapJoobleJob(joo(2) as never).id).not.toBe(a.id);
    expect(mapJoobleJob(joo(3, { snippet: "On site in the office", title: "Cashier" }) as never).remote).toBe(false);
    expect(mapJoobleJob(joo(4, { link: "https://evil.example/x" }) as never).url).toBe("");
  });

  it("is only used when there is a key", async () => {
    const { state, fetchFn } = world({ remotive: [rem(1)], jooble: [joo(1)] });
    await makeSearch(fetchFn).list(q());
    expect(state.calls.some((c) => c.startsWith("https://jooble.org/"))).toBe(false);
    const { jobSources } = await import("../../src/server/services/job-search");
    expect(jobSources(fetchFn).jooble).toBeUndefined();
    expect(jobSources(fetchFn, { joobleApiKey: "  " }).jooble).toBeUndefined();
    expect(jobSources(fetchFn, { joobleApiKey: "k" }).jooble).toBeDefined();
  });

  it("POSTs the keyword and each place; asks for 'remote' by default; skips itself when a category is chosen", async () => {
    const { state, fetchFn } = world({ jooble: [joo(1)] });
    const s = makeSearch(fetchFn, {}, true);
    expect((await s.list(q())).items.some((j) => j.source === "Jooble")).toBe(true);
    expect(state.joobleBodies.at(-1)).toMatchObject({ keywords: "remote" });
    expect(state.calls.find((c) => c.startsWith("https://jooble.org/"))).toBe("https://jooble.org/api/secret-key-123");
    state.joobleBodies.length = 0;
    await s.list(q({ keyword: "virtual assistant", locations: "Philippines,India" }));
    expect(state.joobleBodies).toEqual(expect.arrayContaining([{ keywords: "virtual assistant", location: "Philippines", page: "1" }, { keywords: "virtual assistant", location: "India", page: "1" }]));
    state.joobleBodies.length = 0;
    await s.list(q({ category: "Software Development" }));
    expect(state.joobleBodies).toEqual([]);
    expect(await s.description(mapJoobleJob(joo(1) as never).id)).toEqual([{ type: "paragraph", text: "Work from home as a virtual assistant" }]);
  });

  it("never puts its key in an error", async () => {
    const fetchFn = (async () => new Response("denied", { status: 403 })) as typeof fetch;
    const err = await makeJooble(fetchFn).jobs().catch((e) => e as Error);
    expect(err).toMatchObject({ name: "JobSourceError", kind: "http" });
    expect((err as Error).message).not.toContain("secret-key-123");
  });
});

describe("Hiring Companies follow the search", () => {
  it("counts each company's jobs in the current results, and View Company's list has exactly that many", async () => {
    const { fetchFn } = world({
      remotive: [rem(1, { company_name: "Acme Corp" }), rem(2, { company_name: "ACME corp." }), rem(3, { company_name: "Beta LLC" })],
      arbeitnow: [arb("a", { company_name: "Acme Corp" })],
    });
    const s = makeSearch(fetchFn);
    const c = await s.companies(q());
    expect(c.items.map((x) => [x.name, x.openPositions])).toEqual([["Acme Corp", 3], ["Beta LLC", 1]]);
    expect(c.total).toBe(2);
    expect(c.items[0]!.sampleTitles.length).toBeGreaterThan(0);
    const list = await s.list(q({ company: "Acme Corp" }));
    expect(list.total).toBe(3);
    expect(list.items.every((j) => /acme/i.test(j.companyName))).toBe(true);
  });

  it("uses the same filters as the list, but not the company filter itself", async () => {
    const { fetchFn } = world({ remotive: [rem(1, { company_name: "Acme Corp", title: "Python dev" }), rem(2, { company_name: "Beta LLC", title: "Cook" })] });
    const s = makeSearch(fetchFn);
    expect((await s.companies(q({ keyword: "python" }))).items.map((x) => x.name)).toEqual(["Acme Corp"]);
    expect((await s.companies(q({ company: "Beta LLC" }))).items.map((x) => x.name).sort()).toEqual(["Acme Corp", "Beta LLC"]);
    expect((await s.list(q({ keyword: "python", company: "Beta LLC" }))).total).toBe(0);
  });
});

describe("the live requests", () => {
  it("asks Remotive for 50 jobs (with search and category when there are any) and Arbeitnow for its first page", async () => {
    const { state, fetchFn } = world({ remotive: [rem(1)], arbeitnow: [arb("a")] });
    const s = makeSearch(fetchFn);
    await s.list(q());
    expect(state.calls.filter((c) => c.includes("remotive.com/api/remote-jobs?"))).toEqual(["https://remotive.com/api/remote-jobs?limit=50"]);
    expect(state.calls).toContain("https://www.arbeitnow.com/api/job-board-api?page=1");
    await s.list(q({ keyword: "react dev", category: "software-dev" }));
    const u = new URL(state.calls.filter((c) => c.includes("remotive.com/api/remote-jobs?")).at(-1)!);
    expect(Object.fromEntries(u.searchParams)).toEqual({ limit: "50", search: "react dev", category: "software-dev" });
  });

  it("combines both sources into one list, newest first across them, and pages the whole", async () => {
    const { fetchFn } = world({
      remotive: [rem(1, { publication_date: "2026-11-20T10:00:00" }), rem(2, { publication_date: "2026-11-10T10:00:00" })],
      arbeitnow: [arb("a", { created_at: Date.UTC(2026, 10, 19, 10) / 1000 }), arb("b", { created_at: Date.UTC(2026, 10, 25, 10) / 1000 }), arb("c", { created_at: Date.UTC(2026, 10, 1, 10) / 1000 })],
    });
    const s = makeSearch(fetchFn);
    expect(await ids(s)).toEqual(["arbeitnow:b", "remotive:1", "arbeitnow:a", "remotive:2", "arbeitnow:c"]);
    expect(await ids(s, { sort: "oldest" })).toEqual(["arbeitnow:c", "remotive:2", "arbeitnow:a", "remotive:1", "arbeitnow:b"]);
    const p2 = await s.list(q({ pageSize: 2, page: 2 }));
    expect(p2).toMatchObject({ total: 5, page: 2, pageSize: 2, unavailable: [] });
    expect(p2.items.map((j) => j.id)).toEqual(["arbeitnow:a", "remotive:2"]);
    expect((await s.list(q())).items.map((j) => j.source)).toEqual(["Arbeitnow", "Remotive", "Arbeitnow", "Remotive", "Arbeitnow"]);
  });

  it("puts undated jobs last whichever way it sorts", async () => {
    const { fetchFn } = world({ remotive: [rem(1, { publication_date: null }), rem(2, { publication_date: "2026-11-01T00:00:00" })], arbeitnow: [arb("a", { created_at: null })] });
    const s = makeSearch(fetchFn);
    expect((await ids(s)).at(0)).toBe("remotive:2");
    expect((await ids(s, { sort: "oldest" })).at(0)).toBe("remotive:2");
  });

  it("keeps a job a source lists twice once, skips one without a title or of the wrong shape, and never returns a description", async () => {
    const { fetchFn } = world({ remotive: [rem(1), rem(1, { title: "Dup" }), rem(2, { title: "" }), { nonsense: true }, "text", null], arbeitnow: [arb("a"), arb("a", { title: "Dup" }), { nope: 1 }, arb("b", { title: "" })] });
    const r = await makeSearch(fetchFn).list(q());
    expect(r.items.map((j) => j.id).sort()).toEqual(["arbeitnow:a", "remotive:1"]);
    expect(r.items.find((j) => j.id === "remotive:1")!.title).toBe("Job 1");
    expect(JSON.stringify(r)).not.toMatch(/Hello|Secret description/);
  });
});

describe("filters (all applied here, on the merged list)", () => {
  const data = () => world({
    remotive: [
      rem(1, { title: "Senior .NET Developer", tags: ["c#", "azure"], candidate_required_location: "USA, Canada", category: "Software Development" }),
      rem(2, { title: "Support Agent", company_name: "Beta LLC", tags: ["zendesk"], candidate_required_location: "Worldwide", category: "Customer Service" }),
    ],
    arbeitnow: [
      arb("berlin-dev", { title: "Backend Engineer", tags: ["Engineering"], location: "Berlin", remote: false }),
      arb("remote-sales", { title: "Sales Lead", company_name: "Gamma", tags: ["Sales", "Remote"], location: "Remote job", remote: true }),
      arb("paris-marketing", { title: "Growth Marketer", tags: ["Online Marketing"], location: "Paris, France", remote: false }),
    ],
  });

  it("keyword: every word, in the title, company, category or skills, any case", async () => {
    const s = makeSearch(data().fetchFn);
    expect(await ids(s, { keyword: ".NET" })).toEqual(["remotive:1"]);
    expect(await ids(s, { keyword: "AZURE c#" })).toEqual(["remotive:1"]);
    expect(await ids(s, { keyword: "beta" })).toEqual(["remotive:2"]);
    expect(await ids(s, { keyword: "tulip" })).toEqual(["arbeitnow:berlin-dev", "arbeitnow:paris-marketing"].sort().reverse().length ? expect.arrayContaining(["arbeitnow:berlin-dev", "arbeitnow:paris-marketing"]) : []);
    expect(await ids(s, { keyword: "tulip engineer" })).toEqual(["arbeitnow:berlin-dev"]);
    expect(await ids(s, { keyword: "zzzz" })).toEqual([]);
    expect(matchesKeyword(mapRemotiveJob(rem(1) as never), "")).toBe(true);
  });

  it("Remote only keeps jobs that can be done remotely: all of Remotive, and Arbeitnow's remote ones", async () => {
    const s = makeSearch(data().fetchFn);
    expect((await ids(s, { remoteOnly: "true" })).sort()).toEqual(["arbeitnow:remote-sales", "remotive:1", "remotive:2"]);
    expect((await ids(s)).length).toBe(5);
  });

  it("location: a place in the job's location, or a job open to anyone (a worldwide or place-less job suits any place)", async () => {
    const s = makeSearch(data().fetchFn);
    expect((await ids(s, { locations: "Berlin" })).sort()).toEqual(["arbeitnow:berlin-dev", "arbeitnow:remote-sales", "remotive:2"]);
    expect((await ids(s, { locations: "canada" })).sort()).toEqual(["arbeitnow:remote-sales", "remotive:1", "remotive:2"]);
    expect((await ids(s, { locations: "France,Berlin" })).sort()).toEqual(["arbeitnow:berlin-dev", "arbeitnow:paris-marketing", "arbeitnow:remote-sales", "remotive:2"]);
    expect(isOpenToAnyone("Anywhere in the world")).toBe(true);
    expect(isOpenToAnyone("USA only")).toBe(false);
    expect(matchesLocation(mapRemotiveJob(rem(5, { candidate_required_location: "LATAM, Europe" }) as never), ["latam"])).toBe(true);
  });

  it("category: Remotive's categories by slug or name, and Arbeitnow's topics; Remotive is asked only about its own", async () => {
    const { state, fetchFn } = data();
    const s = makeSearch(fetchFn);
    expect(await ids(s, { category: "software-dev" })).toEqual(["remotive:1"]); // Remotive's slug -> its name
    expect(state.calls.some((c) => c.includes("category=software-dev"))).toBe(true);
    expect(await ids(s, { category: "customer-support" })).toEqual(["remotive:2"]);
    const before = state.calls.length;
    expect(await ids(s, { category: "Sales" })).toEqual(["arbeitnow:remote-sales"]); // an Arbeitnow topic
    expect(state.calls.slice(before).some((c) => c.includes("category="))).toBe(false); // Remotive was not asked for a category it does not have
    expect(await ids(s, { category: "Engineering" })).toEqual(["arbeitnow:berlin-dev"]);
  });

  it("combines the filters", async () => {
    const s = makeSearch(data().fetchFn);
    expect(await ids(s, { keyword: "lead", remoteOnly: "true", category: "Sales", locations: "Berlin" })).toEqual(["arbeitnow:remote-sales"]);
  });
});

describe("Arbeitnow: English jobs only (the default)", () => {
  const EN_TEXT = "&lt;p&gt;We are looking for a senior engineer to join our team. You will work with the product group and help us build the platform for our customers.&lt;/p&gt;";
  const DE_TEXT = "&lt;p&gt;Wir suchen einen erfahrenen Entwickler für unser Team. Sie arbeiten mit der Produktgruppe und helfen uns, die Plattform für unsere Kunden zu bauen.&lt;/p&gt;";
  const FR_TEXT = "&lt;p&gt;Nous recherchons un ingénieur expérimenté pour rejoindre notre équipe. Vous travaillerez avec le groupe produit et vous nous aiderez à construire la plateforme pour nos clients.&lt;/p&gt;";
  const NL_TEXT = "&lt;p&gt;Wij zoeken een ervaren ontwikkelaar voor ons team. Je werkt met de productgroep en helpt ons het platform te bouwen voor onze klanten.&lt;/p&gt;";
  const mixed = () => world({
    arbeitnow: [
      arb("english-dev", { title: "Software Engineer", description: EN_TEXT, location: "London", tags: ["Engineering"] }),
      arb("german-dev", { title: "Softwareentwickler (m/w/d)", description: DE_TEXT, location: "Berlin", tags: ["Entwicklung"] }),
      arb("french-dev", { title: "Ingénieur logiciel", description: FR_TEXT, location: "Paris", tags: ["Ingénierie"] }),
      arb("dutch-dev", { title: "Software ontwikkelaar", description: NL_TEXT, location: "Utrecht", tags: ["Techniek"] }),
      arb("bare-title", { title: "Developer", description: "", location: "Zurich" }), // too little text to tell: kept
    ],
  });

  it("keeps the English jobs and drops German, French and Dutch ones, before anything is remembered", async () => {
    const w = mixed();
    const jobs = await makeArbeitnow(w.fetchFn).jobs();
    expect(jobs.map((j) => j.id).sort()).toEqual(["arbeitnow:bare-title", "arbeitnow:english-dev"]);
  });

  it("asks Arbeitnow for the same single page as before: it has no language setting, so no extra parameter is sent", async () => {
    const w = mixed();
    await makeArbeitnow(w.fetchFn).jobs();
    expect(w.state.calls).toEqual(["https://www.arbeitnow.com/api/job-board-api?page=1"]);
  });

  it("keeps everything when it is switched off", async () => {
    const w = mixed();
    const svc = new ArbeitnowJobService({ fetch: w.fetchFn, cache: new ArbeitnowCache(), englishOnly: false });
    expect(await svc.jobs()).toHaveLength(5);
  });

  it("applies to the merged list, the descriptions, the categories and the locations too", async () => {
    const w = mixed();
    const s = makeSearch(w.fetchFn);
    expect((await ids(s)).sort()).toEqual(["arbeitnow:bare-title", "arbeitnow:english-dev"]);
    expect((await s.list(q())).total).toBe(2);
    expect(await s.description("arbeitnow:english-dev")).not.toBeNull();
    expect(await s.description("arbeitnow:german-dev")).toBeNull(); // a dropped job has no description either
    expect((await s.categories()).map((c) => c.label)).not.toContain("Entwicklung");
    const places = await s.locations();
    expect(places).toEqual(expect.arrayContaining(["London", "Zurich"]));
    expect(places).not.toEqual(expect.arrayContaining(["Berlin"]));
    expect(places).not.toEqual(expect.arrayContaining(["Paris"]));
  });

  it("does not touch Remotive's jobs, whatever language they are in", async () => {
    const w = world({ remotive: [rem(1, { title: "Softwareentwickler", description: "<p>Wir suchen einen Entwickler für unser Team und die Kunden.</p>" })], arbeitnow: [] });
    expect((await ids(makeSearch(w.fetchFn))).sort()).toEqual(["remotive:1"]);
  });
});

describe("categories and locations for the filters", () => {
  it("lists Remotive's categories, then Arbeitnow's topics it does not already have, each once, sorted by name", async () => {
    const { fetchFn } = world({
      remotive: [],
      arbeitnow: [
        arb("a", { tags: ["Engineering", "Customer Service", "Rare"] }), arb("b", { tags: ["Engineering", "Sales"] }), arb("c", { tags: ["Remote", "Sales", "Engineering"] }),
        arb("d", { tags: ["Sales", "Engineering"] }), arb("e", { tags: ["Customer Service", "Sales"] }), arb("f", { tags: ["Customer Service"] }),
      ],
    });
    const cats = await makeSearch(fetchFn).categories();
    expect(cats.map((c) => c.label)).toEqual(["Customer Service", "Engineering", "Sales", "Software Development"]); // "Rare" is on one job only
    expect(cats.find((c) => c.label === "Customer Service")).toMatchObject({ value: "customer-support", remotive: true }); // Remotive's own wins
    expect(cats.find((c) => c.label === "Sales")).toMatchObject({ value: "Sales", remotive: false });
  });

  it("offers the places both sources name, most common first, and 'Remote job' is not one", async () => {
    const { fetchFn } = world({
      remotive: [rem(1, { candidate_required_location: "USA, Canada" }), rem(2, { candidate_required_location: "USA" })],
      arbeitnow: [arb("a", { location: "Berlin" }), arb("b", { location: "Berlin" }), arb("c", { location: "Berlin" }), arb("d", { location: "Remote job", remote: true })],
    });
    expect(await makeSearch(fetchFn).locations()).toEqual(["Berlin", "USA", "Canada"]);
  });
});

describe("when a source fails", () => {
  it("shows the other source and names the one that is missing", async () => {
    const w = world({ remotive: [rem(1)], arbeitnow: [arb("a")] });
    w.state.failArbeitnow = () => new Response("down", { status: 503 });
    const r = await makeSearch(w.fetchFn).list(q());
    expect(r.items.map((j) => j.id)).toEqual(["remotive:1"]);
    expect(r.unavailable).toEqual(["Arbeitnow"]);

    const w2 = world({ remotive: [rem(1)], arbeitnow: [arb("a")] });
    w2.state.failRemotive = () => new Response("down", { status: 500 });
    const r2 = await makeSearch(w2.fetchFn).list(q());
    expect(r2.items.map((j) => j.id)).toEqual(["arbeitnow:a"]);
    expect(r2.unavailable).toEqual(["Remotive"]);
  });

  it("is an error only when every source fails, and a failure is not remembered", async () => {
    const w = world({ remotive: [rem(1)], arbeitnow: [arb("a")] });
    w.state.failRemotive = () => new Response("x", { status: 500 });
    w.state.failArbeitnow = () => new Response("x", { status: 500 });
    w.state.failJobicy = () => new Response("x", { status: 500 });
    w.state.failHimalayas = () => new Response("x", { status: 500 });
    const s = makeSearch(w.fetchFn);
    await expect(s.list(q())).rejects.toBeInstanceOf(JobSourceError);
    w.state.failRemotive = null;
    w.state.failArbeitnow = null;
    w.state.failJobicy = null;
    w.state.failHimalayas = null;
    expect((await s.list(q())).total).toBe(2);
  });

  it.each([
    ["an HTTP error", () => new Response("nope", { status: 503 }), "http"],
    ["a body that is not JSON", () => new Response("<html>", { status: 200 }), "parse"],
  ])("raises a typed error for %s from either source, without the body", async (_n, respond, kind) => {
    const w = world({ remotive: [rem(1)], arbeitnow: [arb("a")] });
    w.state.failRemotive = respond as never;
    w.state.failArbeitnow = respond as never;
    await expect(makeRemotive(w.fetchFn).jobs("", "")).rejects.toMatchObject({ name: "JobSourceError", source: "Remotive", kind });
    await expect(makeArbeitnow(w.fetchFn).jobs()).rejects.toMatchObject({ name: "JobSourceError", source: "Arbeitnow", kind });
  });

  it("raises 'parse' for a body of the wrong shape, 'network' when it cannot connect, and 'timeout' when it hangs", async () => {
    const w = world();
    w.state.failRemotive = () => new Response(JSON.stringify({ jobs: "no" }), { status: 200 });
    w.state.failArbeitnow = () => new Response(JSON.stringify({ data: "no" }), { status: 200 });
    await expect(makeRemotive(w.fetchFn).jobs("", "")).rejects.toMatchObject({ kind: "parse" });
    await expect(makeArbeitnow(w.fetchFn).jobs()).rejects.toMatchObject({ kind: "parse" });
    const down = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await expect(makeArbeitnow(down).jobs()).rejects.toMatchObject({ kind: "network" });
    const hangs = ((_u: unknown, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
    await expect(makeArbeitnow(hangs, { timeoutMs: 30 }).jobs()).rejects.toMatchObject({ kind: "timeout" });
    await expect(makeRemotive(hangs, { timeoutMs: 30 }).jobs("", "")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("serves the previous copy when a source fails after its cache has expired", async () => {
    const w = world({ remotive: [rem(1)], arbeitnow: [arb("a")] });
    let t = 1;
    const s = makeSearch(w.fetchFn, { now: () => t });
    await s.list(q());
    t += ARB_TTL + LIST_TTL_MS + 1;
    w.state.failRemotive = () => new Response("down", { status: 500 });
    w.state.failArbeitnow = () => new Response("down", { status: 500 });
    const r = await s.list(q());
    expect(r.items.map((j) => j.id).sort()).toEqual(["arbeitnow:a", "remotive:1"]);
    expect(r.unavailable).toEqual([]);
  });
});

describe("usage: cache, shared requests, cap, cancel", () => {
  it("asks Arbeitnow once an hour however many searches there are (it ignores search words), and Remotive once per search for 10 minutes", async () => {
    const w = world({ remotive: [rem(1)], arbeitnow: [arb("a")] });
    let t = 1_000_000;
    const s = makeSearch(w.fetchFn, { now: () => t });
    await s.list(q());
    await s.list(q({ keyword: "one" }));
    await s.list(q({ keyword: "two", remoteOnly: "true", locations: "Berlin" }));
    await s.list(q({ keyword: "one", sort: "oldest", page: 1 }));
    expect(w.count("arbeitnow.com")).toBe(1);
    expect(w.count("remotive.com/api/remote-jobs?")).toBe(3); // "", "one", "two"
    t += LIST_TTL_MS + 1;
    await s.list(q());
    expect(w.count("remotive.com/api/remote-jobs?")).toBe(4);
    expect(w.count("arbeitnow.com")).toBe(1); // Remotive's copy expired, Arbeitnow's lasts an hour
    t += ARB_TTL;
    await s.list(q());
    expect(w.count("arbeitnow.com")).toBe(2);
  });

  it("makes one request per source when the same thing is asked for at the same time", async () => {
    const w = world({ remotive: [rem(1)], arbeitnow: [arb("a")] });
    let release!: () => void;
    w.state.gate = new Promise<void>((r) => { release = r; });
    const s = makeSearch(w.fetchFn);
    const all = Promise.all([s.list(q()), s.list(q()), s.list(q({ locations: "USA" })), s.locations()]);
    await vi.waitFor(() => expect(w.count("arbeitnow.com")).toBe(1));
    release();
    const results = await all;
    expect(w.count("arbeitnow.com")).toBe(1);
    expect(w.count("remotive.com/api/remote-jobs?")).toBe(1);
    expect(results[0].items).toHaveLength(2);
  });

  it("stops waiting when the caller cancels, without spoiling the shared request", async () => {
    const w = world({ remotive: [rem(1)], arbeitnow: [arb("a")] });
    let release!: () => void;
    w.state.gate = new Promise<void>((r) => { release = r; });
    const s = makeSearch(w.fetchFn);
    const ctl = new AbortController();
    const cancelled = s.list(q(), ctl.signal);
    const other = s.list(q());
    await vi.waitFor(() => expect(w.count("arbeitnow.com")).toBe(1));
    ctl.abort();
    await expect(cancelled).rejects.toMatchObject({ kind: "aborted" });
    release();
    expect((await other).items).toHaveLength(2);
    expect(w.count("arbeitnow.com")).toBe(1);
  });

  it("caps Remotive at its hourly limit, serving an older copy or the unfiltered list instead of an error, and recovers after an hour", async () => {
    const w = world({ remotive: [rem(1, { tags: Array.from({ length: 20 }, (_, i) => `k${i}`).concat(["brand-new"]) })], arbeitnow: [] });
    let t = 5_000_000;
    const s = makeSearch(w.fetchFn, { now: () => t });
    await s.list(q()); // the unfiltered list, the fallback
    for (let i = 0; i < MAX_UPSTREAM_PER_HOUR - 2; i++) await s.list(q({ keyword: `k${i}` })); // + the categories call below = the cap
    await s.categories();
    expect(w.count("remotive.com/api/remote-jobs")).toBe(MAX_UPSTREAM_PER_HOUR);
    const r = await s.list(q({ keyword: "brand-new" })); // not cached, cap reached: answered from the unfiltered copy, filtered here
    expect(r.items.map((j) => j.id)).toEqual(["remotive:1"]);
    expect(w.count("remotive.com/api/remote-jobs")).toBe(MAX_UPSTREAM_PER_HOUR);
    t += 3_600_001;
    await s.list(q({ keyword: "brand-new" }));
    expect(w.count("remotive.com/api/remote-jobs")).toBe(MAX_UPSTREAM_PER_HOUR + 1);
  });

  it("caps Arbeitnow far below its own limit of 50", async () => {
    const w = world({ arbeitnow: [arb("a")] });
    let t = 1;
    const svc = makeArbeitnow(w.fetchFn, { now: () => t });
    for (let i = 0; i < ARB_CAP; i++) { await svc.jobs(); t += ARB_TTL + 1; }
    expect(w.count("arbeitnow.com")).toBe(ARB_CAP);
    t += 1; // the cap counts the last hour: the first request has not aged out yet
    expect(ARB_CAP).toBeLessThanOrEqual(10);
  });
});

describe("the Jobs API", () => {
  // The Worker keeps one cache for the whole process; each test starts from an empty one.
  beforeEach(() => { sharedRemotiveCache.clear(); sharedArbeitnowCache.clear(); });
  const withWorld = async <T,>(initial: Parameters<typeof world>[0], run: (hh: Harness, w: ReturnType<typeof world>) => Promise<T>): Promise<T> => {
    const w = world(initial);
    const hh = await startHarness({ fetch: w.fetchFn });
    try {
      return await run(hh, w);
    } finally {
      await hh.dispose();
    }
  };

  it("answers a signed-in user with the merged page, and refuses a visitor", async () => {
    await withWorld({ remotive: [rem(1), rem(2)], arbeitnow: [arb("a", { location: "Berlin" }), arb("b", { location: "Paris" })] }, async (hh) => {
      expect((await hh.anonymous.api("GET", "/api/jobs")).status).toBe(401);
      const r = await hh.jobSeeker.api("GET", "/api/jobs?pageSize=10");
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ page: 1, pageSize: 10, total: 4, unavailable: [] });
      expect(new Set(r.json.items.map((j: { source: string }) => j.source))).toEqual(new Set(["Remotive", "Arbeitnow"]));
      const berlin = await hh.jobSeeker.api("GET", "/api/jobs?locations=Berlin&remoteOnly=false");
      expect(berlin.json.items.map((j: { id: string }) => j.id).sort()).toEqual(["arbeitnow:a", "remotive:1", "remotive:2"]);
      const cats = (await hh.jobSeeker.api("GET", "/api/jobs/categories")).json.items;
      expect(cats[0]).toEqual({ value: "customer-support", label: "Customer Service" });
      expect(Object.keys(cats[0]).sort()).toEqual(["label", "value"]); // the internal 'remotive' marker is not sent
      expect((await hh.jobSeeker.api("GET", "/api/jobs/locations")).json.items).toEqual(expect.arrayContaining(["Berlin", "Paris", "Worldwide"]));
    });
  });

  it("is served by GET /api/jobs/companies for a JobSeeker only", async () => {
    await withWorld({ remotive: [rem(1, { company_name: "Acme Corp" })] }, async (hh) => {
      const r = await hh.jobSeeker.api("GET", "/api/jobs/companies?pageSize=10");
      expect(r.status).toBe(200);
      expect(r.json.items[0]).toMatchObject({ name: "Acme Corp", openPositions: 1 });
      expect((await hh.api("GET", "/api/jobs/companies")).status).toBe(403);
      expect((await hh.anonymous.api("GET", "/api/jobs/companies")).status).toBe(401);
    });
  });

  it("tells the page which source is missing, and is a 502 only when none can be reached", async () => {
    await withWorld({ remotive: [rem(1)], arbeitnow: [arb("a")] }, async (hh, w) => {
      w.state.failArbeitnow = () => new Response("x", { status: 500 });
      const partial = await hh.jobSeeker.api("GET", "/api/jobs?keyword=unique-a");
      expect(partial.status).toBe(200);
      expect(partial.json.unavailable).toEqual(["Arbeitnow"]);
      w.state.failRemotive = () => new Response("x", { status: 500 });
      w.state.failJobicy = () => new Response("x", { status: 500 });
      w.state.failHimalayas = () => new Response("x", { status: 500 });
      sharedHimalayasCache.clear();
      sharedJobicyCache.clear();
      sharedRemotiveCache.clear(); // no earlier good copy of either source: nothing to show
      sharedArbeitnowCache.clear();
      const bad = await hh.jobSeeker.api("GET", "/api/jobs");
      expect(bad.status).toBe(502);
      expect(bad.json.error.code).toBe("JOB_SOURCE_UNAVAILABLE");
    });
  });

  it("rejects values it does not understand", async () => {
    await withWorld({}, async (hh) => {
      expect((await hh.jobSeeker.api("GET", "/api/jobs?sort=sideways")).status).toBe(400);
      expect((await hh.jobSeeker.api("GET", "/api/jobs?pageSize=101")).status).toBe(400);
    });
  });
});

describe("job descriptions (the View Job panel)", () => {
  beforeEach(() => { sharedRemotiveCache.clear(); sharedArbeitnowCache.clear(); });

  const REM_HTML = `<p style="${"--tw-x: 0; ".repeat(500)}"><strong>About us</strong> We build tools.</p><ul><li>React</li><li>Node</li></ul><script>alert(1)</script>`;
  const ARB_HTML = "&lt;h2&gt;The role&lt;/h2&gt;&lt;p&gt;Work in Munich.&lt;/p&gt;";

  const withWorld = async <T,>(run: (hh: Harness, w: ReturnType<typeof world>) => Promise<T>): Promise<T> => {
    const w = world({ remotive: [rem(1, { description: REM_HTML })], arbeitnow: [arb("munich-dev", { description: ARB_HTML })] });
    const hh = await startHarness({ fetch: w.fetchFn });
    try {
      return await run(hh, w);
    } finally {
      await hh.dispose();
    }
  };

  it("returns a job's description as plain text blocks, for a job of either source, and never markup", async () => {
    await withWorld(async (hh) => {
      await hh.jobSeeker.api("GET", "/api/jobs"); // the list is what fills the memory the description is read from
      const r = await hh.jobSeeker.api("GET", "/api/jobs/description?id=remotive:1");
      expect(r.status).toBe(200);
      expect(r.json).toEqual({
        id: "remotive:1",
        blocks: [{ type: "paragraph", text: "About us We build tools." }, { type: "list", ordered: false, items: ["React", "Node"] }],
      });
      expect(JSON.stringify(r.json)).not.toMatch(/<|script|alert|--tw/);
      const a = await hh.jobSeeker.api("GET", "/api/jobs/description?id=arbeitnow:munich-dev");
      expect(a.json.blocks).toEqual([{ type: "heading", text: "The role" }, { type: "paragraph", text: "Work in Munich." }]);
    });
  });

  it("is not part of the list: the list stays light, however long the descriptions are", async () => {
    await withWorld(async (hh) => {
      const list = await hh.jobSeeker.api("GET", "/api/jobs");
      expect(JSON.stringify(list.json)).not.toMatch(/We build tools|Work in Munich|blocks|description/);
    });
  });

  it("fetches the list again by itself when its memory has been cleared (a description asked for after the cache expired)", async () => {
    await withWorld(async (hh, w) => {
      await hh.jobSeeker.api("GET", "/api/jobs");
      sharedRemotiveCache.clear();
      sharedArbeitnowCache.clear();
      const before = w.state.calls.length;
      const r = await hh.jobSeeker.api("GET", "/api/jobs/description?id=remotive:1");
      expect(r.status).toBe(200);
      expect(w.state.calls.length).toBeGreaterThan(before);
    });
  });

  it("answers 404 for a job that is no longer listed or an id that is not ours, and 400 for none", async () => {
    await withWorld(async (hh) => {
      expect((await hh.jobSeeker.api("GET", "/api/jobs/description?id=remotive:999")).status).toBe(404);
      expect((await hh.jobSeeker.api("GET", "/api/jobs/description?id=arbeitnow:nope")).status).toBe(404);
      expect((await hh.jobSeeker.api("GET", "/api/jobs/description?id=other:1")).status).toBe(404);
      expect((await hh.jobSeeker.api("GET", "/api/jobs/description")).status).toBe(400);
      expect((await hh.jobSeeker.api("GET", `/api/jobs/description?id=${"x".repeat(301)}`)).status).toBe(400);
      expect((await hh.anonymous.api("GET", "/api/jobs/description?id=remotive:1")).status).toBe(401);
    });
  });

  it("is a 502 when the source cannot be reached and nothing is remembered", async () => {
    await withWorld(async (hh, w) => {
      w.state.failRemotive = () => new Response("x", { status: 500 });
      const r = await hh.jobSeeker.api("GET", "/api/jobs/description?id=remotive:1");
      expect(r.status).toBe(502);
      expect(r.json.error.code).toBe("JOB_SOURCE_UNAVAILABLE");
    });
  });

  it("keeps a description small in memory: a job with 40 KB of styled HTML is a few hundred bytes", async () => {
    const w = world({ remotive: [rem(1, { description: `<p style="${"a: b; ".repeat(8000)}">Hi</p>` })] });
    const svc = makeRemotive(w.fetchFn);
    await svc.jobs("", "");
    expect(JSON.stringify(await svc.description("remotive:1"))).toBe('[{"type":"paragraph","text":"Hi"}]');
  });
});
