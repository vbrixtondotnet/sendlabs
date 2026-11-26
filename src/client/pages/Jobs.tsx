import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { HiringCompanyDto, JobDto, JobsPageDto } from "@shared/api";
import { CANDIDATE_LOCATION_SOURCES, shortLocation } from "@shared/jobs";
import { COMPANY_CONTACT_COST } from "@shared/credits";
import { JOB_SORTS, type JobSort } from "@shared/schemas";
import { Button, Card, Empty, ErrorNotice, FillPage, Notice, PageHeader, Pagination, Select } from "@/components/ui";
import { JobApplyPanel } from "@/components/panels/JobApplyPanel";
import { ShareJob } from "@/components/ShareJob";
import { JobDetailsPanel } from "@/components/panels/JobDetailsPanel";
import { useToast } from "@/hooks/useToast";
import { postedAgo } from "@/lib/jobs";
import { ApiClientError } from "@/services/http";
import { useMe } from "@/services/me";
import { useAddCompanyContact, useHiringCompanies, useJobs, type JobFilters } from "@/services/jobs";

const PAGE_SIZE = 25;
const SORT_LABEL: Record<JobSort, string> = { newest: "Newest first", oldest: "Oldest first" };

/** A small caps heading for a panel. */
const PanelTitle = ({ children }: { children: string }) => (
  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{children}</h2>
);

/** One job as a card: title, company, kind / pay, where it can be done from, skills, how long ago, and View Job (the description panel) and Apply Now (the email panel). */
function JobCard({ job, onView, onApply }: { job: JobDto; onView: () => void; onApply: () => void }) {
  const meta = [job.remote ? "Remote" : job.location || "Location not given", job.employmentType, job.salary].filter(Boolean).join(" · ");
  return (
    <article className="rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900" aria-label={`${job.title}, ${job.companyName}`}>
      <div className="flex items-start gap-3">
        {job.companyLogo && <img src={job.companyLogo} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-lg border border-slate-200 bg-white object-contain dark:border-slate-700" />}
        <div className="min-w-0">
          <h3 className="text-base font-medium leading-snug">{job.title}</h3>
          {job.companyName && <p className="text-sm text-slate-500 dark:text-slate-400">{job.companyName}</p>}
        </div>
      </div>
      <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-200">{meta}</p>
      {/* On Remotive and Jobicy the location is where candidates may be; on Arbeitnow it is where the job is (shown in the line above unless the job is remote) */}
      {job.remote && job.location && <p className="text-xs text-slate-500 dark:text-slate-400">{CANDIDATE_LOCATION_SOURCES.includes(job.source) ? "Candidates from" : "Based in"}: {shortLocation(job.location)}</p>}
      {job.skills.length > 0 && <p className="mt-1 truncate text-xs text-slate-600 dark:text-slate-300">{job.skills.slice(0, 8).join(" · ")}</p>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        {/* Only how long ago. The source is named, and linked to, in the View Job panel. */}
        <p className="text-xs text-slate-500 dark:text-slate-400">{postedAgo(job.publishedAt)}</p>
        <ShareJob job={job} />
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" className="cursor-pointer !px-3 !py-1 text-sm" onClick={onView} aria-label={`View job: ${job.title}`}>View Job</Button>
          <Button variant="primary" className="cursor-pointer !px-3 !py-1 text-sm" onClick={onApply} aria-label={`Apply now: ${job.title}`}>Apply Now</Button>
        </div>
      </div>
    </article>
  );
}

/** A grey stand-in for a job card while the first results load. */
function JobCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-800" aria-hidden="true">
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

const BANNERS = [
  "linear-gradient(135deg,#0ea5b7,#0b3b5a)", "linear-gradient(135deg,#7c3aed,#312e81)", "linear-gradient(135deg,#2563eb,#0f172a)", "linear-gradient(135deg,#f97316,#7c2d12)",
  "linear-gradient(135deg,#06b6d4,#164e63)", "linear-gradient(135deg,#22c55e,#14532d)", "linear-gradient(135deg,#ef4444,#7f1d1d)", "linear-gradient(135deg,#64748b,#0f172a)",
  "linear-gradient(135deg,#ec4899,#701a75)", "linear-gradient(135deg,#eab308,#713f12)",
];
/** The same company always gets the same banner colour. */
const bannerFor = (name: string) => BANNERS[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % BANNERS.length]!;

/** What the "Add to Contacts" button of one card is doing. */
type AddState = { status: "idle" | "adding" | "added" | "none" | "error"; message?: string };

/**
 * One company that is hiring in the current search, kept short so more fit on screen: a small badge (its logo or initials), its name,
 * its category and job count, a line of job titles, and two buttons. "Show All Jobs" narrows the job list to this company (so the number
 * on the card is the number shown); "Add to Contacts" finds the company's contact person and adds them to your contacts for 1 credit,
 * only when one is found.
 */
function CompanyCard({ company, selected, add, canAdd, onShow, onClear, onAdd }: {
  company: HiringCompanyDto;
  selected: boolean;
  add: AddState;
  /** False when the account has no credit left. */
  canAdd: boolean;
  onShow: () => void;
  onClear: () => void;
  onAdd: () => void;
}) {
  const n = company.openPositions;
  const adding = add.status === "adding";
  const added = add.status === "added";
  return (
    <li className={`rounded-xl border bg-white p-3 dark:bg-slate-900 ${selected ? "border-brand-500 ring-2 ring-brand-500/30" : "border-slate-200 dark:border-slate-800"}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-semibold text-white" style={{ background: bannerFor(company.name) }} aria-hidden="true">
          {company.logo ? <img src={company.logo} alt="" className="h-full w-full bg-white object-contain p-0.5" loading="lazy" referrerPolicy="no-referrer" /> : company.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-snug" title={company.name}>{company.name}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {company.industry ? `${company.industry} \u00b7 ` : ""}<span className="font-medium text-slate-700 dark:text-slate-200">{n} Open {n === 1 ? "Position" : "Positions"}</span>
          </p>
          {company.sampleTitles.length > 0 && <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={company.sampleTitles.join(" \u00b7 ")}>{company.sampleTitles.join(" \u00b7 ")}</p>}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {selected ? (
          <Button variant="secondary" className="cursor-pointer !px-2 !py-1 text-xs" onClick={onClear} aria-label={`Show all jobs, not only ${company.name}`}>Clear Filter</Button>
        ) : (
          <Button variant="secondary" className="cursor-pointer !px-2 !py-1 text-xs" onClick={onShow} aria-label={`Show all jobs at ${company.name}`}>Show All Jobs</Button>
        )}
        <Button
          variant="primary"
          className="cursor-pointer !px-2 !py-1 text-xs"
          onClick={onAdd}
          disabled={adding || added || !canAdd}
          aria-label={`Add the contact of ${company.name} to your contacts`}
          title={!canAdd && !added ? "You need 1 credit" : added ? "Already in your contacts" : "Costs 1 credit, only when a contact is found"}
        >
          {adding ? "Adding\u2026" : added ? "Added \u2713" : "Add to Contacts"}
        </Button>
      </div>
      {(add.status === "none" || add.status === "error") && <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400" role="status">{add.message}</p>}
    </li>
  );
}

/**
 * Jobs: live from Remotive, through our server (the browser never calls Remotive, and nothing is saved). The job search on the left
 * (Keyword, Category, Location, Remote only) and the companies that are hiring on the right. Keyword is sent after you stop typing;
 * the other filters apply as soon as you change them; Search Jobs sends the keyword at once. While a search runs, or if it fails, the
 * jobs already on screen stay. Both panels scroll on their own and the pager sits under the jobs, like every list in the app.
 * The Hiring Companies panel lists the companies in the current search's results, with how many jobs each has there; View Company narrows the
 * list to that company.
 */
export function Jobs() {
  // The job search in the left navigation (Keyword, Category, Location) sends you here as /jobs?q=...&category=...&location=...: search for those.
  const [params] = useSearchParams();
  const urlSearch = params.toString();
  const fromUrl = (search: string) => {
    const p = new URLSearchParams(search);
    return { keyword: (p.get("q") ?? "").trim(), category: p.get("category") ?? "", locations: p.getAll("location") };
  };
  const [draft, setDraft] = useState({ ...fromUrl(urlSearch), remoteOnly: false, company: "", sort: "newest" as JobSort });
  const [keyword, setKeyword] = useState(draft.keyword); // the keyword that is actually being searched
  const [page, setPage] = useState(1);
  const [applying, setApplying] = useState<JobDto | null>(null); // the job whose Apply panel is showing (it stays until it has slid out)
  const [applyOpen, setApplyOpen] = useState(false);
  const [viewing, setViewing] = useState<JobDto | null>(null); // the job whose description panel is showing
  const [viewOpen, setViewOpen] = useState(false);

  // Searching again from the left navigation while already here: take the new filters.
  const seen = useRef(urlSearch);
  useEffect(() => {
    if (seen.current === urlSearch) return;
    seen.current = urlSearch;
    const f = fromUrl(urlSearch);
    setDraft((d) => ({ ...d, ...f, company: "" }));
    setKeyword(f.keyword);
    setPage(1);
  }, [urlSearch]);

  const filters = useMemo<JobFilters>(() => ({ keyword, category: draft.category, locations: draft.locations, remoteOnly: draft.remoteOnly, company: draft.company, sort: draft.sort }), [keyword, draft.category, draft.locations, draft.remoteOnly, draft.company, draft.sort]);
  const jobs = useJobs(filters, page, PAGE_SIZE);
  // The Hiring Companies panel follows the same search (not the company chosen in it), so what it counts is what the list then shows.
  const companyFilters = useMemo(() => ({ keyword, category: draft.category, locations: draft.locations, remoteOnly: draft.remoteOnly }), [keyword, draft.category, draft.locations, draft.remoteOnly]);
  const companies = useHiringCompanies(companyFilters);

  // Add to Contacts: what happened for each company (by name), and the account's credits (the button needs at least one).
  const { toast } = useToast();
  const me = useMe();
  const addContact = useAddCompanyContact();
  const [adds, setAdds] = useState<Record<string, AddState>>({});
  const credits = me.data?.user.credits ?? 0;
  const addToContacts = async (name: string) => {
    setAdds((a) => ({ ...a, [name]: { status: "adding" } }));
    try {
      const r = await addContact.mutateAsync(name);
      setAdds((a) => ({ ...a, [name]: { status: "added" } }));
      toast(r.charged ? `${r.name || r.email} added to your contacts (1 credit used)` : `${r.name || r.email} is already in your contacts`);
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : "";
      const message =
        code === "NO_EMAIL" ? "No contact found. You were not charged."
        : code === "INSUFFICIENT_CREDITS" ? "You need 1 credit."
        : code === "NOT_CONFIGURED" ? "Finding contacts is not set up on this server yet."
        : e instanceof ApiClientError ? e.message
        : "Could not add the contact. You were not charged.";
      setAdds((a) => ({ ...a, [name]: { status: code === "NO_EMAIL" ? "none" : "error", message } }));
    }
  };

  // The last results that loaded. A failed refresh must not wipe what the person is looking at.
  const [lastGood, setLastGood] = useState<JobsPageDto | null>(null);
  useEffect(() => { if (jobs.data && !jobs.isPlaceholderData) setLastGood(jobs.data); }, [jobs.data, jobs.isPlaceholderData]);
  const data = jobs.data ?? lastGood;

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = keyword !== "" || draft.category !== "" || draft.locations.length > 0 || draft.remoteOnly || draft.company !== "";
  const change = (patch: Partial<typeof draft>) => { setDraft((d) => ({ ...d, ...patch })); setPage(1); };

  return (
    <FillPage>
      <PageHeader title="Find Your Next Opportunity" description="Discover remote jobs, freelance projects, and opportunities." />

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="flex min-h-[28rem] min-w-0 flex-1 flex-col lg:min-h-0">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
            <p>
              {data ? `Showing ${total.toLocaleString("en-US")} ${total === 1 ? "job" : "jobs"}` : " "}
              {draft.company && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-brand-100 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-900 dark:bg-brand-900/50 dark:text-brand-100">
                  {draft.company}
                  <button type="button" className="cursor-pointer rounded-full px-1.5 hover:bg-brand-200 dark:hover:bg-brand-800" aria-label={`Remove the ${draft.company} filter`} onClick={() => change({ company: "" })}>✕</button>
                </span>
              )}
              {jobs.isFetching && data ? " · updating…" : ""}
            </p>
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2" title="Only jobs that can be done remotely">
                <input type="checkbox" checked={draft.remoteOnly} onChange={(e) => change({ remoteOnly: e.target.checked })} className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-600" />
                Remote only
              </label>
              <label className="inline-flex items-center gap-2">
                <span className="sr-only">Sort by</span>
                <Select aria-label="Sort by publication date" className="!w-auto !py-1 text-sm" value={draft.sort} onChange={(e) => change({ sort: e.target.value as JobSort })}>
                  {JOB_SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
                </Select>
              </label>
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
                <div className="space-y-2">
                  {data.items.map((j) => (
                    <div role="listitem" key={j.id}><JobCard job={j} onView={() => { setViewing(j); setViewOpen(true); }} onApply={() => { setApplying(j); setApplyOpen(true); }} /></div>
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
            {companies.isError && !companies.data ? (
              <div className="p-3"><ErrorNotice error={companies.error} onRetry={() => void companies.refetch()} /></div>
            ) : !companies.data ? (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" role="status" aria-label="Loading companies">{[0, 1, 2].map((i) => <JobCardSkeleton key={i} />)}</div>
            ) : companies.data.items.length === 0 ? (
              <div className="p-3"><Empty>No companies are hiring for this search.</Empty></div>
            ) : (
              <ul className={`min-h-0 flex-1 space-y-2 overflow-y-auto p-3 transition-opacity ${companies.isPlaceholderData ? "opacity-60" : ""}`}>
                {companies.data.items.map((c) => (
                  <CompanyCard
                    key={c.name}
                    company={c}
                    selected={draft.company.toLowerCase() === c.name.toLowerCase()}
                    add={adds[c.name] ?? { status: "idle" }}
                    canAdd={credits >= COMPANY_CONTACT_COST}
                    onShow={() => change({ company: c.name })}
                    onClear={() => change({ company: "" })}
                    onAdd={() => void addToContacts(c.name)}
                  />
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
      {viewing && (
        <JobDetailsPanel
          key={`view-${viewing.id}`} // the two panels are siblings: their keys must differ even for the same job
          job={viewing}
          open={viewOpen}
          onClose={() => setViewOpen(false)}
          onExited={() => setViewing(null)}
          onApply={() => { setViewOpen(false); setApplying(viewing); setApplyOpen(true); }} // this panel slides out as the email panel slides in
        />
      )}
      {applying && <JobApplyPanel key={`apply-${applying.id}`} job={applying} open={applyOpen} onClose={() => setApplyOpen(false)} onExited={() => setApplying(null)} />}
    </FillPage>
  );
}
