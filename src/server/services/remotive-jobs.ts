import { z } from "zod";
import type { JobCategoryDto, JobDto } from "../../shared/api";
import { REMOTIVE, safeApplyUrl } from "../../shared/jobs";
import { HourlyCap, JobSourceError, getJson, once, untilAborted } from "../lib/live-fetch";

/**
 * Remotive, live. Nothing is stored: each answer is kept in memory for a few minutes and that is all.
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
export function safeLogo(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).protocol === "https:" ? value : "";
  } catch {
    return "";
  }
}

/** Remotive's job into the app's `JobDto`. The link must be on a job source's own site (it is the link back the terms require). */
export function mapRemotiveJob(input: z.input<typeof remoteJob>): JobDto {
  const j = remoteJob.parse(input);
  const type = (j.job_type ?? "").trim();
  return {
    id: `remotive:${j.id}`,
    title: (j.title ?? "").trim(),
    companyName: (j.company_name ?? "").trim(),
    companyLogo: safeLogo(j.company_logo_url ?? j.company_logo),
    category: (j.category ?? "").trim(),
    employmentType: EMPLOYMENT[type] ?? type.replace(/_/g, " "),
    remote: true, // everything on Remotive is remote
    location: (j.candidate_required_location ?? "").trim(),
    salary: (j.salary ?? "").trim(),
    skills: [...new Set((j.tags ?? []).map((t) => t.trim()).filter(Boolean))],
    url: safeApplyUrl(j.url),
    source: REMOTIVE.name,
    publishedAt: parseTime(j.publication_date),
  };
}

/** What the service remembers between requests. A Worker keeps it for as long as that instance lives, so it is only ever a saving. */
export class RemotiveCache {
  readonly lists = new Map<string, { at: number; jobs: JobDto[] }>();
  categories: { at: number; items: JobCategoryDto[] } | null = null;
  readonly inFlight = new Map<string, Promise<unknown>>();
  cap = new HourlyCap(REMOTIVE.name, MAX_UPSTREAM_PER_HOUR);

  /** Forgets everything (tests; nothing else needs it). */
  clear(): void {
    this.lists.clear();
    this.categories = null;
    this.inFlight.clear();
    this.cap = new HourlyCap(REMOTIVE.name, MAX_UPSTREAM_PER_HOUR);
  }
}
/** The one the running Worker uses. */
export const sharedRemotiveCache = new RemotiveCache();
const sharedCache = sharedRemotiveCache;

export interface RemotiveDeps {
  /** The Worker's `fetch` (the request's, so tests can stand in for the network). */
  fetch: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  cache?: RemotiveCache;
}

/** Fetches Remotive's jobs and category list, live, mapped to `JobDto`. Filtering, sorting and paging are the caller's (job-search.ts). */
export class RemotiveJobService {
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly cache: RemotiveCache;

  constructor(private readonly deps: RemotiveDeps) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = deps.now ?? Date.now;
    this.cache = deps.cache ?? sharedCache;
  }

  /** One GET to Remotive, with a timeout, counted against the hourly cap. */
  private get(url: URL): Promise<unknown> {
    this.cache.cap.take(this.now());
    return getJson(REMOTIVE.name, this.deps.fetch, url.toString(), this.timeoutMs);
  }

  /**
   * Remotive's jobs for a search and a category (both optional), at most FETCH_LIMIT, mapped. Served from memory for LIST_TTL_MS.
   * If Remotive fails or the hourly cap is reached, an older copy of the same search is served, else the unfiltered list (the caller
   * filters it again), so the page keeps showing something.
   */
  async jobs(search: string, category: string, signal?: AbortSignal): Promise<JobDto[]> {
    const key = `${search.toLowerCase()}|${category.toLowerCase()}`;
    const hit = this.cache.lists.get(key);
    if (hit && this.now() - hit.at < LIST_TTL_MS) return hit.jobs;

    try {
      return await untilAborted(
        REMOTIVE.name,
        once(this.cache.inFlight, `list:${key}`, async () => {
          const url = new URL(REMOTIVE.endpoint);
          url.searchParams.set("limit", String(FETCH_LIMIT));
          if (search) url.searchParams.set("search", search);
          if (category) url.searchParams.set("category", category);
          const body = remoteJobs.safeParse(await this.get(url));
          if (!body.success) throw new JobSourceError(REMOTIVE.name, "parse", "Remotive's answer was not the expected shape");
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
        }),
        signal,
      );
    } catch (e) {
      if (e instanceof JobSourceError && e.kind === "aborted") throw e;
      const fallback = hit ?? this.cache.lists.get("|");
      if (fallback) return fallback.jobs; // an old copy beats an error
      throw e;
    }
  }

  /** Remotive's own category list (the value its API takes, and the name people read), kept a day. */
  async categories(signal?: AbortSignal): Promise<JobCategoryDto[]> {
    const c = this.cache.categories;
    if (c && this.now() - c.at < CATEGORIES_TTL_MS) return c.items;
    try {
      return await untilAborted(
        REMOTIVE.name,
        once(this.cache.inFlight, "categories", async () => {
          const body = remoteCategories.safeParse(await this.get(new URL(REMOTIVE.categoriesEndpoint)));
          if (!body.success) throw new JobSourceError(REMOTIVE.name, "parse", "Remotive's category list was not the expected shape");
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
}
