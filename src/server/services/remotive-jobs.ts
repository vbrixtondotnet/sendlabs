import { z } from "zod";
import type { JobCategoryDto, JobDto, Page } from "../../shared/api";
import { REMOTIVE, safeApplyUrl } from "../../shared/jobs";
import type { JobListQuery } from "../../shared/schemas";

/**
 * A LIVE view of Remotive's jobs. Nothing is stored: not in the database, not on disk. Each result is fetched from Remotive, kept
 * in memory for a few minutes, filtered / sorted / paged here, and handed to the page.
 *
 * Remotive's terms (https://remotive.com/api-documentation): link back to the job on Remotive AND name Remotive as the source wherever
 * its jobs are shown (the Jobs page does both); do not fetch too often (they advise at most about 4 times a day: the cache and the
 * hourly cap below are how this stays polite while still answering filters); jobs are delayed 24 hours by them; do not pass their jobs
 * to other job sites; do not use them to collect sign-ups.
 */

/** How many jobs to ask Remotive for in one request. */
export const FETCH_LIMIT = 50;
/** A list stays in memory this long. Identical searches inside this window cost Remotive nothing. */
export const LIST_TTL_MS = 10 * 60_000;
/** The category list barely ever changes. */
export const CATEGORIES_TTL_MS = 24 * 60 * 60_000;
/** At most this many requests to Remotive in any one hour; past it, a cached answer (even an old one) is served, else the caller is told to wait. */
export const MAX_UPSTREAM_PER_HOUR = 12;
const MAX_CACHE_ENTRIES = 40;
const DEFAULT_TIMEOUT_MS = 15_000;

/** Why a call to Remotive failed, in words that need no knowledge of the transport. Never carries the response body. */
export class RemotiveError extends Error {
  constructor(
    readonly kind: "timeout" | "network" | "http" | "parse" | "rate_limit" | "aborted",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RemotiveError";
  }
}

/** One job as Remotive delivers it. Tolerant on purpose: a field it leaves out must not lose us the whole list. */
const remoteJob = z.object({
  id: z.union([z.number(), z.string()]),
  url: z.string().nullish(),
  title: z.string().nullish(),
  company_name: z.string().nullish(),
  company_logo: z.string().nullish(),
  company_logo_url: z.string().nullish(),
  category: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  job_type: z.string().nullish(),
  publication_date: z.string().nullish(),
  candidate_required_location: z.string().nullish(),
  salary: z.string().nullish(),
});
const remoteJobs = z.object({ jobs: z.array(z.unknown()) });
const remoteCategories = z.object({ jobs: z.array(z.object({ name: z.string(), slug: z.string() }).passthrough()) });

const EMPLOYMENT: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", freelance: "Freelance", internship: "Internship", other: "Other" };

/** Remotive sends times without a zone ("2026-11-19T14:58:42"); they are UTC. */
function parseTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** An https picture address, else "". */
function safeLogo(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).protocol === "https:" ? value : "";
  } catch {
    return "";
  }
}

/** Remotive's job into the app's `JobDto`. The link must be on remotive.com (it is the link back the terms require). */
export function mapRemotiveJob(input: z.input<typeof remoteJob>): JobDto {
  const j = remoteJob.parse(input);
  const type = (j.job_type ?? "").trim();
  return {
    id: String(j.id),
    title: (j.title ?? "").trim(),
    companyName: (j.company_name ?? "").trim(),
    companyLogo: safeLogo(j.company_logo_url ?? j.company_logo),
    category: (j.category ?? "").trim(),
    employmentType: EMPLOYMENT[type] ?? type.replace(/_/g, " "),
    location: (j.candidate_required_location ?? "").trim(),
    salary: (j.salary ?? "").trim(),
    skills: [...new Set((j.tags ?? []).map((t) => t.trim()).filter(Boolean))],
    url: safeApplyUrl(j.url),
    source: REMOTIVE.name,
    publishedAt: parseTime(j.publication_date),
  };
}

/** "USA, Canada" -> ["USA", "Canada"] */
const tokens = (location: string): string[] => location.split(/[,/;]|\band\b/i).map((t) => t.trim()).filter(Boolean);
const OPEN_TO_ANYONE = /\b(worldwide|anywhere|global|globally|world|any(?:\s+location)?)\b/i;

/** Open to candidates anywhere: Remotive says "Worldwide" (or "Anywhere"...), or names no place at all. */
export const isOpenToAnyone = (location: string): boolean => location.trim() === "" || OPEN_TO_ANYONE.test(location);

/**
 * Location filter: a job matches when it names one of the chosen places, or is open to anyone (a worldwide job suits a candidate
 * in any country). Compared ignoring case.
 */
export function matchesLocation(job: JobDto, chosen: string[]): boolean {
  if (chosen.length === 0) return true;
  if (isOpenToAnyone(job.location)) return true;
  const have = tokens(job.location).map((t) => t.toLowerCase());
  return chosen.some((c) => have.includes(c.toLowerCase()) || job.location.toLowerCase().includes(c.toLowerCase()));
}

/** Every word typed must appear in the job's title, company, category or skills (any case). */
export function matchesKeyword(job: JobDto, keyword: string): boolean {
  const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [job.title, job.companyName, job.category, ...job.skills].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** What the service remembers between requests. A Worker keeps it for as long as that instance lives, so it is only ever a saving. */
export class JobCache {
  readonly lists = new Map<string, { at: number; jobs: JobDto[] }>();
  categories: { at: number; items: JobCategoryDto[] } | null = null;
  readonly inFlight = new Map<string, Promise<unknown>>();
  /** Times (ms) of recent requests to Remotive, for the hourly cap. */
  readonly upstreamAt: number[] = [];
}
const sharedCache = new JobCache();

export interface RemotiveDeps {
  /** The Worker's `fetch` (the request's, so tests can stand in for the network). */
  fetch: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  cache?: JobCache;
}

/** Resolves with `promise`, or rejects at once if `signal` aborts (the caller went away; the shared request carries on for others). */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new RemotiveError("aborted", "The request was cancelled"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new RemotiveError("aborted", "The request was cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

export class RemotiveJobService {
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly cache: JobCache;

  constructor(private readonly deps: RemotiveDeps) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = deps.now ?? Date.now;
    this.cache = deps.cache ?? sharedCache;
  }

  /** One GET to Remotive, with a timeout, counted against the hourly cap. */
  private async get(url: URL): Promise<unknown> {
    const t = this.now();
    const recent = this.cache.upstreamAt.filter((x) => t - x < 3_600_000);
    this.cache.upstreamAt.length = 0;
    this.cache.upstreamAt.push(...recent);
    if (recent.length >= MAX_UPSTREAM_PER_HOUR) throw new RemotiveError("rate_limit", "Too many requests to Remotive just now: try again in a few minutes");
    this.cache.upstreamAt.push(t);

    let res: Response;
    try {
      res = await this.deps.fetch(url.toString(), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new RemotiveError(timedOut ? "timeout" : "network", timedOut ? `Remotive did not answer within ${this.timeoutMs / 1000} seconds` : "Could not reach Remotive");
    }
    if (!res.ok) throw new RemotiveError("http", `Remotive answered ${res.status}`, res.status);
    try {
      return await res.json();
    } catch {
      throw new RemotiveError("parse", "Remotive's answer was not valid JSON");
    }
  }

  /** The same work asked for twice at once is done once. */
  private once<T>(key: string, work: () => Promise<T>): Promise<T> {
    const running = this.cache.inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = work().finally(() => this.cache.inFlight.delete(key));
    this.cache.inFlight.set(key, p);
    return p;
  }

  /**
   * Remotive's jobs for a search and a category (both optional), at most FETCH_LIMIT, mapped. Served from memory for LIST_TTL_MS.
   * If Remotive fails or the hourly cap is reached, an older copy is served when there is one (the page keeps showing something).
   */
  private async jobsFor(search: string, category: string): Promise<JobDto[]> {
    const key = `${search.toLowerCase()}|${category.toLowerCase()}`;
    const hit = this.cache.lists.get(key);
    if (hit && this.now() - hit.at < LIST_TTL_MS) return hit.jobs;

    try {
      return await this.once(`list:${key}`, async () => {
        const url = new URL(REMOTIVE.endpoint);
        url.searchParams.set("limit", String(FETCH_LIMIT));
        if (search) url.searchParams.set("search", search);
        if (category) url.searchParams.set("category", category);
        const body = remoteJobs.safeParse(await this.get(url));
        if (!body.success) throw new RemotiveError("parse", "Remotive's answer was not the expected shape");
        const seen = new Set<string>();
        const out: JobDto[] = [];
        for (const raw of body.data.jobs) {
          const parsed = remoteJob.safeParse(raw);
          if (!parsed.success) continue; // one odd job does not spoil the rest
          const job = mapRemotiveJob(parsed.data);
          if (job.title === "" || seen.has(job.id)) continue;
          seen.add(job.id);
          out.push(job);
        }
        this.cache.lists.set(key, { at: this.now(), jobs: out });
        while (this.cache.lists.size > MAX_CACHE_ENTRIES) this.cache.lists.delete(this.cache.lists.keys().next().value!);
        return out;
      });
    } catch (e) {
      if (hit) return hit.jobs; // an old copy beats an error
      throw e;
    }
  }

  /**
   * One page of jobs for the filters: keyword and category go to Remotive (and are re-checked here); location and Remote Only are applied here; then sorted by
   * publication date and cut into the requested page. `signal` is the caller's: if it aborts (a newer search replaced this one) the
   * wait ends at once, and nothing is stored either way.
   */
  async list(q: JobListQuery, signal?: AbortSignal): Promise<Page<JobDto>> {
    const jobs = await untilAborted(this.jobsFor(q.keyword ?? "", q.category ?? ""), signal);

    // Keyword and category are sent to Remotive, but its public feed has been seen to ignore them and return the same jobs whatever
    // is asked, so the answer is checked here as well: a person who filters must get what they filtered for.
    let categoryNames: string[] = [];
    if (q.category) {
      const label = (await this.categories(signal).catch(() => [])).find((c) => c.value === q.category)?.label;
      categoryNames = [q.category, ...(label ? [label] : [])].map(normalize);
    }
    const matching = jobs.filter(
      (j) =>
        matchesKeyword(j, q.keyword ?? "") &&
        (categoryNames.length === 0 || categoryNames.includes(normalize(j.category))) &&
        matchesLocation(j, q.locations) &&
        (!q.remoteOnly || isOpenToAnyone(j.location)),
    );
    const time = (j: JobDto) => (j.publishedAt ? Date.parse(j.publishedAt) : null);
    matching.sort((a, b) => {
      const ta = time(a);
      const tb = time(b);
      if (ta === tb) return a.id.localeCompare(b.id);
      if (ta === null) return 1; // no date: last, either way
      if (tb === null) return -1;
      return q.sort === "oldest" ? ta - tb : tb - ta;
    });
    const start = (q.page - 1) * q.pageSize;
    return { items: matching.slice(start, start + q.pageSize), page: q.page, pageSize: q.pageSize, total: matching.length };
  }

  /** The choices of the Category filter, from Remotive's own category list (kept a day). */
  async categories(signal?: AbortSignal): Promise<JobCategoryDto[]> {
    const c = this.cache.categories;
    if (c && this.now() - c.at < CATEGORIES_TTL_MS) return c.items;
    try {
      return await untilAborted(
        this.once("categories", async () => {
          const body = remoteCategories.safeParse(await this.get(new URL(REMOTIVE.categoriesEndpoint)));
          if (!body.success) throw new RemotiveError("parse", "Remotive's category list was not the expected shape");
          const items = body.data.jobs.map((x) => ({ value: x.slug, label: x.name })).sort((a, b) => a.label.localeCompare(b.label));
          this.cache.categories = { at: this.now(), items };
          return items;
        }),
        signal,
      );
    } catch (e) {
      if (c) return c.items;
      throw e;
    }
  }

  /** The choices of the Location filter: the places named by the current jobs (unfiltered list), most common first. */
  async locations(signal?: AbortSignal): Promise<string[]> {
    const jobs = await untilAborted(this.jobsFor("", ""), signal);
    const counts = new Map<string, number>();
    for (const j of jobs) for (const t of tokens(j.location)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }
}
