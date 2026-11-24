import { useState } from "react";
import type { JobCompanyDto, JobDto } from "@shared/api";
import { REMOTIVE } from "@shared/jobs";
import { Button, Card, Empty, ErrorNotice, Field, FillPage, LoadingRows, PageHeader, Pagination, TextInput } from "@/components/ui";
import { MultiSelect } from "@/components/MultiSelect";
import { bannerFor, postedAgo } from "@/lib/jobs";
import { useJobCategories, useJobCompanies, useJobLocations, useJobs, type JobFilters } from "@/services/jobs";

const PAGE_SIZE = 25;
const NONE: JobFilters = { keyword: "", categories: [], locations: [] };

/** A small caps heading for a panel. */
const PanelTitle = ({ children }: { children: string }) => (
  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{children}</h2>
);

/** One job as a card: title, company, kind / pay, where it can be done from, skills, how long ago, source, and Apply Now. */
function JobCard({ job }: { job: JobDto }) {
  const meta = ["Remote", job.employmentType, job.salary].filter(Boolean).join(" · ");
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900" aria-label={`${job.title}, ${job.companyName}`}>
      <div className="flex items-start gap-3">
        {job.companyLogo && <img src={job.companyLogo} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 bg-white object-contain dark:border-slate-700" />}
        <div className="min-w-0">
          <h3 className="text-lg font-medium leading-snug">{job.title}</h3>
          <p className="mt-0.5 text-slate-500 dark:text-slate-400">{job.companyName}</p>
        </div>
      </div>
      <p className="mt-3 text-slate-700 dark:text-slate-200">{meta}</p>
      {job.location && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Candidates from: {job.location}</p>}
      {job.skills.length > 0 && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{job.skills.slice(0, 8).join(" · ")}</p>}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {postedAgo(job.publishedAt)}
          {/* Remotive's terms: name Remotive as the source, and link to the job on Remotive. */}
          {job.url ? <> · via <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">{job.source}</a></> : <> · via {job.source}</>}
        </p>
        {job.url ? (
          <a
            href={job.url}
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

/** One company that is hiring: a coloured banner with its logo, its name and category, its open jobs, and View Company. */
function CompanyCard({ company, onView }: { company: JobCompanyDto; onView: () => void }) {
  return (
    <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="relative flex h-24 items-end justify-end p-3" style={{ background: bannerFor(company.name) }} aria-hidden="true">
        <span className="absolute left-3 top-3 rounded-md bg-white/90 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-800">Hiring now</span>
        {company.logo ? (
          <img src={company.logo} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-12 w-12 rounded-lg bg-white object-contain p-1 shadow" />
        ) : (
          <span className="text-2xl font-semibold text-white/90">{company.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
        )}
      </div>
      <div className="space-y-1 p-4">
        <p className="text-base font-medium leading-snug">{company.name}</p>
        {company.category && <p className="text-sm text-slate-500 dark:text-slate-400">{company.category}</p>}
        <p className="pt-1 text-sm font-medium">{company.openPositions} Open {company.openPositions === 1 ? "Position" : "Positions"}</p>
        <div className="pt-2">
          <Button variant="secondary" className="w-full cursor-pointer" onClick={onView} aria-label={`View ${company.name}`}>View Company</Button>
        </div>
      </div>
    </li>
  );
}

/**
 * Jobs: the job search on the left (Keyword, Category and Location, then the matching jobs as cards) and the companies that are
 * hiring on the right. The jobs come from our own database (kept in step with Remotive by the server), the server filters and
 * pages them, and both panels scroll on their own with the pager under the jobs, like every list in the app. A job matches when it
 * has every filter that is set: the keyword in its title, company or skills; ANY chosen category; ANY chosen location.
 * View Company searches that company's jobs. Remotive is named, and linked, on every job (its terms ask for that).
 */
export function Jobs() {
  const [draft, setDraft] = useState<JobFilters>(NONE);
  const [applied, setApplied] = useState<JobFilters>(NONE);
  const [page, setPage] = useState(1);

  const jobs = useJobs(applied, page, PAGE_SIZE);
  const categories = useJobCategories();
  const locations = useJobLocations();
  const companies = useJobCompanies();
  const total = jobs.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = applied.keyword.trim() !== "" || applied.categories.length > 0 || applied.locations.length > 0;

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setApplied(draft);
    setPage(1);
  };
  const viewCompany = (name: string) => {
    const next = { ...NONE, keyword: name };
    setDraft(next);
    setApplied(next);
    setPage(1);
  };

  return (
    <FillPage>
      <PageHeader title="Find Your Next Opportunity" description="Discover remote jobs, freelance projects, and opportunities." />

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="flex min-h-[28rem] min-w-0 flex-1 flex-col lg:min-h-0">
          {/* relative + z-20: the open Category / Location lists drop down over the jobs below */}
          <form onSubmit={apply} aria-label="Job search" className="relative z-20 shrink-0 space-y-3 border-b border-slate-200 p-4 dark:border-slate-800">
            <PanelTitle>Job search</PanelTitle>
            <div className="grid items-start gap-3 sm:grid-cols-3">
              <Field label="Keyword" htmlFor="job-keyword">
                <TextInput id="job-keyword" placeholder="Title, company or skill" value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} />
              </Field>
              <MultiSelect label="Category" options={categories.data?.items ?? []} value={draft.categories} onChange={(c) => setDraft({ ...draft, categories: c })} placeholder="Search categories..." />
              <MultiSelect label="Location" options={locations.data?.items ?? []} value={draft.locations} onChange={(l) => setDraft({ ...draft, locations: l })} placeholder="Search locations..." />
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary">Search Jobs</Button>
              <Button type="button" variant="secondary" onClick={() => { setDraft(NONE); setApplied(NONE); setPage(1); }}>Reset</Button>
            </div>
          </form>

          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
            <p>{jobs.data ? `Showing ${total.toLocaleString("en-US")} ${total === 1 ? "job" : "jobs"}` : " "}</p>
            <a href={REMOTIVE.homepage} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">Remote jobs from {REMOTIVE.name}</a>
          </div>

          {jobs.isError ? (
            <div className="p-4"><ErrorNotice error={jobs.error} onRetry={() => void jobs.refetch()} /></div>
          ) : jobs.isPending ? (
            <div className="min-h-0 flex-1 overflow-auto"><LoadingRows cols={1} rows={5} /></div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto p-4" role="list" aria-label="Jobs">
                <div className="space-y-3">
                  {jobs.data.items.map((j) => (
                    <div role="listitem" key={j.id}><JobCard job={j} /></div>
                  ))}
                </div>
                {total === 0 && <Empty>{filtered ? "No jobs match your search. Try removing a filter." : "No jobs yet. They are loaded from Remotive every few hours."}</Empty>}
              </div>
              {total > 0 && <Pagination page={page} pageCount={pageCount} total={total} pageSize={PAGE_SIZE} onPage={setPage} />}
            </>
          )}
        </Card>

        <aside aria-label="Hiring Companies" className="flex min-h-[16rem] shrink-0 flex-col lg:min-h-0 lg:w-96">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-slate-200 px-4 py-3 dark:border-slate-800"><PanelTitle>Hiring Companies</PanelTitle></div>
            {companies.isError ? (
              <div className="p-3"><ErrorNotice error={companies.error} onRetry={() => void companies.refetch()} /></div>
            ) : companies.isPending ? (
              <div className="min-h-0 flex-1 overflow-auto"><LoadingRows cols={1} rows={3} /></div>
            ) : companies.data.items.length === 0 ? (
              <Empty>No companies yet.</Empty>
            ) : (
              <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                {companies.data.items.map((c) => <CompanyCard key={c.name} company={c} onView={() => viewCompany(c.name)} />)}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </FillPage>
  );
}
