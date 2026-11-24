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
 * page there), and do not poll often: its jobs are refreshed about hourly and it asks for no more than one request an hour, so the list
 * is kept for an hour and the cap is small. Every job is remote. It is asked for the newest jobs only (no filters): we filter ourselves,
 * on the merged list, so there is a single list to keep, like Arbeitnow.
 */

/** Jobicy allows up to 100 per request. */
export const FETCH_COUNT = 100;
/** Kept this long: Jobicy asks for roughly one request an hour. */
export const LIST_TTL_MS = 60 * 60_000;
/** Well under what it tolerates. */
export const MAX_UPSTREAM_PER_HOUR = 4;
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

export class JobicyCache {
  list: { at: number; jobs: JobDto[]; descriptions: Map<string, JobDescriptionBlock[]> } | null = null;
  readonly inFlight = new Map<string, Promise<unknown>>();
  cap = new HourlyCap(JOBICY.name, MAX_UPSTREAM_PER_HOUR);

  /** Forgets everything (tests; nothing else needs it). */
  clear(): void {
    this.list = null;
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

  /** The newest jobs on Jobicy, mapped. Kept an hour; identical simultaneous calls share one request; if Jobicy then fails, the last copy is served. */
  async jobs(signal?: AbortSignal): Promise<JobDto[]> {
    const hit = this.cache.list;
    if (hit && this.now() - hit.at < LIST_TTL_MS) return hit.jobs;
    try {
      return await untilAborted(
        JOBICY.name,
        once(this.cache.inFlight, "list", async () => {
          this.cache.cap.take(this.now());
          const body = remoteJobs.safeParse(await getJson(JOBICY.name, this.deps.fetch, `${JOBICY.endpoint}?count=${FETCH_COUNT}`, this.timeoutMs));
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

  /** The description of one of Jobicy's jobs (by its `jobicy:<id>`) as plain text blocks, or null when it is no longer listed. */
  async description(id: string, signal?: AbortSignal): Promise<JobDescriptionBlock[] | null> {
    await this.jobs(signal);
    return this.cache.list?.descriptions.get(id) ?? null;
  }
}
