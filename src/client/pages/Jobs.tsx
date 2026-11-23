import { useMemo, useState } from "react";
import { Button, Card, Empty, FillPage, PageHeader, Pagination, TableCard } from "@/components/ui";
import { MultiSelect } from "@/components/MultiSelect";
import { useToast } from "@/hooks/useToast";
import { JOBS, JOB_CATEGORIES, JOB_LOCATIONS, postedAgo, type Job } from "@/mock/jobs";

const PAGE_SIZE = 25;

interface Filters { categories: string[]; locations: string[] }
const NONE: Filters = { categories: [], locations: [] };

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12v18l-6-4-6 4V3z" />
    </svg>
  );
}

/** One job as a card: title, company, a fit label, the kind of job, where, how long ago, and Save / Hide. */
function JobCard({ job, saved, onSave, onHide }: { job: Job; saved: boolean; onSave: () => void; onHide: () => void }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900" aria-label={`${job.title}, ${job.company}`}>
      <h2 className="text-lg font-medium leading-snug">{job.title}</h2>
      <p className="mt-0.5 text-base text-slate-500 dark:text-slate-400">{job.company}</p>

      {job.match && (
        <p className="mt-3 inline-block rounded-lg bg-purple-100 px-3 py-1 text-sm font-semibold text-purple-800 dark:bg-purple-950 dark:text-purple-300">{job.match}</p>
      )}

      <div className="mt-3 space-y-0.5 text-slate-600 dark:text-slate-300">
        <p>{job.type}</p>
        <p>{job.location}{job.remote && <span>{"  "}(Remote)</span>}</p>
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">{postedAgo(job.postedDaysAgo)}</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onSave}
            aria-pressed={saved}
            aria-label={saved ? `Unsave ${job.title}` : `Save ${job.title}`}
            className={`cursor-pointer rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800 ${saved ? "text-brand-600 dark:text-brand-400" : "text-slate-700 dark:text-slate-300"}`}
          >
            <BookmarkIcon filled={saved} />
          </button>
          <button
            type="button"
            onClick={onHide}
            aria-label={`Hide ${job.title}`}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full px-3 py-2 font-medium text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            Hide
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * Jobs (dummy data for now): a list of job cards, with a Category and a Location filter. The cards scroll on their own inside the
 * page and the pager sits under them, like every list in the app. Both filters take several values; a job matches when it is
 * in ANY chosen category and ANY chosen location, and an empty filter is not applied. Save (bookmark) and Hide work in this
 * browser session only, until jobs come from the server.
 */
export function Jobs() {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Filters>(NONE);
  const [applied, setApplied] = useState<Filters>(NONE);
  const [page, setPage] = useState(1);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  const matches = useMemo<Job[]>(
    () =>
      JOBS.filter(
        (j) =>
          (applied.categories.length === 0 || applied.categories.includes(j.category)) &&
          (applied.locations.length === 0 || applied.locations.includes(j.location)) &&
          (showHidden || !hidden.has(j.id)),
      ),
    [applied, hidden, showHidden],
  );
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = matches.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const toggle = (set: ReadonlySet<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };
  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setApplied(draft);
    setPage(1);
  };
  const reset = () => {
    setDraft(NONE);
    setApplied(NONE);
    setPage(1);
  };
  const hide = (job: Job) => {
    setHidden((h) => toggle(h, job.id));
    toast(`"${job.title}" hidden`, "info");
  };

  return (
    <FillPage>
      <PageHeader title="Jobs" description="Browse jobs by category and location." />

      {/* relative + z-20: the open lists drop down over the cards below */}
      <Card className="relative z-20 mb-3 shrink-0">
        <form onSubmit={apply} aria-label="Filter jobs" className="grid items-start gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <MultiSelect label="Category" options={JOB_CATEGORIES} value={draft.categories} onChange={(categories) => setDraft({ ...draft, categories })} placeholder="Search categories..." />
          <MultiSelect label="Location" options={JOB_LOCATIONS} value={draft.locations} onChange={(locations) => setDraft({ ...draft, locations })} placeholder="Search locations..." />
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1 lg:mt-[1.625rem]">
            <Button type="submit" variant="primary" className="flex-1">Search</Button>
            <Button type="button" variant="secondary" onClick={reset}>Reset</Button>
          </div>
        </form>
      </Card>

      <TableCard>
        {hidden.size > 0 && (
          <div className="flex shrink-0 items-center justify-end border-b border-slate-200 px-4 py-1.5 text-sm dark:border-slate-800">
            <button type="button" onClick={() => setShowHidden((v) => !v)} className="cursor-pointer rounded-full px-3 py-1 font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-800">
              {showHidden ? "Don't show hidden jobs" : `Show hidden jobs (${hidden.size})`}
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-4" role="list" aria-label="Jobs">
          <div className="max-w-4xl space-y-3">
            {rows.map((j) => (
              <div role="listitem" key={j.id} className={hidden.has(j.id) ? "opacity-50" : undefined}>
                <JobCard job={j} saved={saved.has(j.id)} onSave={() => setSaved((s) => toggle(s, j.id))} onHide={() => hide(j)} />
              </div>
            ))}
          </div>
          {matches.length === 0 && <Empty>No jobs match these filters. Try removing one.</Empty>}
        </div>
        {matches.length > 0 && <Pagination page={current} pageCount={pageCount} total={matches.length} pageSize={PAGE_SIZE} onPage={setPage} />}
      </TableCard>
    </FillPage>
  );
}
