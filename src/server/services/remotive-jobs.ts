import { z } from "zod";
import type { JobSyncDto } from "../../shared/api";
import { REMOTIVE } from "../../shared/jobs";
import type { Database } from "../database/client";
import { jobsRepo, type JobInput } from "../database/repositories/jobs";
import { nowMs } from "../lib/id";

/**
 * Remotive's terms (https://remotive.com/api-documentation): link back to the job's URL on Remotive AND name Remotive as the
 * source wherever its jobs are shown (the Jobs page does both); fetch no more than about 4 times a day (`DEFAULT_MIN_INTERVAL_MS`);
 * jobs are delayed 24 hours by them; do not pass their jobs on to other job sites, and do not use them to collect sign-ups.
 */

/** The scheduled synchronization waits at least this long between tries: 6 hours is 4 a day. */
export const DEFAULT_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;

/** Why a call to Remotive failed, in words that need no knowledge of the transport. Never carries the response body. */
export class RemotiveError extends Error {
  constructor(
    readonly kind: "timeout" | "network" | "http" | "parse",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RemotiveError";
  }
}

/** What can be asked of Remotive (its documented parameters). */
export interface RemotiveQuery {
  search?: string;
  category?: string;
  companyName?: string;
  limit?: number;
}

/** One job as Remotive delivers it. Tolerant on purpose: a field it leaves out must not lose us the whole list. */
const remoteJob = z.object({
  id: z.union([z.number(), z.string()]),
  url: z.string().default(""),
  title: z.string().default(""),
  company_name: z.string().default(""),
  company_logo: z.string().nullish(),
  company_logo_url: z.string().nullish(),
  category: z.string().default(""),
  tags: z.array(z.string()).nullish(),
  job_type: z.string().nullish(),
  publication_date: z.string().nullish(),
  candidate_required_location: z.string().nullish(),
  salary: z.string().nullish(),
  description: z.string().nullish(),
});
const remoteResponse = z.object({ jobs: z.array(z.unknown()) });

const EMPLOYMENT: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  freelance: "Freelance",
  internship: "Internship",
  other: "Other",
};

/** Remotive sends local-looking times without a zone ("2026-11-19T14:58:42"); they are UTC. */
function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** An https address on the given host (or one of its subdomains), else "". Keeps a bad value out of a link or an image. */
function safeUrl(value: string | null | undefined, hostSuffix?: string): string {
  if (!value) return "";
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return "";
    if (hostSuffix && u.hostname !== hostSuffix && !u.hostname.endsWith(`.${hostSuffix}`)) return "";
    return u.toString();
  } catch {
    return "";
  }
}

/** Remotive's job into ours. The job's link must be on remotive.com (it is the link back the terms require). */
export function mapRemotiveJob(input: z.input<typeof remoteJob>): JobInput {
  const j = remoteJob.parse(input); // fills in what is missing
  const type = (j.job_type ?? "").trim();
  return {
    externalJobId: String(j.id),
    jobTitle: j.title.trim(),
    companyName: j.company_name.trim(),
    companyLogo: safeUrl(j.company_logo_url ?? j.company_logo),
    category: j.category.trim(),
    employmentType: EMPLOYMENT[type] ?? type.replace(/_/g, " "),
    location: (j.candidate_required_location ?? "").trim(),
    salary: (j.salary ?? "").trim(),
    tags: [...new Set((j.tags ?? []).map((t) => t.trim()).filter(Boolean))],
    description: j.description ?? "",
    jobUrl: safeUrl(j.url, "remotive.com"),
    publishedAt: parseTime(j.publication_date),
  };
}

export interface RemotiveDeps {
  db: Database;
  /** The Worker's `fetch` (the request's, so tests can stand in for the network). */
  fetch: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

/** Reads jobs from Remotive and keeps the `global_jobs` table in step with them. Never called from the browser. */
export class RemotiveJobService {
  private readonly repo: ReturnType<typeof jobsRepo>;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: RemotiveDeps) {
    this.repo = jobsRepo(deps.db);
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = deps.now ?? nowMs;
  }

  /** Asks Remotive for jobs and maps them to ours. Throws `RemotiveError`; jobs it returns twice are kept once. */
  async fetchJobs(query: RemotiveQuery = {}): Promise<JobInput[]> {
    const url = new URL(REMOTIVE.endpoint);
    if (query.search) url.searchParams.set("search", query.search);
    if (query.category) url.searchParams.set("category", query.category);
    if (query.companyName) url.searchParams.set("company_name", query.companyName);
    if (query.limit) url.searchParams.set("limit", String(query.limit));

    let res: Response;
    try {
      res = await this.deps.fetch(url.toString(), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new RemotiveError(timedOut ? "timeout" : "network", timedOut ? `Remotive did not answer within ${this.timeoutMs / 1000} seconds` : "Could not reach Remotive");
    }
    if (!res.ok) throw new RemotiveError("http", `Remotive answered ${res.status}`, res.status);

    let body: z.infer<typeof remoteResponse>;
    try {
      body = remoteResponse.parse(await res.json());
    } catch {
      throw new RemotiveError("parse", "Remotive's answer was not the expected shape");
    }

    const seen = new Set<string>();
    const jobs: JobInput[] = [];
    for (const raw of body.jobs) {
      const parsed = remoteJob.safeParse(raw);
      if (!parsed.success) continue; // one odd job does not spoil the rest
      const job = mapRemotiveJob(parsed.data);
      if (job.jobTitle === "" || seen.has(job.externalJobId)) continue;
      seen.add(job.externalJobId);
      jobs.push(job);
    }
    return jobs;
  }

  /**
   * Fetches and stores. Safe to run any number of times: jobs are matched on (source, Remotive id), so a repeat updates and never
   * duplicates. A full, unfiltered run also closes the jobs Remotive no longer lists; a filtered run (search, category, company,
   * limit) is only a slice of the list, so it never closes anything. Logs the outcome, or the failure, as one line of JSON.
   */
  async sync(query: RemotiveQuery = {}): Promise<JobSyncDto> {
    const started = this.now();
    const source = await this.repo.ensureSource(REMOTIVE.name, "api", REMOTIVE.endpoint);
    await this.repo.markAttempt(source.id, started);
    try {
      const jobs = await this.fetchJobs(query);
      const { created, updated } = await this.repo.upsertMany(source.id, jobs);
      const isFull = !query.search && !query.category && !query.companyName && !query.limit;
      const deactivated = isFull && jobs.length > 0 ? await this.repo.deactivateMissing(source.id, jobs.map((j) => j.externalJobId)) : 0;
      await this.repo.markSynced(source.id, this.now());
      const result: JobSyncDto = { source: REMOTIVE.name, fetched: jobs.length, created, updated, deactivated };
      console.log(JSON.stringify({ level: "info", event: "jobs_sync", ...result, ms: this.now() - started }));
      return result;
    } catch (e) {
      console.error(JSON.stringify({ level: "error", event: "jobs_sync_failed", source: REMOTIVE.name, kind: e instanceof RemotiveError ? e.kind : "unknown", status: e instanceof RemotiveError ? e.status ?? null : null }));
      throw e;
    }
  }

  /** The scheduled entry point: synchronizes only when the last try is older than `minIntervalMs`, else does nothing (null). */
  async syncIfDue(minIntervalMs = DEFAULT_MIN_INTERVAL_MS): Promise<JobSyncDto | null> {
    const source = await this.repo.ensureSource(REMOTIVE.name, "api", REMOTIVE.endpoint);
    if (!source.isActive) return null;
    const last = source.lastAttemptAt ?? source.lastSyncedAt;
    if (last !== null && this.now() - last < minIntervalMs) return null;
    return this.sync();
  }
}
