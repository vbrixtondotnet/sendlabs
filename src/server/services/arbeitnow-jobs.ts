import { z } from "zod";
import type { JobDescriptionBlock, JobDto } from "../../shared/api";
import { ARBEITNOW, safeApplyUrl } from "../../shared/jobs";
import { toDescriptionBlocks } from "../lib/job-description";
import { HourlyCap, JobSourceError, getJson, once, untilAborted } from "../lib/live-fetch";

/**
 * Arbeitnow, live (https://www.arbeitnow.com/blog/job-board-api). Nothing is stored; the answer is kept in memory.
 *
 * Its terms, in the API's own words: "a free public API for jobs, please do not abuse. I would appreciate linking back to the site."
 * So every job names Arbeitnow and links to its page there. It sends `X-RateLimit-Limit: 50` (without saying per what) and updates its
 * jobs once an hour, so one request an hour is all that is ever useful: the list is kept for an hour and the cap is far below 50.
 * It ignores search parameters (the same jobs come back whatever is asked), so there is only one list to keep, and the caller filters.
 */

/** Pages are 300 jobs each, with long descriptions: one page is plenty and keeps the memory a request needs modest. */
export const PAGES = 1;
/** Arbeitnow refreshes hourly. */
export const LIST_TTL_MS = 60 * 60_000;
/** Far below its own limit of 50. */
export const MAX_UPSTREAM_PER_HOUR = 6;
const DEFAULT_TIMEOUT_MS = 20_000;

const remoteJob = z.object({
  slug: z.string(),
  url: z.string().nullish(),
  title: z.string().nullish(),
  company_name: z.string().nullish(),
  remote: z.boolean().nullish(),
  tags: z.array(z.string()).nullish(),
  job_types: z.array(z.string()).nullish(),
  location: z.string().nullish(),
  description: z.string().nullish(),
  created_at: z.union([z.number(), z.string()]).nullish(),
});
const remoteJobs = z.object({ data: z.array(z.unknown()) });

/**
 * Arbeitnow's `job_types` mixes kinds of contract with levels of experience, in several languages ("Full Time", "Praktikum",
 * "berufserfahren", "Cdi - contrat à durée indéterminée"). Only the kind of contract is shown; a level is ignored.
 */
export function employmentTypeOf(types: string[] | null | undefined): string {
  const rules: [RegExp, string][] = [
    [/intern|praktik|\bstage\b/i, "Internship"],
    [/freelanc|freiberuf|selbst[a-zä]*ndig|self-employed|independent|auto-entrepreneur|ind[eé]pendant/i, "Freelance"],
    [/part\s?-?time|teilzeit|parttime/i, "Part-time"],
    [/full\s?-?time|fulltime|vollzeit|permanent|unbefristet|indefinite|\bcdi\b|vast dienstverband/i, "Full-time"],
    [/contract|temporary|interim|befristet|fixed term|zeitarbeit|[uü]berlassung/i, "Contract"],
  ];

  const all = types ?? [];
  for (const [re, label] of rules) if (all.some((t) => re.test(t))) return label;
  return "";
}

/** Arbeitnow's job into the app's `JobDto`. The link must be on one of its own sites. */
export function mapArbeitnowJob(input: z.input<typeof remoteJob>): JobDto {
  const j = remoteJob.parse(input);
  const tags = [...new Set((j.tags ?? []).map((t) => t.trim()).filter(Boolean))];
  const location = (j.location ?? "").trim();
  const remote = j.remote === true || tags.some((t) => t.toLowerCase() === "remote") || /\bremote\b/i.test(location);
  const skills = tags.filter((t) => t.toLowerCase() !== "remote");
  const seconds = typeof j.created_at === "string" ? Number(j.created_at) : j.created_at;
  return {
    id: `arbeitnow:${j.slug}`,
    title: (j.title ?? "").trim(),
    companyName: (j.company_name ?? "").trim(),
    companyLogo: "", // Arbeitnow gives none
    category: skills[0] ?? "",
    employmentType: employmentTypeOf(j.job_types),
    remote,
    location: /^remote( job)?$/i.test(location) ? "" : location, // "Remote job" is a label, not a place
    salary: "",
    skills,
    url: safeApplyUrl(j.url),
    source: ARBEITNOW.name,
    publishedAt: typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null,
  };
}

export class ArbeitnowCache {
  /** The list, with each job's description already reduced to plain text blocks (Arbeitnow's are up to 40 KB of escaped HTML each). */
  list: { at: number; jobs: JobDto[]; descriptions: Map<string, JobDescriptionBlock[]> } | null = null;
  readonly inFlight = new Map<string, Promise<unknown>>();
  cap = new HourlyCap(ARBEITNOW.name, MAX_UPSTREAM_PER_HOUR);

  /** Forgets everything (tests; nothing else needs it). */
  clear(): void {
    this.list = null;
    this.inFlight.clear();
    this.cap = new HourlyCap(ARBEITNOW.name, MAX_UPSTREAM_PER_HOUR);
  }
}
/** The one the running Worker uses. */
export const sharedArbeitnowCache = new ArbeitnowCache();
const sharedCache = sharedArbeitnowCache;

export interface ArbeitnowDeps {
  fetch: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  cache?: ArbeitnowCache;
}

export class ArbeitnowJobService {
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly cache: ArbeitnowCache;

  constructor(private readonly deps: ArbeitnowDeps) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = deps.now ?? Date.now;
    this.cache = deps.cache ?? sharedCache;
  }

  /**
   * The jobs on Arbeitnow's first page(s), mapped. Kept in memory for an hour; identical simultaneous calls share one request; if
   * Arbeitnow then fails, or the cap is reached, the last copy is served when there is one.
   */
  async jobs(signal?: AbortSignal): Promise<JobDto[]> {
    const hit = this.cache.list;
    if (hit && this.now() - hit.at < LIST_TTL_MS) return hit.jobs;
    try {
      return await untilAborted(
        ARBEITNOW.name,
        once(this.cache.inFlight, "list", async () => {
          const seen = new Set<string>();
          const out: JobDto[] = [];
          const descriptions = new Map<string, JobDescriptionBlock[]>();
          for (let page = 1; page <= PAGES; page++) {
            this.cache.cap.take(this.now());
            const body = remoteJobs.safeParse(await getJson(ARBEITNOW.name, this.deps.fetch, `${ARBEITNOW.endpoint}?page=${page}`, this.timeoutMs));
            if (!body.success) throw new JobSourceError(ARBEITNOW.name, "parse", "Arbeitnow's answer was not the expected shape");
            for (const raw of body.data.data) {
              const parsed = remoteJob.safeParse(raw);
              if (!parsed.success) continue; // one odd job does not spoil the rest
              const job = mapArbeitnowJob(parsed.data);
              if (job.title === "" || seen.has(job.id)) continue;
              seen.add(job.id);
              out.push(job);
              descriptions.set(job.id, toDescriptionBlocks(parsed.data.description));
            }
          }
          this.cache.list = { at: this.now(), jobs: out, descriptions };
          return out;
        }),
        signal,
      );
    } catch (e) {
      if (e instanceof JobSourceError && e.kind === "aborted") throw e;
      if (hit) return hit.jobs; // an old copy beats an error
      throw e;
    }
  }

  /** The description of one of Arbeitnow's jobs (by its `arbeitnow:<slug>`) as plain text blocks, or null when it is no longer listed. */
  async description(id: string, signal?: AbortSignal): Promise<JobDescriptionBlock[] | null> {
    await this.jobs(signal); // from memory when it is fresh, else fetched again
    return this.cache.list?.descriptions.get(id) ?? null;
  }
}
