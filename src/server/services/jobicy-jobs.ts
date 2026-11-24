import { z } from "zod";
import type { JobDescriptionBlock, JobDto } from "../../shared/api";
import { JOBICY, safeApplyUrl } from "../../shared/jobs";
import { toDescriptionBlocks } from "../lib/job-description";
import { HourlyCap, JobSourceError, getJson, once, untilAborted } from "../lib/live-fetch";
import { safeLogo } from "./remotive-jobs";

/**
 * Jobicy, live (https://jobicy.com/jobs-rss-feed, "Remote Jobs API"). Nothing is stored; the answer is kept in memory.
 *
 * Its terms: free to use, link back to the job on Jobicy and credit Jobicy as the source (every job here names Jobicy and links to its
 * page there), and do not poll too often (its jobs are refreshed about hourly): answers are kept in memory and the requests capped
 * per hour. Every job is remote.
 *
 * The page's filters are passed on to Jobicy, which can do three of them itself: `tag` (the words typed), `industry` (the category,
 * by Jobicy's own slug) and `geo` (a place, by its slug). Each different search is its own request, kept separately, so choosing a
 * filter really asks Jobicy and the list that comes back is Jobicy's answer for it. The caller still re-checks every job.
 */

/** Jobicy allows up to 100 per request. */
export const FETCH_COUNT = 100;
/** An answer stays in memory this long; the same search inside this window costs Jobicy nothing. */
export const LIST_TTL_MS = 10 * 60_000;
/** Its industry and place lists barely change. */
export const REFERENCE_TTL_MS = 24 * 60 * 60_000;
/** At most this many requests to Jobicy in any one hour; past it, an older answer is served when there is one. */
export const MAX_UPSTREAM_PER_HOUR = 20;
/** Searches with a place ask once per place; this many places at most. */
export const MAX_GEOS = 3;
const MAX_CACHE_ENTRIES = 40;
const DEFAULT_TIMEOUT_MS = 20_000;

/** Tolerant on purpose: a field Jobicy leaves out must not lose us the whole list. */
const remoteJob = z.object({
  id: z.union([z.number(), z.string()]),
  url: z.string().nullish(),
  jobTitle: z.string().nullish(),
  companyName: z.string().nullish(),
  companyLogo: z.string().nullish(),
  jobIndustry: z.union([z.array(z.string()), z.string()]).nullish(),
  jobType: z.union([z.array(z.string()), z.string()]).nullish(),
  jobGeo: z.string().nullish(),
  jobDescription: z.string().nullish(),
  pubDate: z.string().nullish(),
  salaryMin: z.union([z.number(), z.string()]).nullish(),
  salaryMax: z.union([z.number(), z.string()]).nullish(),
  salaryCurrency: z.string().nullish(),
  salaryPeriod: z.string().nullish(),
});
const remoteJobs = z.object({ jobs: z.array(z.unknown()) });

const list = (v: string[] | string | null | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []).map((s) => decodeEntities(s).trim()).filter(Boolean);
/** Jobicy sends names with HTML entities ("Marketing &amp; Sales"). */
const decodeEntities = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

const EMPLOYMENT: [RegExp, string][] = [
  [/intern/i, "Internship"],
  [/freelanc/i, "Freelance"],
  [/part[\s-]?time/i, "Part-time"],
  [/full[\s-]?time/i, "Full-time"],
  [/contract|temporary/i, "Contract"],
];
export function employmentTypeOf(types: string[]): string {
  for (const [re, label] of EMPLOYMENT) if (types.some((t) => re.test(t))) return label;
  return types[0] ?? "";
}

/** "2026-11-18 11:50:03" (UTC, no zone) into an ISO time. */
function parseTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().replace(" ", "T");
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const money = (v: number | string | null | undefined): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};

/** "USD 60,000 - 80,000 / year", or "" when Jobicy gives no pay. */
export function salaryOf(j: Pick<z.infer<typeof remoteJob>, "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod">): string {
  const lo = money(j.salaryMin);
  const hi = money(j.salaryMax);
  if (lo === null && hi === null) return "";
  const fmt = (n: number) => n.toLocaleString("en-US");
  const range = lo !== null && hi !== null && lo !== hi ? `${fmt(lo)} - ${fmt(hi)}` : fmt((lo ?? hi)!);
  const cur = (j.salaryCurrency ?? "").trim();
  const per = (j.salaryPeriod ?? "").trim().toLowerCase();
  return `${cur ? `${cur} ` : ""}${range}${per ? ` / ${per.replace(/ly$/, "")}` : ""}`;
}

/** Jobicy's job into the app's `JobDto`. The link must be on Jobicy's own site (it is the link back its terms ask for). */
export function mapJobicyJob(input: z.input<typeof remoteJob>): JobDto {
  const j = remoteJob.parse(input);
  const industries = list(j.jobIndustry);
  return {
    id: `jobicy:${j.id}`,
    title: decodeEntities(j.jobTitle ?? "").trim(),
    companyName: decodeEntities(j.companyName ?? "").trim(),
    companyLogo: safeLogo(j.companyLogo),
    category: industries[0] ?? "",
    employmentType: employmentTypeOf(list(j.jobType)),
    remote: true, // everything on Jobicy is remote
    location: decodeEntities(j.jobGeo ?? "").trim(),
    salary: salaryOf(j),
    skills: [...new Set(industries)],
    url: safeApplyUrl(j.url),
    source: JOBICY.name,
    publishedAt: parseTime(j.pubDate),
  };
}

/** What Jobicy can filter by: its industries and places, each with the slug its API takes. */
export interface JobicyReference {
  industries: { name: string; slug: string }[];
  locations: { name: string; slug: string }[];
}

/** What to ask Jobicy for. Anything left out is not filtered on. */
export interface JobicyFilter {
  /** The words typed (sent as `tag`). */
  keyword?: string;
  /** An industry slug. */
  industry?: string;
  /** Place slugs; one request each (at most MAX_GEOS). An empty slug means "no place filter". Leave out for no place filter. */
  geos?: string[];
}

const remoteReference = z.object({
  industries: z.array(z.object({ industryName: z.string(), industrySlug: z.string() }).passthrough()).optional(),
  locations: z.array(z.object({ geoName: z.string(), geoSlug: z.string() }).passthrough()).optional(),
});

export class JobicyCache {
  /** Each search's answer, with its jobs' descriptions already reduced to plain text blocks. */
  readonly lists = new Map<string, { at: number; jobs: JobDto[]; descriptions: Map<string, JobDescriptionBlock[]> }>();
  reference: { at: number; value: JobicyReference } | null = null;
  readonly inFlight = new Map<string, Promise<unknown>>();
  cap = new HourlyCap(JOBICY.name, MAX_UPSTREAM_PER_HOUR);

  /** Forgets everything (tests; nothing else needs it). */
  clear(): void {
    this.lists.clear();
    this.reference = null;
    this.inFlight.clear();
    this.cap = new HourlyCap(JOBICY.name, MAX_UPSTREAM_PER_HOUR);
  }
}
/** The one the running Worker uses. */
export const sharedJobicyCache = new JobicyCache();

export interface JobicyDeps {
  fetch: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  cache?: JobicyCache;
}

export class JobicyJobService {
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly cache: JobicyCache;

  constructor(private readonly deps: JobicyDeps) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = deps.now ?? Date.now;
    this.cache = deps.cache ?? sharedJobicyCache;
  }

  /** One GET to Jobicy, with a timeout, counted against the hourly cap. */
  private get(url: string): Promise<unknown> {
    this.cache.cap.take(this.now());
    return getJson(JOBICY.name, this.deps.fetch, url, this.timeoutMs);
  }

  /** One search (one place at most): from memory when it is fresh, else asked of Jobicy. An old copy beats an error. */
  private async one(keyword: string, industry: string, geo: string, signal?: AbortSignal): Promise<JobDto[]> {
    const key = `${keyword.toLowerCase()}|${industry}|${geo}`;
    const hit = this.cache.lists.get(key);
    if (hit && this.now() - hit.at < LIST_TTL_MS) return hit.jobs;
    try {
      return await untilAborted(
        JOBICY.name,
        once(this.cache.inFlight, `list:${key}`, async () => {
          const url = new URL(JOBICY.endpoint);
          url.searchParams.set("count", String(FETCH_COUNT));
          if (geo) url.searchParams.set("geo", geo);
          if (industry) url.searchParams.set("industry", industry);
          if (keyword) url.searchParams.set("tag", keyword);
          const body = remoteJobs.safeParse(await this.get(url.toString()));
          if (!body.success) throw new JobSourceError(JOBICY.name, "parse", "Jobicy's answer was not the expected shape");
          const seen = new Set<string>();
          const out: JobDto[] = [];
          const descriptions = new Map<string, JobDescriptionBlock[]>();
          for (const raw of body.data.jobs) {
            const parsed = remoteJob.safeParse(raw);
            if (!parsed.success) continue; // one odd job does not spoil the rest
            const job = mapJobicyJob(parsed.data);
            if (job.title === "" || seen.has(job.id)) continue;
            seen.add(job.id);
            out.push(job);
            descriptions.set(job.id, toDescriptionBlocks(parsed.data.jobDescription));
          }
          this.cache.lists.set(key, { at: this.now(), jobs: out, descriptions });
          while (this.cache.lists.size > MAX_CACHE_ENTRIES) this.cache.lists.delete(this.cache.lists.keys().next().value!);
          return out;
        }),
        signal,
      );
    } catch (e) {
      if (e instanceof JobSourceError && e.kind === "aborted") throw e;
      const fallback = hit ?? this.cache.lists.get("||");
      if (fallback) return fallback.jobs;
      throw e;
    }
  }

  /** Jobicy's jobs for a search, mapped: one request per place asked for (merged, each job once), or one request when no place is. */
  async jobs(filter: JobicyFilter = {}, signal?: AbortSignal): Promise<JobDto[]> {
    const geos = [...new Set(filter.geos && filter.geos.length > 0 ? filter.geos.slice(0, MAX_GEOS + 1) : [""])];
    const lists = await Promise.all(geos.map((g) => this.one(filter.keyword ?? "", filter.industry ?? "", g, signal)));
    const seen = new Set<string>();
    return lists.flat().filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
  }

  /** The description of one of Jobicy's jobs (by its `jobicy:<id>`), from the answers in memory; else the plain list is asked for once. */
  async description(id: string, signal?: AbortSignal): Promise<JobDescriptionBlock[] | null> {
    const find = () => { for (const entry of this.cache.lists.values()) { const d = entry.descriptions.get(id); if (d) return d; } return null; };
    const known = find();
    if (known) return known;
    await this.jobs({}, signal);
    return find();
  }

  /** Jobicy's own industries and places (names and the slugs its API takes), kept a day. Empty when they cannot be had: then nothing is passed on. */
  async reference(signal?: AbortSignal): Promise<JobicyReference> {
    const r = this.cache.reference;
    if (r && this.now() - r.at < REFERENCE_TTL_MS) return r.value;
    try {
      return await untilAborted(
        JOBICY.name,
        once(this.cache.inFlight, "reference", async () => {
          const [i, l] = await Promise.all([this.get(`${JOBICY.endpoint}?get=industries`), this.get(`${JOBICY.endpoint}?get=locations`)]);
          const ind = remoteReference.safeParse(i);
          const loc = remoteReference.safeParse(l);
          if (!ind.success || !loc.success) throw new JobSourceError(JOBICY.name, "parse", "Jobicy's industry and place lists were not the expected shape");
          const value: JobicyReference = {
            industries: (ind.data.industries ?? []).map((x) => ({ name: decodeEntities(x.industryName).trim(), slug: x.industrySlug })),
            locations: (loc.data.locations ?? []).map((x) => ({ name: decodeEntities(x.geoName).trim(), slug: x.geoSlug })),
          };
          this.cache.reference = { at: this.now(), value };
          return value;
        }),
        signal,
      );
    } catch (e) {
      if (e instanceof JobSourceError && e.kind === "aborted") throw e;
      return r?.value ?? { industries: [], locations: [] };
    }
  }
}
