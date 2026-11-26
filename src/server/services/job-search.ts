import type { HiringCompaniesDto, JobCategoryDto, JobDescriptionBlock, JobDto, JobsPageDto } from "../../shared/api";
import { ARBEITNOW, HIMALAYAS, JOBICY, JOOBLE, PINNED_LOCATIONS, REMOTIVE } from "../../shared/jobs";
import type { JobListQuery } from "../../shared/schemas";
import { JobSourceError } from "../lib/live-fetch";
import { ArbeitnowJobService } from "./arbeitnow-jobs";
import { HimalayasJobService, MAX_COUNTRIES, type HimalayasFilter } from "./himalayas-jobs";
import { JobicyJobService, MAX_GEOS, type JobicyFilter } from "./jobicy-jobs";
import { JoobleJobService, MAX_LOCATIONS, type JoobleFilter } from "./jooble-jobs";
import { RemotiveJobService } from "./remotive-jobs";

/**
 * The Jobs page's one source of jobs: Remotive, Arbeitnow, Jobicy, Himalayas and (with a key) Jooble, live, side by side, merged into a single list. Nothing is stored.
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
  himalayas: HimalayasJobService;
  /** Only when JOOBLE_API_KEY is set. */
  jooble?: JoobleJobService;
}

export function jobSources(doFetch: typeof fetch, keys: { joobleApiKey?: string | undefined } = {}): JobSources {
  return {
    remotive: new RemotiveJobService({ fetch: doFetch }),
    arbeitnow: new ArbeitnowJobService({ fetch: doFetch }),
    jobicy: new JobicyJobService({ fetch: doFetch }),
    himalayas: new HimalayasJobService({ fetch: doFetch }),
    ...(keys.joobleApiKey?.trim() ? { jooble: new JoobleJobService({ fetch: doFetch, apiKey: keys.joobleApiKey.trim() }) } : {}),
  };
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

  /** What Himalayas is asked for: the words (or the chosen category, which its search also understands) as `q`, each chosen place as `country`. */
  private himalayasFilter(q: JobListQuery): HimalayasFilter {
    const filter: HimalayasFilter = {};
    const words = q.keyword || q.category;
    if (words) filter.keyword = words;
    if (q.locations.length > 0) filter.countries = q.locations.slice(0, MAX_COUNTRIES);
    return filter;
  }

  /** What Jooble is asked for: the words and each chosen place. Jooble has no categories, so a chosen category skips it. */
  private joobleFilter(q: JobListQuery): JoobleFilter {
    const filter: JoobleFilter = {};
    if (q.keyword) filter.keyword = q.keyword;
    if (q.locations.length > 0) filter.locations = q.locations.slice(0, MAX_LOCATIONS);
    return filter;
  }

  /**
   * One page of jobs for the filters. The page's filters are sent to the sources that can use them: the keyword goes to Remotive as
   * `search` and to Jobicy as `tag`; the category goes to Remotive as `category` (when it is one of Remotive's) and to Jobicy as
   * `industry` (when it is one of Jobicy's); chosen places go to Jobicy as `geo`, to Himalayas as `country` and to Jooble as `location`; Himalayas
   * and Jooble also get the keyword (as `q` and `keywords`). Arbeitnow cannot filter (it ignores every parameter),
   * so its list is kept whole. Everything is then re-checked here on the merged list; Location, Remote only, sort and paging are
   * applied here too. `signal` is the caller's: if it aborts the wait ends at once.
   */
  async list(q: JobListQuery, signal?: AbortSignal): Promise<JobsPageDto> {
    const { matching, unavailable } = await this.search(q, signal);
    const wantedCompany = normalize(q.company ?? "");
    const shown = wantedCompany ? matching.filter((j) => normalize(j.companyName) === wantedCompany) : matching;
    const start = (q.page - 1) * q.pageSize;
    return { items: shown.slice(start, start + q.pageSize), page: q.page, pageSize: q.pageSize, total: shown.length, unavailable };
  }

  /**
   * The companies hiring in the current search's results (the same filters as the list, but not the company filter itself, so the
   * panel keeps offering the others): each with how many of those jobs are its own, so "12 open positions" is the 12 jobs View
   * Company then shows. Busiest first, at most 30.
   */
  async companies(q: JobListQuery, signal?: AbortSignal): Promise<HiringCompaniesDto> {
    const { matching, unavailable } = await this.search(q, signal);
    const groups = new Map<string, JobDto[]>();
    for (const j of matching) {
      const key = normalize(j.companyName);
      if (key === "") continue;
      const g = groups.get(key);
      if (g) g.push(j); else groups.set(key, [j]);
    }
    const mostCommon = (values: string[]) => {
      const counts = new Map<string, number>();
      for (const v of values.filter(Boolean)) counts.set(v, (counts.get(v) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
    };
    const all = [...groups.values()].map((jobs) => ({
      name: mostCommon(jobs.map((j) => j.companyName)),
      logo: jobs.find((j) => j.companyLogo)?.companyLogo ?? "",
      industry: mostCommon(jobs.map((j) => j.category)),
      openPositions: jobs.length,
      sampleTitles: [...new Set(jobs.map((j) => j.title))].slice(0, 2),
    }));
    all.sort((a, b) => b.openPositions - a.openPositions || a.name.localeCompare(b.name));
    return { items: all.slice(0, 30), total: all.length, unavailable };
  }

  /** Every job that matches the keyword, category, locations and Remote only, newest (or oldest) first. Not paged, and not cut to a company. */
  private async search(q: JobListQuery, signal?: AbortSignal): Promise<{ matching: JobDto[]; unavailable: string[] }> {
    const categories = await this.categories(signal).catch(() => [] as (JobCategoryDto & { remotive: boolean })[]);
    const chosen = categories.find((c) => c.value === q.category);
    const remotiveCategory = chosen?.remotive ? chosen.value : "";
    const jobicyFilter = await this.jobicyFilter(q, signal);
    const { jobs, unavailable } = await fromAll([
      { name: REMOTIVE.name, run: () => this.sources.remotive.jobs(q.keyword ?? "", remotiveCategory, signal) },
      { name: ARBEITNOW.name, run: () => this.sources.arbeitnow.jobs(signal) },
      { name: JOBICY.name, run: () => this.sources.jobicy.jobs(jobicyFilter, signal) },
      { name: HIMALAYAS.name, run: () => this.sources.himalayas.jobs(this.himalayasFilter(q), signal) },
      ...(this.sources.jooble && !q.category ? [{ name: JOOBLE.name, run: () => this.sources.jooble!.jobs(this.joobleFilter(q), signal) }] : []),
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
    return { matching, unavailable };
  }

  /**
   * The choices of the Category filter: Remotive's own categories, then the topics Arbeitnow and Jobicy use that Remotive does not (the same
   * name is listed once). Their topics are free text, so only those on at least 3 jobs are offered, at most 30.
   * `remotive` marks the ones Remotive's API understands.
   */
  async categories(signal?: AbortSignal): Promise<(JobCategoryDto & { remotive: boolean })[]> {
    const [theirs, arbeit, jobicy, himalayas] = await Promise.all([
      this.sources.remotive.categories(signal).catch((e) => { if (e instanceof JobSourceError && e.kind === "aborted") throw e; return [] as JobCategoryDto[]; }),
      this.sources.arbeitnow.jobs(signal).catch((e) => { if (e instanceof JobSourceError && e.kind === "aborted") throw e; return [] as JobDto[]; }),
      this.sources.jobicy.jobs({}, signal).catch((e) => { if (e instanceof JobSourceError && e.kind === "aborted") throw e; return [] as JobDto[]; }),
      this.sources.himalayas.jobs({}, signal).catch((e) => { if (e instanceof JobSourceError && e.kind === "aborted") throw e; return [] as JobDto[]; }),
    ]);
    const jobs = [...arbeit, ...jobicy];
    const industries = (await this.sources.jobicy.reference(signal)).industries;
    if (theirs.length === 0 && jobs.length === 0 && himalayas.length === 0) throw new JobSourceError("Jobs", "network", "No job source could be reached");
    const out: (JobCategoryDto & { remotive: boolean })[] = theirs.map((c) => ({ ...c, remotive: true }));
    const known = new Set(theirs.flatMap((c) => [normalize(c.value), normalize(c.label)]));
    const counts = new Map<string, number>();
    for (const j of jobs) for (const t of j.skills) counts.set(t, (counts.get(t) ?? 0) + 1);
    // Himalayas tags each job with a dozen fine topics; only its broad category per job is counted, so it does not crowd out the rest.
    for (const j of himalayas) if (j.category) counts.set(j.category, (counts.get(j.category) ?? 0) + 1);
    for (const [name] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).filter(([, n]) => n >= MIN_TOPIC_JOBS).slice(0, 30)) {
      if (!known.has(normalize(name))) { known.add(normalize(name)); out.push({ value: name, label: name, remotive: false }); }
    }
    // All of Jobicy's industries are offered (choosing one asks Jobicy for exactly that industry).
    for (const i of industries) if (!known.has(normalize(i.name))) { known.add(normalize(i.name)); out.push({ value: i.name, label: i.name, remotive: false }); }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * The description of one job, from the source its id names ("remotive:123", "arbeitnow:some-slug", "jobicy:456", "himalayas:companies/acme/jobs/va", "jooble:ab12"), as plain text blocks. Null when
   * the id is not one of ours or the source no longer lists the job.
   */
  async description(id: string, signal?: AbortSignal): Promise<JobDescriptionBlock[] | null> {
    if (id.startsWith("remotive:")) return this.sources.remotive.description(id, signal);
    if (id.startsWith("arbeitnow:")) return this.sources.arbeitnow.description(id, signal);
    if (id.startsWith("jobicy:")) return this.sources.jobicy.description(id, signal);
    if (id.startsWith("himalayas:")) return this.sources.himalayas.description(id, signal);
    if (id.startsWith("jooble:")) return this.sources.jooble ? this.sources.jooble.description(id, signal) : null;
    return null;
  }

  /** The choices of the Location filter: the places the jobs name (every source), most common first, at most 150, plus the pinned places (Philippines, India), which are always offered. */
  async locations(signal?: AbortSignal): Promise<string[]> {
    const { jobs } = await fromAll([
      { name: REMOTIVE.name, run: () => this.sources.remotive.jobs("", "", signal) },
      { name: ARBEITNOW.name, run: () => this.sources.arbeitnow.jobs(signal) },
      { name: JOBICY.name, run: () => this.sources.jobicy.jobs({}, signal) },
      { name: HIMALAYAS.name, run: () => this.sources.himalayas.jobs({}, signal) },
      ...(this.sources.jooble ? [{ name: JOOBLE.name, run: () => this.sources.jooble!.jobs({}, signal) }] : []),
    ]);
    const counts = new Map<string, number>();
    for (const j of jobs) for (const t of tokens(j.location)) counts.set(t, (counts.get(t) ?? 0) + 1);
    const common = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 150).map(([t]) => t);
    // The pinned places are always there (appended when the jobs on screen do not name them), compared ignoring case.
    const have = new Set(common.map((t) => t.toLowerCase()));
    return [...common, ...PINNED_LOCATIONS.filter((p) => !have.has(p.toLowerCase()))];
  }
}
