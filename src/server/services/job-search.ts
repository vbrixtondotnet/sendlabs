import type { JobCategoryDto, JobDescriptionBlock, JobDto, JobsPageDto } from "../../shared/api";
import { ARBEITNOW, JOBICY, REMOTIVE } from "../../shared/jobs";
import type { JobListQuery } from "../../shared/schemas";
import { JobSourceError } from "../lib/live-fetch";
import { ArbeitnowJobService } from "./arbeitnow-jobs";
import { JobicyJobService, MAX_GEOS, type JobicyFilter } from "./jobicy-jobs";
import { RemotiveJobService } from "./remotive-jobs";

/**
 * The Jobs page's one source of jobs: Remotive, Arbeitnow and Jobicy, live, side by side, merged into a single list. Nothing is stored.
 * Each source is fetched, cached and capped by its own service; this adds the filters that neither source can do for us (they
 * ignore search parameters), the sort and the paging, over the merged list. If one source cannot be reached the other still
 * answers, and the page is told which one is missing; only when every source fails is it an error.
 */

/** Every word typed must appear in the job's title, company, category or skills (any case). */
export function matchesKeyword(job: JobDto, keyword: string): boolean {
  const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [job.title, job.companyName, job.category, ...job.skills].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** "USA, Canada" -> ["USA", "Canada"] */
const tokens = (location: string): string[] => location.split(/[,/;]|\band\b/i).map((t) => t.trim()).filter(Boolean);
const OPEN_TO_ANYONE = /\b(worldwide|anywhere|global|globally|world|any(?:\s+location)?)\b/i;

/** Open to candidates anywhere: the location says "Worldwide" (or "Anywhere"...), or names no place at all. */
export const isOpenToAnyone = (location: string): boolean => location.trim() === "" || OPEN_TO_ANYONE.test(location);

/**
 * Location filter: a job matches when its location names one of the chosen places, or is open to anyone (a worldwide job suits a
 * candidate in any country). Compared ignoring case.
 */
export function matchesLocation(job: JobDto, chosen: string[]): boolean {
  if (chosen.length === 0) return true;
  if (isOpenToAnyone(job.location)) return true;
  const have = tokens(job.location).map((t) => t.toLowerCase());
  return chosen.some((c) => have.includes(c.toLowerCase()) || job.location.toLowerCase().includes(c.toLowerCase()));
}

/** A topic must label at least this many Arbeitnow jobs to be offered as a category. */
const MIN_TOPIC_JOBS = 3;

export interface JobSources {
  remotive: RemotiveJobService;
  arbeitnow: ArbeitnowJobService;
  jobicy: JobicyJobService;
}

export function jobSources(doFetch: typeof fetch): JobSources {
  return { remotive: new RemotiveJobService({ fetch: doFetch }), arbeitnow: new ArbeitnowJobService({ fetch: doFetch }), jobicy: new JobicyJobService({ fetch: doFetch }) };
}

type Outcome = { source: string; jobs: JobDto[] } | { source: string; error: JobSourceError };

/** Runs each source; one that fails is reported, not fatal. Throws only if all fail (or the caller cancelled). */
async function fromAll(sources: { name: string; run: () => Promise<JobDto[]> }[]): Promise<{ jobs: JobDto[]; unavailable: string[] }> {
  const outcomes: Outcome[] = await Promise.all(
    sources.map(async (s): Promise<Outcome> => {
      try {
        return { source: s.name, jobs: await s.run() };
      } catch (e) {
        if (e instanceof JobSourceError) return { source: s.name, error: e };
        throw e;
      }
    }),
  );
  const failed = outcomes.filter((o): o is { source: string; error: JobSourceError } => "error" in o);
  const cancelled = failed.find((f) => f.error.kind === "aborted");
  if (cancelled) throw cancelled.error;
  if (failed.length === outcomes.length) throw failed[0]!.error; // nothing to show: the page shows the error
  return { jobs: outcomes.flatMap((o) => ("jobs" in o ? o.jobs : [])), unavailable: failed.map((f) => f.source) };
}

export class JobSearchService {
  constructor(private readonly sources: JobSources) {}

  /**
   * What Jobicy is asked for, from the page's filters: the words as `tag`, the category as its `industry` when it is one of Jobicy's,
   * and each chosen place that is one of Jobicy's as a `geo` (plus "anywhere", since a worldwide job suits any place). A place Jobicy
   * does not know means it is also asked without a place, and the local check below picks out what matches.
   */
  private async jobicyFilter(q: JobListQuery, signal?: AbortSignal): Promise<JobicyFilter> {
    const ref = await this.sources.jobicy.reference(signal);
    const filter: JobicyFilter = {};
    if (q.keyword) filter.keyword = q.keyword;
    if (q.category) {
      const want = normalize(q.category);
      const industry = ref.industries.find((i) => normalize(i.name) === want || normalize(i.slug) === want);
      if (industry) filter.industry = industry.slug;
    }
    if (q.locations.length > 0) {
      const known = q.locations.map((l) => ref.locations.find((g) => normalize(g.name) === normalize(l))?.slug).filter((x): x is string => !!x);
      const allKnown = known.length === q.locations.length;
      filter.geos = [...known.slice(0, MAX_GEOS), ...(known.length > 0 ? ["anywhere"] : []), ...(allKnown ? [] : [""])];
    }
    return filter;
  }

  /**
   * One page of jobs for the filters. The page's filters are sent to the sources that can use them: the keyword goes to Remotive as
   * `search` and to Jobicy as `tag`; the category goes to Remotive as `category` (when it is one of Remotive's) and to Jobicy as
   * `industry` (when it is one of Jobicy's); chosen places go to Jobicy as `geo`. Arbeitnow cannot filter (it ignores every parameter),
   * so its list is kept whole. Everything is then re-checked here on the merged list; Location, Remote only, sort and paging are
   * applied here too. `signal` is the caller's: if it aborts the wait ends at once.
   */
  async list(q: JobListQuery, signal?: AbortSignal): Promise<JobsPageDto> {
    const categories = await this.categories(signal).catch(() => [] as (JobCategoryDto & { remotive: boolean })[]);
    const chosen = categories.find((c) => c.value === q.category);
    const remotiveCategory = chosen?.remotive ? chosen.value : "";
    const jobicyFilter = await this.jobicyFilter(q, signal);
    const { jobs, unavailable } = await fromAll([
      { name: REMOTIVE.name, run: () => this.sources.remotive.jobs(q.keyword ?? "", remotiveCategory, signal) },
      { name: ARBEITNOW.name, run: () => this.sources.arbeitnow.jobs(signal) },
      { name: JOBICY.name, run: () => this.sources.jobicy.jobs(jobicyFilter, signal) },
    ]);

    const wanted = q.category ? [q.category, chosen?.label ?? ""].filter(Boolean).map(normalize) : [];
    const matching = jobs.filter(
      (j) =>
        matchesKeyword(j, q.keyword ?? "") &&
        (wanted.length === 0 || [j.category, ...j.skills].some((c) => wanted.includes(normalize(c)))) &&
        (!q.remoteOnly || j.remote) &&
        matchesLocation(j, q.locations),
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
    return { items: matching.slice(start, start + q.pageSize), page: q.page, pageSize: q.pageSize, total: matching.length, unavailable };
  }

  /**
   * The choices of the Category filter: Remotive's own categories, then the topics Arbeitnow and Jobicy use that Remotive does not (the same
   * name is listed once). Their topics are free text, so only those on at least 3 jobs are offered, at most 30.
   * `remotive` marks the ones Remotive's API understands.
   */
  async categories(signal?: AbortSignal): Promise<(JobCategoryDto & { remotive: boolean })[]> {
    const [theirs, arbeit, jobicy] = await Promise.all([
      this.sources.remotive.categories(signal).catch((e) => { if (e instanceof JobSourceError && e.kind === "aborted") throw e; return [] as JobCategoryDto[]; }),
      this.sources.arbeitnow.jobs(signal).catch((e) => { if (e instanceof JobSourceError && e.kind === "aborted") throw e; return [] as JobDto[]; }),
      this.sources.jobicy.jobs({}, signal).catch((e) => { if (e instanceof JobSourceError && e.kind === "aborted") throw e; return [] as JobDto[]; }),
    ]);
    const jobs = [...arbeit, ...jobicy];
    const industries = (await this.sources.jobicy.reference(signal)).industries;
    if (theirs.length === 0 && jobs.length === 0) throw new JobSourceError("Jobs", "network", "No job source could be reached");
    const out: (JobCategoryDto & { remotive: boolean })[] = theirs.map((c) => ({ ...c, remotive: true }));
    const known = new Set(theirs.flatMap((c) => [normalize(c.value), normalize(c.label)]));
    const counts = new Map<string, number>();
    for (const j of jobs) for (const t of j.skills) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [name] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).filter(([, n]) => n >= MIN_TOPIC_JOBS).slice(0, 30)) {
      if (!known.has(normalize(name))) { known.add(normalize(name)); out.push({ value: name, label: name, remotive: false }); }
    }
    // All of Jobicy's industries are offered (choosing one asks Jobicy for exactly that industry).
    for (const i of industries) if (!known.has(normalize(i.name))) { known.add(normalize(i.name)); out.push({ value: i.name, label: i.name, remotive: false }); }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * The description of one job, from the source its id names ("remotive:123", "arbeitnow:some-slug", "jobicy:456"), as plain text blocks. Null when
   * the id is not one of ours or the source no longer lists the job.
   */
  async description(id: string, signal?: AbortSignal): Promise<JobDescriptionBlock[] | null> {
    if (id.startsWith("remotive:")) return this.sources.remotive.description(id, signal);
    if (id.startsWith("arbeitnow:")) return this.sources.arbeitnow.description(id, signal);
    if (id.startsWith("jobicy:")) return this.sources.jobicy.description(id, signal);
    return null;
  }

  /** The choices of the Location filter: the places the jobs name (both sources), most common first, at most 150. */
  async locations(signal?: AbortSignal): Promise<string[]> {
    const { jobs } = await fromAll([
      { name: REMOTIVE.name, run: () => this.sources.remotive.jobs("", "", signal) },
      { name: ARBEITNOW.name, run: () => this.sources.arbeitnow.jobs(signal) },
      { name: JOBICY.name, run: () => this.sources.jobicy.jobs({}, signal) },
    ]);
    const counts = new Map<string, number>();
    for (const j of jobs) for (const t of tokens(j.location)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 150).map(([t]) => t);
  }
}
