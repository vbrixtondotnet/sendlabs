import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPER_ADMINISTRATOR } from "../../src/shared/types";
import { hashPassword } from "../../src/server/lib/password";
import { RemotiveError, RemotiveJobService, mapRemotiveJob } from "../../src/server/services/remotive-jobs";
import { startHarness, type Harness } from "./harness";

let h: Harness;

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

/** A stand-in for Remotive: records every request, answers with `jobs` (or whatever `respond` returns). */
function fakeRemotive(initial: unknown[] = []) {
  const state = { jobs: initial, calls: [] as string[], respond: null as null | (() => Response | Promise<Response>) };
  const fetchFn = (async (input: string | URL | Request) => {
    state.calls.push(String(input));
    if (state.respond) return state.respond();
    return new Response(JSON.stringify({ "job-count": state.jobs.length, jobs: state.jobs }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { state, fetchFn };
}

const service = (fetchFn: typeof fetch, now?: () => number) => new RemotiveJobService({ db: h.db, fetch: fetchFn, ...(now ? { now } : {}) });
const count = async (where = "1=1") => (await h.rows<{ n: number }>(`SELECT count(*)::int AS n FROM global_jobs WHERE ${where}`))[0]!.n;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => { await h.dispose(); });
beforeEach(async () => {
  await h.sql("DELETE FROM global_jobs");
  await h.sql("DELETE FROM job_sources");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("mapping Remotive's job into ours", () => {
  it("maps every field, reads the time as UTC, and names the employment type as people read it", () => {
    const m = mapRemotiveJob(remote(7) as never);
    expect(m).toMatchObject({
      externalJobId: "7", jobTitle: "Job 7", companyName: "Acme Corp", companyLogo: "https://remotive.com/job/7/logo", category: "Software Development",
      employmentType: "Full-time", location: "Worldwide", salary: "$3,000-$5,000", tags: ["react", "node"], description: "<p>Hello</p>",
      jobUrl: "https://remotive.com/remote-jobs/software-dev/job-7", publishedAt: Date.UTC(2026, 10, 19, 14, 58, 42),
    });
    expect(mapRemotiveJob(remote(8, { job_type: "part_time" }) as never).employmentType).toBe("Part-time");
    expect(mapRemotiveJob(remote(9, { job_type: "freelance" }) as never).employmentType).toBe("Freelance");
    expect(mapRemotiveJob(remote(10, { job_type: "some_new_type" }) as never).employmentType).toBe("some new type");
  });

  it("copes with missing fields, and keeps an unsafe link or picture out", () => {
    const m = mapRemotiveJob({ id: "x1", title: "T" } as never);
    expect(m).toMatchObject({ externalJobId: "x1", companyName: "", companyLogo: "", salary: "", tags: [], publishedAt: null, jobUrl: "" });
    const bad = mapRemotiveJob(remote(11, { url: "javascript:alert(1)", company_logo: "http://insecure.example/x.png" }) as never);
    expect(bad.jobUrl).toBe("");
    expect(bad.companyLogo).toBe("");
    expect(mapRemotiveJob(remote(12, { url: "https://evil.example/remotive.com" }) as never).jobUrl).toBe(""); // not on remotive.com: no link back to offer
  });
});

describe("RemotiveJobService.sync", () => {
  it("asks Remotive's documented endpoint, stores the jobs, and registers the source", async () => {
    const { state, fetchFn } = fakeRemotive([remote(1), remote(2), remote(3)]);
    const r = await service(fetchFn).sync();
    expect(r).toEqual({ source: "Remotive", fetched: 3, created: 3, updated: 0, deactivated: 0 });
    expect(state.calls).toEqual(["https://remotive.com/api/remote-jobs"]);
    expect(await count()).toBe(3);
    const [src] = await h.rows<{ name: string; source_type: string; api_endpoint: string; is_active: boolean; last_synced_at: number }>("SELECT * FROM job_sources");
    expect(src).toMatchObject({ name: "Remotive", source_type: "api", api_endpoint: "https://remotive.com/api/remote-jobs", is_active: true });
    expect(src!.last_synced_at).toBeGreaterThan(0);
  });

  it("passes the documented parameters (search, category, company_name, limit) through", async () => {
    const { state, fetchFn } = fakeRemotive([]);
    await service(fetchFn).fetchJobs({ search: "react dev", category: "Software Development", companyName: "Acme Corp", limit: 5 });
    const u = new URL(state.calls[0]!);
    expect(Object.fromEntries(u.searchParams)).toEqual({ search: "react dev", category: "Software Development", company_name: "Acme Corp", limit: "5" });
  });

  it("never duplicates: running it again updates the same rows, and picks up changes", async () => {
    const { state, fetchFn } = fakeRemotive([remote(1), remote(2)]);
    await service(fetchFn).sync();
    state.jobs = [remote(1, { title: "Renamed", salary: "$9" }), remote(2)];
    const again = await service(fetchFn).sync();
    expect(again).toMatchObject({ fetched: 2, created: 0, updated: 2 });
    expect(await count()).toBe(2);
    expect((await h.rows<{ job_title: string; salary: string }>("SELECT job_title, salary FROM global_jobs WHERE external_job_id = '1'"))[0]).toEqual({ job_title: "Renamed", salary: "$9" });
    expect((await h.rows("SELECT id FROM job_sources")).length).toBe(1);
  });

  it("keeps a job that Remotive lists twice once, and skips one that has no title", async () => {
    const { fetchFn } = fakeRemotive([remote(1), remote(1, { title: "Dup" }), remote(2, { title: "" }), remote(3)]);
    const r = await service(fetchFn).sync();
    expect(r.fetched).toBe(2);
    expect((await h.rows<{ job_title: string }>("SELECT job_title FROM global_jobs WHERE external_job_id = '1'"))[0]!.job_title).toBe("Job 1");
  });

  it("closes the jobs Remotive stops listing (they are kept, but no longer shown), and reopens one that comes back", async () => {
    const { state, fetchFn } = fakeRemotive([remote(1), remote(2), remote(3)]);
    await service(fetchFn).sync();
    state.jobs = [remote(1)];
    expect((await service(fetchFn).sync()).deactivated).toBe(2);
    expect(await count("is_active")).toBe(1);
    expect(await count()).toBe(3);
    state.jobs = [remote(1), remote(2)];
    await service(fetchFn).sync();
    expect(await count("is_active")).toBe(2);
  });

  it("does not close anything on an empty answer or a filtered slice", async () => {
    const { state, fetchFn } = fakeRemotive([remote(1), remote(2)]);
    await service(fetchFn).sync();
    state.jobs = [];
    expect((await service(fetchFn).sync()).deactivated).toBe(0);
    state.jobs = [remote(1)];
    expect((await service(fetchFn).sync({ search: "x" })).deactivated).toBe(0);
    expect(await count("is_active")).toBe(2);
  });

  it("ignores a job of the wrong shape without losing the rest", async () => {
    const { fetchFn } = fakeRemotive([remote(1), { nonsense: true }, "text", null, remote(2)]);
    expect((await service(fetchFn).sync()).fetched).toBe(2);
  });
});

describe("errors and timeouts", () => {
  it.each([
    ["an HTTP error", () => new Response("nope", { status: 503 }), "http"],
    ["a body that is not JSON", () => new Response("<html>", { status: 200 }), "parse"],
    ["a body of the wrong shape", () => new Response(JSON.stringify({ jobs: "no" }), { status: 200 }), "parse"],
  ])("raises a RemotiveError for %s, stores nothing, logs without the body", async (_name, respond, kind) => {
    const { state, fetchFn } = fakeRemotive();
    state.respond = respond as never;
    await expect(service(fetchFn).sync()).rejects.toMatchObject({ name: "RemotiveError", kind });
    expect(await count()).toBe(0);
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("jobs_sync_failed");
    expect(logged).not.toContain("<html>");
  });

  it("reports a network failure and a timeout as such", async () => {
    const network = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await expect(service(network).sync()).rejects.toMatchObject({ kind: "network" });
    const hangs = ((_u: unknown, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
    const svc = new RemotiveJobService({ db: h.db, fetch: hangs, timeoutMs: 30 });
    const err = await svc.sync().catch((e) => e);
    expect(err).toBeInstanceOf(RemotiveError);
    expect(err.kind).toBe("timeout");
  });
});

describe("the schedule", () => {
  it("syncs when due, then waits: not again within the interval, even after a failure", async () => {
    const { state, fetchFn } = fakeRemotive([remote(1)]);
    let t = 1_000_000;
    const svc = service(fetchFn, () => t);
    expect(await svc.syncIfDue(1000)).toMatchObject({ fetched: 1 });
    t += 500;
    expect(await svc.syncIfDue(1000)).toBeNull();
    expect(state.calls).toHaveLength(1);
    t += 600;
    state.respond = () => new Response("x", { status: 500 });
    await expect(svc.syncIfDue(1000)).rejects.toBeInstanceOf(RemotiveError);
    t += 100; // a failed try still counts: do not hammer a source that is down
    expect(await svc.syncIfDue(1000)).toBeNull();
    expect(state.calls).toHaveLength(2);
    t += 1000;
    state.respond = null;
    expect(await svc.syncIfDue(1000)).toMatchObject({ fetched: 1 });
  });

  it("does nothing for a source that is switched off", async () => {
    const { state, fetchFn } = fakeRemotive([remote(1)]);
    await service(fetchFn).sync();
    await h.sql("UPDATE job_sources SET is_active = false, last_attempt_at = 0, last_synced_at = 0");
    expect(await service(fetchFn).syncIfDue(1)).toBeNull();
    expect(state.calls).toHaveLength(1);
  });
});

describe("the Jobs API (reads our table, never Remotive)", () => {
  const seed = async () => {
    const { fetchFn } = fakeRemotive([
      ...Array.from({ length: 30 }, (_, i) => remote(100 + i, { title: `Filler ${i}`, company_name: "Filler Inc", category: "Marketing", candidate_required_location: "Europe", publication_date: `2026-10-${String(1 + (i % 20)).padStart(2, "0")}T10:00:00`, tags: ["seo"] })),
      remote(1, { title: "Senior .NET Developer", company_name: "Acme Corp", category: "Software Development", candidate_required_location: "Worldwide", tags: ["c#", ".net 8", "azure"], publication_date: "2026-11-20T10:00:00" }),
      remote(2, { title: "UI/UX Designer", company_name: "Acme Corp", category: "Design", candidate_required_location: "USA", tags: ["figma"], job_type: "contract", publication_date: "2026-11-19T10:00:00" }),
      remote(3, { title: "Support Agent", company_name: "Beta LLC", category: "Customer Service", candidate_required_location: "Worldwide", tags: ["zendesk"], publication_date: "2026-11-18T10:00:00" }),
    ]);
    await service(fetchFn).sync();
  };
  type J = { id: string; title: string; companyName: string; category: string; location: string; employmentType: string; skills: string[]; url: string; source: string; publishedAt: string | null };

  it("lists jobs newest first with what the cards need, and never the description", async () => {
    await seed();
    const r = await h.api("GET", "/api/jobs?pageSize=3");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ page: 1, pageSize: 3, total: 33 });
    expect(r.json.items.map((j: J) => j.title)).toEqual(["Senior .NET Developer", "UI/UX Designer", "Support Agent"]);
    expect(r.json.items[0]).toEqual({
      id: expect.any(String), title: "Senior .NET Developer", companyName: "Acme Corp", companyLogo: "https://remotive.com/job/1/logo", category: "Software Development",
      employmentType: "Full-time", location: "Worldwide", salary: "$3,000-$5,000", skills: ["c#", ".net 8", "azure"], url: "https://remotive.com/remote-jobs/software-dev/job-1",
      source: "Remotive", publishedAt: "2026-11-20T10:00:00.000Z",
    });
    expect(JSON.stringify(r.json)).not.toContain("Hello");
  });

  it("pages on the server without repeating or skipping a job", async () => {
    await seed();
    const seen: string[] = [];
    for (const page of [1, 2, 3]) seen.push(...(await h.api("GET", `/api/jobs?pageSize=12&page=${page}`)).json.items.map((j: J) => j.id));
    expect(new Set(seen).size).toBe(33);
    expect((await h.api("GET", "/api/jobs?pageSize=12&page=4")).json).toMatchObject({ total: 33, items: [] });
    expect((await h.api("GET", "/api/jobs?pageSize=101")).status).toBe(400);
  });

  it("filters by keyword (title, company or skill, any case), category and location, and combines them", async () => {
    await seed();
    const titles = async (qs: string) => (await h.api("GET", `/api/jobs?${qs}`)).json.items.map((j: J) => j.title).sort();
    expect(await titles("keyword=.NET")).toEqual(["Senior .NET Developer"]);
    expect(await titles("keyword=FIGMA")).toEqual(["UI/UX Designer"]);
    expect(await titles("keyword=beta")).toEqual(["Support Agent"]);
    expect(await titles("categories=Design,Customer Service")).toEqual(["Support Agent", "UI/UX Designer"]);
    expect(await titles("locations=USA")).toEqual(["UI/UX Designer"]);
    expect(await titles("categories=Software Development&locations=Worldwide&keyword=azure")).toEqual(["Senior .NET Developer"]);
    expect(await titles("keyword=%25")).toEqual([]); // a % is a plain character, not a wildcard
    expect((await h.api("GET", "/api/jobs?keyword=zzzz")).json).toMatchObject({ total: 0, items: [] });
  });

  it("offers categories, locations and hiring companies for the filters and the panel", async () => {
    await seed();
    expect((await h.api("GET", "/api/jobs/categories")).json.items).toEqual(["Customer Service", "Design", "Marketing", "Software Development"]);
    expect((await h.api("GET", "/api/jobs/locations")).json.items).toEqual(["Europe", "USA", "Worldwide"]);
    const companies = (await h.api("GET", "/api/jobs/companies")).json.items;
    expect(companies[0]).toMatchObject({ name: "Filler Inc", openPositions: 30, category: "Marketing" });
    expect(companies.find((c: { name: string }) => c.name === "Acme Corp")).toMatchObject({ openPositions: 2, logo: expect.stringContaining("https://remotive.com/job/") });
  });

  it("hides closed jobs and the jobs of a source that is switched off", async () => {
    await seed();
    await h.sql("UPDATE global_jobs SET is_active = false WHERE external_job_id = '1'");
    expect((await h.api("GET", "/api/jobs?keyword=.NET")).json.total).toBe(0);
    await h.sql("UPDATE job_sources SET is_active = false");
    expect((await h.api("GET", "/api/jobs")).json.total).toBe(0);
    expect((await h.api("GET", "/api/jobs/companies")).json.items).toEqual([]);
  });
});

describe("POST /api/jobs/sync", () => {
  const PASSWORD = "Password@123";
  let cookie = "";
  beforeAll(async () => {
    await h.sql("INSERT INTO tenants (id,name,slug,status,created_at,updated_at) VALUES (?,?,?,?,?,?)", "platform", "Sendrix Platform", "sendrix-platform", "Active", 1, 1);
    await h.sql(
      "INSERT INTO users (id,tenant_id,first_name,last_name,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      "super-jobs", "platform", "Super", "Admin", "Super Admin", "super.jobs@example.test", "super.jobs@example.test", await hashPassword(PASSWORD), SUPER_ADMINISTRATOR.id, "Active", 1, 1,
    );
    const r = await h.anonymous.api("POST", "/api/auth/login", { email: "super.jobs@example.test", password: PASSWORD });
    cookie = `sendrix_session=${/sendrix_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? ""}`;
  });

  it("is for the SuperAdministrator only", async () => {
    expect((await h.api("POST", "/api/jobs/sync")).status).toBe(403); // an Administrator
    expect((await h.anonymous.api("POST", "/api/jobs/sync")).status).toBe(401);
  });

  it("runs a synchronization through the app's own fetch and reports the numbers; a Remotive failure is a 502/504, not a crash", async () => {
    const { state, fetchFn } = fakeRemotive([remote(1), remote(2)]);
    const h2 = await startHarness({ fetch: fetchFn });
    try {
      await h2.sql("INSERT INTO tenants (id,name,slug,status,created_at,updated_at) VALUES (?,?,?,?,?,?)", "platform", "Sendrix Platform", "sendrix-platform", "Active", 1, 1);
      await h2.sql(
        "INSERT INTO users (id,tenant_id,first_name,last_name,display_name,email,normalized_email,password_hash,access_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        "s2", "platform", "S", "A", "S A", "s2@example.test", "s2@example.test", await hashPassword(PASSWORD), SUPER_ADMINISTRATOR.id, "Active", 1, 1,
      );
      const login = await h2.anonymous.api("POST", "/api/auth/login", { email: "s2@example.test", password: PASSWORD });
      const c = `sendrix_session=${/sendrix_session=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")?.[1] ?? ""}`;
      const ok = await h2.anonymous.api("POST", "/api/jobs/sync", undefined, { cookie: c });
      expect(ok.status).toBe(200);
      expect(ok.json).toEqual({ source: "Remotive", fetched: 2, created: 2, updated: 0, deactivated: 0 });
      state.respond = () => new Response("x", { status: 500 });
      const bad = await h2.anonymous.api("POST", "/api/jobs/sync", undefined, { cookie: c });
      expect(bad.status).toBe(502);
      expect(bad.json.error.code).toBe("JOB_SOURCE_UNAVAILABLE");
    } finally {
      await h2.dispose();
    }
    void cookie;
  });
});
