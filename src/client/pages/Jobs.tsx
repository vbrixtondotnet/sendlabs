import { useMemo, useState } from "react";
import { Button, Card, Empty, Field, FillPage, PageHeader, Pagination, TextInput } from "@/components/ui";
import { MultiSelect } from "@/components/MultiSelect";
import { useToast } from "@/hooks/useToast";
import { HIRING_COMPANIES, JOBS, JOB_CATEGORIES, JOB_LOCATIONS, jobMeta, openPositions, postedAgo, type HiringCompany, type Job } from "@/mock/jobs";

const PAGE_SIZE = 25;

interface Filters { keyword: string; categories: string[]; locations: string[] }
const NONE: Filters = { keyword: "", categories: [], locations: [] };

/** A small caps heading for a panel. */
const PanelTitle = ({ children }: { children: string }) => (
  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{children}</h2>
);

/** One job as a card: title, company, where / what kind / pay, skills, how long ago, and Apply Now. */
function JobCard({ job, onApply }: { job: Job; onApply: () => void }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900" aria-label={`${job.title}, ${job.company}`}>
      <h3 className="text-lg font-medium leading-snug">{job.title}</h3>
      <p className="mt-0.5 text-slate-500 dark:text-slate-400">{job.company}</p>
      <p className="mt-3 text-slate-700 dark:text-slate-200">{jobMeta(job)}</p>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{job.skills.join(" · ")}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">{postedAgo(job.postedHoursAgo)}</p>
        <Button variant="primary" className="cursor-pointer" onClick={onApply} aria-label={`Apply now: ${job.title}`}>Apply Now</Button>
      </div>
    </article>
  );
}

/** One company that is hiring: a coloured banner, its name and industry, a line about it, its open jobs, and View Company. */
function CompanyCard({ company, onView }: { company: HiringCompany; onView: () => void }) {
  const open = openPositions(company.name);
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
        <p className="pt-1 text-sm font-medium">{open} Open {open === 1 ? "Position" : "Positions"}</p>
        <div className="pt-2">
          <Button variant="secondary" className="w-full cursor-pointer" onClick={onView} aria-label={`View ${company.name}`}>View Company</Button>
        </div>
      </div>
    </li>
  );
}

/**
 * Jobs (dummy data for now): the job search on the left (Keyword, Category and Location, then the matching jobs as cards) and the
 * companies that are hiring on the right. Both panels scroll on their own, and the pager sits under the jobs, like every list in
 * the app. A job matches when it has every filter that is set: the keyword in its title, company or skills; ANY chosen category;
 * ANY chosen location. View Company searches that company's jobs.
 */
export function Jobs() {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Filters>(NONE);
  const [applied, setApplied] = useState<Filters>(NONE);
  const [page, setPage] = useState(1);

  const matches = useMemo<Job[]>(() => {
    const k = applied.keyword.trim().toLowerCase();
    return JOBS.filter(
      (j) =>
        (k === "" || j.title.toLowerCase().includes(k) || j.company.toLowerCase().includes(k) || j.skills.some((s) => s.toLowerCase().includes(k))) &&
        (applied.categories.length === 0 || applied.categories.includes(j.category)) &&
        (applied.locations.length === 0 || applied.locations.includes(j.location)),
    );
  }, [applied]);
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = matches.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

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
              <MultiSelect label="Category" options={JOB_CATEGORIES} value={draft.categories} onChange={(categories) => setDraft({ ...draft, categories })} placeholder="Search categories..." />
              <MultiSelect label="Location" options={JOB_LOCATIONS} value={draft.locations} onChange={(locations) => setDraft({ ...draft, locations })} placeholder="Search locations..." />
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary">Search Jobs</Button>
              <Button type="button" variant="secondary" onClick={() => { setDraft(NONE); setApplied(NONE); setPage(1); }}>Reset</Button>
            </div>
          </form>

          <p className="shrink-0 border-b border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300" role="status">
            Showing {matches.length.toLocaleString("en-US")} {matches.length === 1 ? "job" : "jobs"}
          </p>

          <div className="min-h-0 flex-1 overflow-y-auto p-4" role="list" aria-label="Jobs">
            <div className="space-y-3">
              {rows.map((j) => (
                <div role="listitem" key={j.id}>
                  <JobCard job={j} onApply={() => toast(`Applying to "${j.title}" is coming soon.`, "info")} />
                </div>
              ))}
            </div>
            {matches.length === 0 && <Empty>No jobs match your search. Try removing a filter.</Empty>}
          </div>
          {matches.length > 0 && <Pagination page={current} pageCount={pageCount} total={matches.length} pageSize={PAGE_SIZE} onPage={setPage} />}
        </Card>

        <aside aria-label="Hiring Companies" className="flex min-h-[16rem] shrink-0 flex-col lg:min-h-0 lg:w-96">
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-slate-200 px-4 py-3 dark:border-slate-800"><PanelTitle>Hiring Companies</PanelTitle></div>
            <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {HIRING_COMPANIES.map((c) => (
                <CompanyCard key={c.id} company={c} onView={() => viewCompany(c.name)} />
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </FillPage>
  );
}
