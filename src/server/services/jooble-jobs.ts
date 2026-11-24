import { z } from "zod";
import type { JobDescriptionBlock, JobDto } from "../../shared/api";
import { JOOBLE, safeApplyUrl } from "../../shared/jobs";
import { toDescriptionBlocks } from "../lib/job-description";
import { HourlyCap, JobSourceError, once, postJson, untilAborted } from "../lib/live-fetch";

/**
 * Jooble, live (https://jooble.org/api/about). A job aggregator that covers the Philippines, India and most other countries. It needs
 * a free API key from Jooble, kept in JOOBLE_API_KEY (`.dev.vars` or a Worker secret); without one this source is simply not used. The
 * key goes in the request address (as Jooble requires) and is never put in an error, a log or an answer to the browser.
 *
 * A search is a POST with `keywords` and `location`, so the page's keyword and locations are passed on: one request per location (at
 * most MAX_LOCATIONS). With no keyword it asks for "remote", since the Jobs page is about remote work. Jooble gives only a short
 * snippet of each job, and the link goes to the job on Jooble (which is where its terms want people sent). Nothing is stored.
 */

export const LIST_TTL_MS = 10 * 60_000;
export const MAX_UPSTREAM_PER_HOUR = 20;
export const MAX_LOCATIONS = 3;
export const DEFAULT_KEYWORDS = "remote";
const MAX_CACHE_ENTRIES = 40;
const DEFAULT_TIMEOUT_MS = 20_000;

const remoteJob = z.object({
  id: z.union([z.number(), z.string()]).nullish(),
  title: z.string().nullish(),
  location: z.string().nullish(),
  snippet: z.string().nullish(),
  salary: z.string().nullish(),
  source: z.string().nullish(),
  type: z.string().nullish(),
  link: z.string().nullish(),
  company: z.string().nullish(),
  updated: z.string().nullish(),
});
const remoteJobs = z.object({ jobs: z.array(z.unknown()) });

/** Jooble's ids are very large numbers that JSON cannot carry exactly, so a job's identity here is a short hash of its link. */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** "2026-11-20T10:30:00.0000000" (UTC, no zone) into an ISO time. */
function parseTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().replace(/(\.\d{3})\d+/, "$1");
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const EMPLOYMENT: [RegExp, string][] = [
  [/intern/i, "Internship"],
  [/part[\s-]?time/i, "Part-time"],
  [/full[\s-]?time/i, "Full-time"],
  [/contract|temporary|freelanc/i, "Contract"],
];

/** Jooble's job into the app's `JobDto`. Marked remote only when it says so: Jooble also lists jobs at a place. */
export function mapJoobleJob(input: z.input<typeof remoteJob>): JobDto {
  const j = remoteJob.parse(input);
  const link = (j.link ?? "").trim();
  const title = (j.title ?? "").replace(/<[^>]*>/g, "").trim();
  const location = (j.location ?? "").trim();
  const text = `${title} ${location} ${j.snippet ?? ""}`;
  const type = (j.type ?? "").trim();
  return {
    id: `jooble:${hashOf(link || `${title}|${j.company ?? ""}|${location}`)}`,
    title,
    companyName: (j.company ?? "").trim(),
    companyLogo: "", // Jooble gives none
    category: "",
    employmentType: EMPLOYMENT.find(([re]) => re.test(type))?.[1] ?? type,
    remote: /\bremote\b|work from home|\bwfh\b|virtual|anywhere/i.test(text),
    location,
    salary: (j.salary ?? "").trim(),
    skills: [],
    url: safeApplyUrl(link),
    source: JOOBLE.name,
    publishedAt: parseTime(j.updated),
  };
}

export class JoobleCache {
  readonly lists = new Map<string, { at: number; jobs: JobDto[]; descriptions: Map<string, JobDescriptionBlock[]> }>();
  readonly inFlight = new Map<string, Promise<unknown>>();
  cap = new HourlyCap(JOOBLE.name, MAX_UPSTREAM_PER_HOUR);

  clear(): void {
    this.lists.clear();
    this.inFlight.clear();
    this.cap = new HourlyCap(JOOBLE.name, MAX_UPSTREAM_PER_HOUR);
  }
}
export const sharedJoobleCache = new JoobleCache();

export interface JoobleFilter {
  keyword?: string;
  /** Places; one request each (at most MAX_LOCATIONS). Leave out for no place. */
  locations?: string[];
}

export interface JoobleDeps {
  fetch: typeof fetch;
  /** The API key. */
  apiKey: string;
  timeoutMs?: number;
  now?: () => number;
  cache?: JoobleCache;
}

export class JoobleJobService {
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly cache: JoobleCache;

  constructor(private readonly deps: JoobleDeps) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = deps.now ?? Date.now;
    this.cache = deps.cache ?? sharedJoobleCache;
  }

  private async one(keyword: string, location: string, signal?: AbortSignal): Promise<JobDto[]> {
    const keywords = keyword || DEFAULT_KEYWORDS;
    const key = `${keywords.toLowerCase()}|${location.toLowerCase()}`;
    const hit = this.cache.lists.get(key);
    if (hit && this.now() - hit.at < LIST_TTL_MS) return hit.jobs;
    try {
      return await untilAborted(
        JOOBLE.name,
        once(this.cache.inFlight, `list:${key}`, async () => {
          this.cache.cap.take(this.now());
          const raw = await postJson(JOOBLE.name, this.deps.fetch, `${JOOBLE.endpoint}/${encodeURIComponent(this.deps.apiKey)}`, { keywords, ...(location ? { location } : {}), page: "1" }, this.timeoutMs);
          const body = remoteJobs.safeParse(raw);
          if (!body.success) throw new JobSourceError(JOOBLE.name, "parse", "Jooble's answer was not the expected shape");
          const seen = new Set<string>();
          const out: JobDto[] = [];
          const descriptions = new Map<string, JobDescriptionBlock[]>();
          for (const r of body.data.jobs) {
            const parsed = remoteJob.safeParse(r);
            if (!parsed.success) continue;
            const job = mapJoobleJob(parsed.data);
            if (job.title === "" || seen.has(job.id)) continue;
            seen.add(job.id);
            out.push(job);
            descriptions.set(job.id, toDescriptionBlocks(parsed.data.snippet));
          }
          this.cache.lists.set(key, { at: this.now(), jobs: out, descriptions });
          while (this.cache.lists.size > MAX_CACHE_ENTRIES) this.cache.lists.delete(this.cache.lists.keys().next().value!);
          return out;
        }),
        signal,
      );
    } catch (e) {
      if (e instanceof JobSourceError && e.kind === "aborted") throw e;
      const fallback = hit ?? this.cache.lists.get(`${DEFAULT_KEYWORDS}|`);
      if (fallback) return fallback.jobs;
      throw e;
    }
  }

  async jobs(filter: JoobleFilter = {}, signal?: AbortSignal): Promise<JobDto[]> {
    const places = [...new Set(filter.locations && filter.locations.length > 0 ? filter.locations.slice(0, MAX_LOCATIONS) : [""])];
    const lists = await Promise.all(places.map((p) => this.one(filter.keyword ?? "", p, signal)));
    const seen = new Set<string>();
    return lists.flat().filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
  }

  /** Jooble's snippet of one of its jobs (by `jooble:<hash>`), from the answers in memory, else the default list is asked for once. */
  async description(id: string, signal?: AbortSignal): Promise<JobDescriptionBlock[] | null> {
    const find = () => { for (const entry of this.cache.lists.values()) { const d = entry.descriptions.get(id); if (d) return d; } return null; };
    const known = find();
    if (known) return known;
    await this.jobs({}, signal);
    return find();
  }
}
