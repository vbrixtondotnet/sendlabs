import { z } from "zod";
import type { JobDescriptionBlock, JobDto } from "../../shared/api";
import { HIMALAYAS, safeApplyUrl } from "../../shared/jobs";
import { toDescriptionBlocks } from "../lib/job-description";
import { HourlyCap, JobSourceError, getJson, once, untilAborted } from "../lib/live-fetch";
import { payLine } from "../lib/pay";
import { safeLogo } from "./remotive-jobs";

/**
 * Himalayas, live (https://himalayas.app/docs/remote-jobs-api). Free, no key; remote jobs from all over, many aimed at the
 * Philippines and India. Nothing is stored; answers are kept in memory.
 *
 * Its terms: link back to the job on Himalayas and credit it as the source (the View Job panel does both). Its search endpoint takes
 * `q` (the words), `country` (one country: it returns jobs open to that country and worldwide ones) and `page` (20 jobs a page), so the
 * page's keyword and locations are passed on: one request per country (at most MAX_COUNTRIES), PAGES pages each.
 */

export const PAGES = 2;
export const LIST_TTL_MS = 10 * 60_000;
export const MAX_UPSTREAM_PER_HOUR = 30;
export const MAX_COUNTRIES = 3;
const MAX_CACHE_ENTRIES = 40;
const DEFAULT_TIMEOUT_MS = 20_000;

const remoteJob = z.object({
  title: z.string().nullish(),
  companyName: z.string().nullish(),
  companyLogo: z.string().nullish(),
  employmentType: z.string().nullish(),
  minSalary: z.union([z.number(), z.string()]).nullish(),
  maxSalary: z.union([z.number(), z.string()]).nullish(),
  salaryPeriod: z.string().nullish(),
  currency: z.string().nullish(),
  locationRestrictions: z.array(z.string()).nullish(),
  categories: z.array(z.string()).nullish(),
  parentCategories: z.array(z.string()).nullish(),
  description: z.string().nullish(),
  pubDate: z.union([z.number(), z.string()]).nullish(),
  applicationLink: z.string().nullish(),
  guid: z.string().nullish(),
});
const remoteJobs = z.object({ jobs: z.array(z.unknown()) });

const humanize = (v: string) => v.replace(/-/g, " ").replace(/\s+/g, " ").trim();

const EMPLOYMENT: [RegExp, string][] = [
  [/intern/i, "Internship"],
  [/part[\s-]?time/i, "Part-time"],
  [/full[\s-]?time/i, "Full-time"],
  [/contract|temporary|freelanc/i, "Contract"],
];
export function employmentTypeOf(type: string | null | undefined): string {
  const t = (type ?? "").trim();
  for (const [re, label] of EMPLOYMENT) if (re.test(t)) return label;
  return t;
}

/** The part of the job's address after the site name: the job's own identity there (`companies/acme/jobs/va`). */
const idOf = (j: { guid?: string | null | undefined; applicationLink?: string | null | undefined }): string => {
  const raw = (j.guid || j.applicationLink || "").replace(/^https?:\/\/(?:www\.)?himalayas\.app\//, "").replace(/\?.*$/, "");
  return raw;
};

/** Himalayas's job into the app's `JobDto`. Open to the countries it lists (none listed means worldwide). */
export function mapHimalayasJob(input: z.input<typeof remoteJob>): JobDto {
  const j = remoteJob.parse(input);
  const parents = (j.parentCategories ?? []).map(humanize).filter(Boolean);
  const cats = (j.categories ?? []).map(humanize).filter(Boolean);
  const seconds = typeof j.pubDate === "string" ? Number(j.pubDate) : j.pubDate;
  return {
    id: `himalayas:${idOf(j)}`,
    title: (j.title ?? "").trim(),
    companyName: (j.companyName ?? "").trim(),
    companyLogo: safeLogo(j.companyLogo),
    category: parents[0] ?? cats[0] ?? "",
    employmentType: employmentTypeOf(j.employmentType),
    remote: true, // everything on Himalayas is remote
    location: (j.locationRestrictions ?? []).map((l) => l.trim()).filter(Boolean).join(", "),
    salary: payLine({ min: j.minSalary, max: j.maxSalary, currency: j.currency, period: j.salaryPeriod }),
    skills: [...new Set([...parents, ...cats])].slice(0, 12),
    url: safeApplyUrl(j.applicationLink),
    source: HIMALAYAS.name,
    publishedAt: typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null,
  };
}

export class HimalayasCache {
  readonly lists = new Map<string, { at: number; jobs: JobDto[]; descriptions: Map<string, JobDescriptionBlock[]> }>();
  readonly inFlight = new Map<string, Promise<unknown>>();
  cap = new HourlyCap(HIMALAYAS.name, MAX_UPSTREAM_PER_HOUR);

  clear(): void {
    this.lists.clear();
    this.inFlight.clear();
    this.cap = new HourlyCap(HIMALAYAS.name, MAX_UPSTREAM_PER_HOUR);
  }
}
export const sharedHimalayasCache = new HimalayasCache();

export interface HimalayasFilter {
  /** The words typed (sent as `q`). */
  keyword?: string;
  /** Countries; one request each (at most MAX_COUNTRIES). Leave out for no country filter. */
  countries?: string[];
}

export interface HimalayasDeps {
  fetch: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  cache?: HimalayasCache;
}

export class HimalayasJobService {
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly cache: HimalayasCache;

  constructor(private readonly deps: HimalayasDeps) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = deps.now ?? Date.now;
    this.cache = deps.cache ?? sharedHimalayasCache;
  }

  private async page(keyword: string, country: string, page: number): Promise<unknown> {
    const url = new URL(HIMALAYAS.endpoint);
    if (keyword) url.searchParams.set("q", keyword);
    if (country) url.searchParams.set("country", country);
    if (page > 1) url.searchParams.set("page", String(page));
    this.cache.cap.take(this.now());
    return getJson(HIMALAYAS.name, this.deps.fetch, url.toString(), this.timeoutMs);
  }

  /** One search (one country at most): PAGES pages, from memory when fresh. An old copy beats an error. */
  private async one(keyword: string, country: string, signal?: AbortSignal): Promise<JobDto[]> {
    const key = `${keyword.toLowerCase()}|${country.toLowerCase()}`;
    const hit = this.cache.lists.get(key);
    if (hit && this.now() - hit.at < LIST_TTL_MS) return hit.jobs;
    try {
      return await untilAborted(
        HIMALAYAS.name,
        once(this.cache.inFlight, `list:${key}`, async () => {
          const seen = new Set<string>();
          const out: JobDto[] = [];
          const descriptions = new Map<string, JobDescriptionBlock[]>();
          for (let p = 1; p <= PAGES; p++) {
            const body = remoteJobs.safeParse(await this.page(keyword, country, p));
            if (!body.success) throw new JobSourceError(HIMALAYAS.name, "parse", "Himalayas's answer was not the expected shape");
            for (const raw of body.data.jobs) {
              const parsed = remoteJob.safeParse(raw);
              if (!parsed.success) continue; // one odd job does not spoil the rest
              const job = mapHimalayasJob(parsed.data);
              if (job.title === "" || job.id === "himalayas:" || seen.has(job.id)) continue;
              seen.add(job.id);
              out.push(job);
              descriptions.set(job.id, toDescriptionBlocks(parsed.data.description));
            }
            if (body.data.jobs.length < 20) break; // the last page
          }
          this.cache.lists.set(key, { at: this.now(), jobs: out, descriptions });
          while (this.cache.lists.size > MAX_CACHE_ENTRIES) this.cache.lists.delete(this.cache.lists.keys().next().value!);
          return out;
        }),
        signal,
      );
    } catch (e) {
      if (e instanceof JobSourceError && e.kind === "aborted") throw e;
      const fallback = hit ?? this.cache.lists.get("|");
      if (fallback) return fallback.jobs;
      throw e;
    }
  }

  /** Himalayas's jobs for a search, mapped: one request per country asked for (merged, each job once), or one when none is. */
  async jobs(filter: HimalayasFilter = {}, signal?: AbortSignal): Promise<JobDto[]> {
    const countries = [...new Set(filter.countries && filter.countries.length > 0 ? filter.countries.slice(0, MAX_COUNTRIES) : [""])];
    const lists = await Promise.all(countries.map((c) => this.one(filter.keyword ?? "", c, signal)));
    const seen = new Set<string>();
    return lists.flat().filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
  }

  /** The description of one of its jobs (by `himalayas:<id>`), from the answers in memory; else the plain list is asked for once. */
  async description(id: string, signal?: AbortSignal): Promise<JobDescriptionBlock[] | null> {
    const find = () => { for (const entry of this.cache.lists.values()) { const d = entry.descriptions.get(id); if (d) return d; } return null; };
    const known = find();
    if (known) return known;
    await this.jobs({}, signal);
    return find();
  }
}
