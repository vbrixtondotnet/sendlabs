import { useEffect, useMemo, useState } from "react";
import type { JobDto, JobsPageDto } from "@shared/api";
import { ARBEITNOW, REMOTIVE, safeApplyUrl } from "@shared/jobs";
import { JOB_SORTS, type JobSort } from "@shared/schemas";
import { Button, Card, Empty, ErrorNotice, Field, FillPage, Notice, PageHeader, Pagination, Select, TextInput } from "@/components/ui";
import { MultiSelect } from "@/components/MultiSelect";
import { HIRING_COMPANIES, type HiringCompany } from "@/data/hiringCompanies";
import { useDebounced } from "@/hooks/useDebounced";
import { postedAgo } from "@/lib/jobs";
import { useJobCategories, useJobLocations, useJobs, type JobFilters } from "@/services/jobs";

const PAGE_SIZE = 25;
/** How long the keyword must stay unchanged before it is sent: typing a word costs one request, not one per letter. */
const KEYWORD_DEBOUNCE_MS = 600;
const SORT_LABEL: Record<JobSort, string> = { newest: "Newest first", oldest: "Oldest first" };

/** A small caps heading for a panel. */
const PanelTitle = ({ children }: { children: string }) => (
  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{children}</h2>
);

/** One job as a card: title, company, kind / pay, where it can be done from, skills, how long ago, source, and Apply Now. */
function JobCard({ job }: { job: JobDto }) {
  const meta = [job.remote ? "Remote" : job.location || "Location not given", job.employmentType, job.salary].filter(Boolean).join(" · ");
  // Checked again here, before the link is ever drawn: only an https address on a job source's own site can be opened.
  const applyUrl = safeApplyUrl(job.url);
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900" aria-label={`${job.title}, ${job.companyName}`}>
      <div className="flex items-start gap-3">
        {job.companyLogo && <img src={job.companyLogo} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 bg-white object-contain dark:border-slate-700" />}
        <div className="min-w-0">
          <h3 className="text-lg font-medium leading-snug">{job.title}</h3>
          {job.companyName && <p className="mt-0.5 text-slate-500 dark:text-slate-400">{job.companyName}</p>}
        </div>
      </div>
      <p className="mt-3 text-slate-700 dark:text-slate-200">{meta}</p>
      {/* On Remotive the location is where candidates may be; on Arbeitnow it is where the job is (shown in the line above unless the job is remote) */}
      {job.remote && job.location && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{job.source === REMOTIVE.name ? "Candidates from" : "Based in"}: {job.location}</p>}
      {job.skills.length > 0 && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{job.skills.slice(0, 8).join(" · ")}</p>}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {postedAgo(job.publishedAt)}
          {postedAgo(job.publishedAt) && " · "}
          {/* Remotive's terms: name Remotive as the source, and link to the job on Remotive. */}
          via {applyUrl ? <a href={applyUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">{job.source}</a> : job.source}
        </p>
        {applyUrl ? (
          <a
            href={applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Apply now: ${job.title}`}
            className="inline-flex cursor-pointer items-center justify-center rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 hover:shadow"
          >
            Apply Now
          </a>
        ) : (
          <Button variant="primary" disabled aria-label={`Apply now: ${job.title}`}>Apply Now</Button>
        )}
      </div>
    </article>
  );
}

/** A grey stand-in for a job card while the first results load. */
function JobCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-200 p-5 dark:border-slate-800" aria-hidden="true">
      <div className="flex gap-3">
        <div className="h-10 w-10 rounded-lg bg-slate-200 dark:bg-slate-800" />
        <div className="flex-1 space-y-2"><div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-800" /><div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-slate-800" /></div>
      </div>
      <div className="mt-4 h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mt-2 h-3 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mt-4 flex justify-between"><div className="h-3 w-1/4 rounded bg-slate-200 dark:bg-slate-800" /><div className="h-8 w-24 rounded-full bg-slate-200 dark:bg-slate-800" /></div>
    </div>
  );
}

/** One company that is hiring: a coloured banner, its name and industry, a line about it, its open jobs, and View Company. */
function CompanyCard({ company, onView }: { company: HiringCompany; onView: () => void }) {
  return (
    <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="relative flex h-24 items-end p-3" style={{ background: company.banner }} aria-hidden="true">
        <span className="absolute left-3 top-3 rounded-md bg-white/90 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-800">Hiring now</span>
        <span className="text-2xl font-semibold text-white/90">{company.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
      </div>
      <div className="space-y-1 p-4">
        <p className="text-base font-medium leading-snug">{company.name}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">{company.industry}</p>
        <p className="pt-1 text-sm text-slate-700 dark:text-slate-200">{company.blurb}</p>
        <p className="pt-1 text-sm font-medium">{company.openPositions} Open {company.openPositions === 1 ? "Position" : "Positions"}</p>
        <div className="pt-2">
          <Button variant="secondary" className="w-full cursor-pointer" onClick={onView} aria-label={`View ${company.name}`}>View Company</Button>
        </div>
      </div>
    </li>
  );
}

/**
 * Jobs: live from Remotive, through our server (the browser never calls Remotive, and nothing is saved). The job search on the left
 * (Keyword, Category, Location, Remote only) and the companies that are hiring on the right. Keyword is sent after you stop typing;
 * the other filters apply as soon as you change them; Search Jobs sends the keyword at once. While a search runs, or if it fails, the
 * jobs already on screen stay. Both panels scroll on their own and the pager sits under the jobs, like every list in the app.
 * The Hiring Companies panel is a fixed list that does not depend on the results.
 */
export function Jobs() {
  const [draft, setDraft] = useState({ keyword: "", category: "", locations: [] as string[], remoteOnly: false, sort: "newest" as JobSort });
  const [keyword, setKeyword] = useState(""); // the keyword that is actually being searched
  const [page, setPage] = useState(1);

  const typed = useDebounced(draft.keyword.trim(), KEYWORD_DEBOUNCE_MS);
  useEffect(() => { setKeyword(typed); setPage(1); }, [typed]);

  const filters = useMemo<JobFilters>(() => ({ keyword, category: draft.category, locations: draft.locations, remoteOnly: draft.remoteOnly, sort: draft.sort }), [keyword, draft.category, draft.locations, draft.remoteOnly, draft.sort]);
  const jobs = useJobs(filters, page, PAGE_SIZE);
  const categories = useJobCategories();
  const locations = useJobLocations();

  // The last results that loaded. A failed refresh must not wipe what the person is looking at.
  const [lastGood, setLastGood] = useState<JobsPageDto | null>(null);
  useEffect(() => { if (jobs.data && !jobs.isPlaceholderData) setLastGood(jobs.data); }, [jobs.data, jobs.isPlaceholderData]);
  const data = jobs.data ?? lastGood;

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = keyword !== "" || draft.category !== "" || draft.locations.length > 0 || draft.remoteOnly;
  const change = (patch: Partial<typeof draft>) => { setDraft((d) => ({ ...d, ...patch })); setPage(1); };

  return (
    <FillPage>
      <PageHeader title="Find Your Next Opportunity" description="Discover remote jobs, freelance projects, and opportunities." />

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="flex min-h-[28rem] min-w-0 flex-1 flex-col lg:min-h-0">
          {/* relative + z-20: the open Location list drops down over the jobs below */}
          <form
            onSubmit={(e) => { e.preventDefault(); setKeyword(draft.keyword.trim()); setPage(1); }}
            aria-label="Job search"
            className="relative z-20 shrink-0 space-y-3 border-b border-slate-200 p-4 dark:border-slate-800"
          >
            <PanelTitle>Job search</PanelTitle>
            <div className="grid items-start gap-3 sm:grid-cols-3">
              <Field label="Keyword" htmlFor="job-keyword">
                <TextInput id="job-keyword" placeholder="Title, company or skill" value={draft.keyword} onChange={(e) => setDraft((d) => ({ ...d, keyword: e.target.value }))} />
              </Field>
              <Field label="Category" htmlFor="job-category">
                <Select id="job-category" value={draft.category} onChange={(e) => change({ category: e.target.value })}>
                  <option value="">All categories</option>
                  {categories.data?.items.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </Select>
              </Field>
              <MultiSelect label="Location" options={locations.data?.items ?? []} value={draft.locations} onChange={(l) => change({ locations: l })} placeholder="Search locations..." />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary">Search Jobs</Button>
              <Button type="button" variant="secondary" onClick={() => { setDraft({ keyword: "", category: "", locations: [], remoteOnly: false, sort: "newest" }); setKeyword(""); setPage(1); }}>Reset</Button>
              <label className="ml-1 inline-flex cursor-pointer items-center gap-2 text-sm" title="Only jobs that can be done remotely">
                <input type="checkbox" checked={draft.remoteOnly} onChange={(e) => change({ remoteOnly: e.target.checked })} className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-600" />
                Remote only
              </label>
            </div>
          </form>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
            <p>{data ? `Showing ${total.toLocaleString("en-US")} ${total === 1 ? "job" : "jobs"}` : " "}{jobs.isFetching && data ? " · updating…" : ""}</p>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2">
                <span className="sr-only">Sort by</span>
                <Select aria-label="Sort by publication date" className="!w-auto !py-1 text-sm" value={draft.sort} onChange={(e) => change({ sort: e.target.value as JobSort })}>
                  {JOB_SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
                </Select>
              </label>
              <span>
                Jobs from{" "}
                <a href={REMOTIVE.homepage} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">{REMOTIVE.name}</a>
                {" and "}
                <a href={ARBEITNOW.homepage} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">{ARBEITNOW.name}</a>
              </span>
            </div>
          </div>

          {jobs.isError && !data ? (
            <div className="p-4"><ErrorNotice error={jobs.error} onRetry={() => void jobs.refetch()} /></div>
          ) : !data ? (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-label="Loading jobs" role="status">
              {[0, 1, 2, 3].map((i) => <JobCardSkeleton key={i} />)}
            </div>
          ) : (
            <>
              {data.unavailable.length > 0 && !jobs.isError && (
                <div className="shrink-0 px-4 pt-3">
                  <Notice tone="warn" title={`${data.unavailable.join(" and ")} could not be reached`}>
                    Showing the jobs from the other source for now.{" "}
                    <button type="button" className="cursor-pointer font-medium underline" onClick={() => void jobs.refetch()}>Try again</button>
                  </Notice>
                </div>
              )}
              {jobs.isError && (
                <div className="shrink-0 px-4 pt-3">
                  <Notice tone="warn" title="Could not refresh the jobs">
                    The jobs below are the ones loaded before.{" "}
                    <button type="button" className="cursor-pointer font-medium underline" onClick={() => void jobs.refetch()}>Try again</button>
                  </Notice>
                </div>
              )}
              <div className={`min-h-0 flex-1 overflow-y-auto p-4 transition-opacity ${jobs.isPlaceholderData ? "opacity-60" : ""}`} role="list" aria-label="Jobs">
                <div className="space-y-3">
                  {data.items.map((j) => (
                    <div role="listitem" key={j.id}><JobCard job={j} /></div>
                  ))}
                </div>
                {total === 0 && <Empty>{filtered ? "No jobs match your filters. Try removing one." : "No jobs are available right now."}</Empty>}
              </div>
              {total > 0 && <Pagination page={page} pageCount={pageCount} total={total} pageSize={PAGE_SIZE} onPage={setPage} />}
            </>
          )}
        </Card>

        <aside aria-label="Hiring Companies" className="flex min-h-[16rem] shrink-0 flex-col lg:min-h-0 lg:w-96">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-slate-200 px-4 py-3 dark:border-slate-800"><PanelTitle>Hiring Companies</PanelTitle></div>
            <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {HIRING_COMPANIES.map((c) => (
                <CompanyCard key={c.id} company={c} onView={() => { setDraft((d) => ({ ...d, keyword: c.name })); setKeyword(c.name); setPage(1); }} />
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </FillPage>
  );
}
