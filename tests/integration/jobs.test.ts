import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jobListQuery } from "../../src/shared/schemas";
import { JobCache, MAX_UPSTREAM_PER_HOUR, RemotiveError, RemotiveJobService, isOpenToAnyone, mapRemotiveJob, matchesLocation, LIST_TTL_MS } from "../../src/server/services/remotive-jobs";
import { startHarness, type Harness } from "./harness";

/** A job as Remotive's API sends it. */
const remote = (id: number, over: Record<string, unknown> = {}) => ({
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

/** A stand-in for Remotive: records every request URL, answers with `jobs` (or what `respond` returns), and can be held back. */
function fakeRemotive(initial: unknown[] = []) {
  const state = {
    jobs: initial as unknown[],
    categories: [{ id: 1, name: "Software Development", slug: "software-dev" }, { id: 2, name: "Customer Service", slug: "customer-support" }],
    calls: [] as string[],
    respond: null as null | (() => Response | Promise<Response>),
    gate: null as null | Promise<void>,
  };
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    state.calls.push(url);
    if (state.gate) await state.gate;
    if (state.respond) return state.respond();
    const body = url.includes("/categories") ? { jobs: state.categories } : { "job-count": state.jobs.length, jobs: state.jobs };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { state, fetchFn };
}

/** A service with a cache of its own, so tests never share what they remembered. */
const make = (fetchFn: typeof fetch, extra: { now?: () => number; timeoutMs?: number; cache?: JobCache } = {}) =>
  new RemotiveJobService({ fetch: fetchFn, cache: extra.cache ?? new JobCache(), ...(extra.now ? { now: extra.now } : {}), ...(extra.timeoutMs ? { timeoutMs: extra.timeoutMs } : {}) });
const q = (o: Record<string, unknown> = {}) => jobListQuery.parse(o);

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
    const tables = (await h.rows<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((t) => t.table_name);
    expect(tables.filter((t) => /job/.test(t))).toEqual([]);
    const { fetchFn } = fakeRemotive([remote(1)]);
    await make(fetchFn).list(q());
    const after = (await h.rows<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((t) => t.table_name);
    expect(after).toEqual(tables);
  });
});

describe("mapping Remotive's job into the app's JobDto", () => {
  it("maps every field, reads the time as UTC, and names the employment type as people read it", () => {
    expect(mapRemotiveJob(remote(7) as never)).toEqual({
      id: "7", title: "Job 7", companyName: "Acme Corp", companyLogo: "https://remotive.com/job/7/logo", category: "Software Development", employmentType: "Full-time",
      location: "Worldwide", salary: "$3,000-$5,000", skills: ["react", "node"], url: "https://remotive.com/remote-jobs/software-dev/job-7", source: "Remotive",
      publishedAt: "2026-11-19T14:58:42.000Z",
    });
    expect(mapRemotiveJob(remote(8, { job_type: "part_time" }) as never).employmentType).toBe("Part-time");
    expect(mapRemotiveJob(remote(9, { job_type: "some_new_type" }) as never).employmentType).toBe("some new type");
  });

  it("copes with missing logo, salary, location and date, and validates the apply link and the picture", () => {
    expect(mapRemotiveJob({ id: "x1", title: "T" } as never)).toMatchObject({ id: "x1", companyName: "", companyLogo: "", salary: "", location: "", skills: [], publishedAt: null, url: "" });
    expect(mapRemotiveJob(remote(11, { url: "javascript:alert(1)", company_logo: "http://insecure.example/x.png" }) as never)).toMatchObject({ url: "", companyLogo: "" });
    expect(mapRemotiveJob(remote(12, { url: "https://evil.example/remotive.com" }) as never).url).toBe("");
    expect(mapRemotiveJob(remote(13, { url: "http://remotive.com/x" }) as never).url).toBe(""); // not https
  });
});

describe("the live request to Remotive", () => {
  it("asks for 50 jobs on the first load, and passes keyword and category as search and category", async () => {
    const { state, fetchFn } = fakeRemotive([remote(1)]);
    const svc = make(fetchFn);
    await svc.list(q());
    expect(state.calls).toEqual(["https://remotive.com/api/remote-jobs?limit=50"]);
    await svc.list(q({ keyword: "react dev", category: "software-dev" }));
    const u = new URL(state.calls[1]!);
    expect(Object.fromEntries(u.searchParams)).toEqual({ limit: "50", search: "react dev", category: "software-dev" });
  });

  it("applies the location filter itself (a worldwide job suits any place), and Remote only keeps jobs open to anyone", async () => {
    const { fetchFn } = fakeRemotive([
      remote(1, { candidate_required_location: "USA, Canada" }),
      remote(2, { candidate_required_location: "Europe" }),
      remote(3, { candidate_required_location: "Worldwide" }),
      remote(4, { candidate_required_location: "" }),
    ]);
    const svc = make(fetchFn);
    const ids = async (o: Record<string, unknown>) => (await svc.list(q(o))).items.map((j) => j.id).sort();
    expect(await ids({})).toEqual(["1", "2", "3", "4"]);
    expect(await ids({ locations: "Canada" })).toEqual(["1", "3", "4"]);
    expect(await ids({ locations: "europe,usa" })).toEqual(["1", "2", "3", "4"]);
    expect(await ids({ remoteOnly: "true" })).toEqual(["3", "4"]);
    expect(await ids({ remoteOnly: "true", locations: "Canada" })).toEqual(["3", "4"]);
    expect(isOpenToAnyone("Anywhere in the world")).toBe(true);
    expect(isOpenToAnyone("USA only")).toBe(false);
    expect(matchesLocation(mapRemotiveJob(remote(5, { candidate_required_location: "LATAM, Europe" }) as never), ["latam"])).toBe(true);
  });

  it("sorts by publication date, newest first by default, oldest on request, undated jobs last, and pages the result", async () => {
    const { fetchFn } = fakeRemotive([
      remote(1, { publication_date: "2026-11-01T00:00:00" }),
      remote(2, { publication_date: "2026-11-20T00:00:00" }),
      remote(3, { publication_date: null }),
      remote(4, { publication_date: "2026-11-10T00:00:00" }),
    ]);
    const svc = make(fetchFn);
    expect((await svc.list(q())).items.map((j) => j.id)).toEqual(["2", "4", "1", "3"]);
    expect((await svc.list(q({ sort: "oldest" }))).items.map((j) => j.id)).toEqual(["1", "4", "2", "3"]);
    const p2 = await svc.list(q({ pageSize: 3, page: 2 }));
    expect(p2).toMatchObject({ total: 4, page: 2, pageSize: 3 });
    expect(p2.items.map((j) => j.id)).toEqual(["3"]);
  });

  it("keeps a job Remotive lists twice once, skips one without a title or of the wrong shape", async () => {
    const { fetchFn } = fakeRemotive([remote(1), remote(1, { title: "Dup" }), remote(2, { title: "" }), { nonsense: true }, "text", null, remote(3)]);
    const r = await make(fetchFn).list(q());
    expect(r.items.map((j) => j.id).sort()).toEqual(["1", "3"]);
    expect(r.items.find((j) => j.id === "1")!.title).toBe("Job 1");
  });

  it("never includes the description in what it returns", async () => {
    const { fetchFn } = fakeRemotive([remote(1)]);
    expect(JSON.stringify(await make(fetchFn).list(q()))).not.toContain("Hello");
  });
});

describe("keyword and category are also checked here", () => {
  it("filters by keyword (every word, in the title, company, category or skills, any case), because Remotive's public feed may ignore it", async () => {
    const { fetchFn } = fakeRemotive([
      remote(1, { title: "Senior .NET Developer", tags: ["c#", "azure"] }),
      remote(2, { title: "UI/UX Designer", company_name: "Beta LLC", tags: ["figma"], category: "Design" }),
      remote(3, { title: "Support Agent", company_name: "Acme Corp", tags: ["zendesk"], category: "Customer Service" }),
    ]);
    const svc = make(fetchFn);
    const ids = async (o: Record<string, unknown>) => (await svc.list(q(o))).items.map((j) => j.id).sort();
    expect(await ids({ keyword: ".net" })).toEqual(["1"]);
    expect(await ids({ keyword: "FIGMA" })).toEqual(["2"]);
    expect(await ids({ keyword: "beta" })).toEqual(["2"]);
    expect(await ids({ keyword: "acme corp" })).toEqual(["1", "3"]);
    expect(await ids({ keyword: "acme zendesk" })).toEqual(["3"]); // every word must match
    expect(await ids({ keyword: "customer service" })).toEqual(["3"]);
    expect(await ids({ keyword: "zzzz" })).toEqual([]);
  });

  it("filters by category, accepting Remotive's slug or the name it belongs to", async () => {
    const { fetchFn } = fakeRemotive([remote(1, { category: "Software Development" }), remote(2, { category: "Customer Service" }), remote(3, { category: "Design" })]);
    const svc = make(fetchFn);
    const ids = async (c: string) => (await svc.list(q({ category: c }))).items.map((j) => j.id);
    expect(await ids("software-dev")).toEqual(["1"]); // slug -> "Software Development" through Remotive's own category list
    expect(await ids("customer-support")).toEqual(["2"]);
    expect(await ids("design")).toEqual(["3"]); // a slug that is also the name
  });
});

describe("usage: cache, shared requests, cap, timeout", () => {
  it("serves the same search from memory for a few minutes, then asks again", async () => {
    const { state, fetchFn } = fakeRemotive([remote(1)]);
    let t = 1_000_000;
    const svc = make(fetchFn, { now: () => t });
    await svc.list(q());
    await svc.list(q({ page: 1, sort: "oldest", locations: "USA" })); // same search: other filters are applied here, not asked of Remotive
    expect(state.calls).toHaveLength(1);
    await svc.list(q({ keyword: "other" }));
    expect(state.calls).toHaveLength(2);
    t += LIST_TTL_MS + 1;
    await svc.list(q());
    expect(state.calls).toHaveLength(3);
  });

  it("makes one request when the same search is asked for at the same time", async () => {
    const { state, fetchFn } = fakeRemotive([remote(1)]);
    let release!: () => void;
    state.gate = new Promise<void>((r) => { release = r; });
    const svc = make(fetchFn);
    const all = Promise.all([svc.list(q()), svc.list(q()), svc.list(q({ locations: "USA" })), svc.locations()]);
    await vi.waitFor(() => expect(state.calls).toHaveLength(1));
    release();
    const results = await all;
    expect(state.calls).toHaveLength(1);
    expect(results[0].items).toHaveLength(1);
  });

  it("stops waiting when the caller cancels, without spoiling the shared request", async () => {
    const { state, fetchFn } = fakeRemotive([remote(1)]);
    let release!: () => void;
    state.gate = new Promise<void>((r) => { release = r; });
    const svc = make(fetchFn);
    const ctl = new AbortController();
    const cancelled = svc.list(q(), ctl.signal);
    const other = svc.list(q());
    await vi.waitFor(() => expect(state.calls).toHaveLength(1));
    ctl.abort();
    await expect(cancelled).rejects.toMatchObject({ kind: "aborted" });
    release();
    expect((await other).items).toHaveLength(1);
    expect(state.calls).toHaveLength(1);
  });

  it("caps the requests to Remotive per hour, serving an older copy when it has one and refusing when it has none", async () => {
    const { state, fetchFn } = fakeRemotive([remote(1, { tags: Array.from({ length: 20 }, (_, i) => `k${i}`).concat(["brand-new"]) })]);
    let t = 5_000_000;
    const svc = make(fetchFn, { now: () => t });
    for (let i = 0; i < MAX_UPSTREAM_PER_HOUR; i++) await svc.list(q({ keyword: `k${i}` }));
    expect(state.calls).toHaveLength(MAX_UPSTREAM_PER_HOUR);
    await expect(svc.list(q({ keyword: "brand-new" }))).rejects.toMatchObject({ kind: "rate_limit" });
    expect(state.calls).toHaveLength(MAX_UPSTREAM_PER_HOUR);
    t += LIST_TTL_MS + 1; // k0 is now old; the cap still holds, so the old copy is served instead of an error
    expect((await svc.list(q({ keyword: "k0" }))).items).toHaveLength(1);
    expect(state.calls).toHaveLength(MAX_UPSTREAM_PER_HOUR);
    t += 3_600_000; // an hour later the cap has room again
    await svc.list(q({ keyword: "brand-new" }));
    expect(state.calls).toHaveLength(MAX_UPSTREAM_PER_HOUR + 1);
  });

  it.each([
    ["an HTTP error", () => new Response("nope", { status: 503 }), "http"],
    ["a body that is not JSON", () => new Response("<html>", { status: 200 }), "parse"],
    ["a body of the wrong shape", () => new Response(JSON.stringify({ jobs: "no" }), { status: 200 }), "parse"],
  ])("raises a RemotiveError for %s, and a failure is not remembered", async (_n, respond, kind) => {
    const { state, fetchFn } = fakeRemotive([remote(1)]);
    state.respond = respond as never;
    const svc = make(fetchFn);
    await expect(svc.list(q())).rejects.toMatchObject({ name: "RemotiveError", kind });
    state.respond = null;
    expect((await svc.list(q())).items).toHaveLength(1); // the next try asks again
  });

  it("serves the previous copy when Remotive fails after its cache has expired", async () => {
    const { state, fetchFn } = fakeRemotive([remote(1)]);
    let t = 1;
    const svc = make(fetchFn, { now: () => t });
    await svc.list(q());
    t += LIST_TTL_MS + 1;
    state.respond = () => new Response("down", { status: 500 });
    expect((await svc.list(q())).items.map((j) => j.id)).toEqual(["1"]);
  });

  it("reports a network failure and a timeout as such", async () => {
    await expect(make((async () => { throw new TypeError("fetch failed"); }) as typeof fetch).list(q())).rejects.toMatchObject({ kind: "network" });
    const hangs = ((_u: unknown, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
    const err = await make(hangs, { timeoutMs: 30 }).list(q()).catch((e) => e);
    expect(err).toBeInstanceOf(RemotiveError);
    expect(err.kind).toBe("timeout");
  });
});

describe("categories and locations for the filters", () => {
  it("takes the categories from Remotive's own list (value to send, name to read), sorted, and keeps them a day", async () => {
    const { state, fetchFn } = fakeRemotive();
    const svc = make(fetchFn);
    expect(await svc.categories()).toEqual([{ value: "customer-support", label: "Customer Service" }, { value: "software-dev", label: "Software Development" }]);
    await svc.categories();
    expect(state.calls).toEqual(["https://remotive.com/api/remote-jobs/categories"]);
  });

  it("offers the places the jobs name, most common first", async () => {
    const { fetchFn } = fakeRemotive([
      remote(1, { candidate_required_location: "USA, Canada" }), remote(2, { candidate_required_location: "USA" }), remote(3, { candidate_required_location: "Worldwide" }),
    ]);
    expect(await make(fetchFn).locations()).toEqual(["USA", "Canada", "Worldwide"]);
  });
});

describe("the Jobs API", () => {
  const withFake = async <T,>(jobs: unknown[], run: (hh: Harness, fake: ReturnType<typeof fakeRemotive>) => Promise<T>): Promise<T> => {
    const fake = fakeRemotive(jobs);
    const hh = await startHarness({ fetch: fake.fetchFn });
    try {
      return await run(hh, fake);
    } finally {
      await hh.dispose();
    }
  };

  it("answers a signed-in user with a page of live jobs and the filters applied, and refuses a visitor", async () => {
    await withFake([remote(1, { candidate_required_location: "USA" }), remote(2, { candidate_required_location: "Europe" }), remote(3)], async (hh, { state }) => {
      expect((await hh.anonymous.api("GET", "/api/jobs")).status).toBe(401);
      const r = await hh.api("GET", "/api/jobs?locations=Europe&pageSize=10");
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ page: 1, pageSize: 10, total: 2 });
      expect(r.json.items.map((j: { id: string }) => j.id).sort()).toEqual(["2", "3"]);
      expect(state.calls.length).toBeGreaterThan(0);
      expect((await hh.api("GET", "/api/jobs/categories")).json.items[0]).toEqual({ value: "customer-support", label: "Customer Service" });
      expect((await hh.api("GET", "/api/jobs/locations")).status).toBe(200);
    });
  });

  it("rejects values it does not understand", async () => {
    await withFake([], async (hh) => {
      expect((await hh.api("GET", "/api/jobs?sort=sideways")).status).toBe(400);
      expect((await hh.api("GET", "/api/jobs?pageSize=101")).status).toBe(400);
    });
  });

  it("turns a Remotive failure into a 502 / 504 with a code the page can show, not a crash", async () => {
    await withFake([], async (hh, { state }) => {
      state.respond = () => new Response("x", { status: 500 });
      // a keyword no earlier test used, so the answer cannot come from the shared cache
      const bad = await hh.api("GET", `/api/jobs?keyword=failure-${Math.random().toString(36).slice(2)}`);
      expect(bad.status).toBe(502);
      expect(bad.json.error.code).toBe("JOB_SOURCE_UNAVAILABLE");
    });
  });
});
