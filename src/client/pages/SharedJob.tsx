import { useState } from "react";
import { useParams } from "react-router-dom";
import { CANDIDATE_LOCATION_SOURCES, shortLocation } from "@shared/jobs";
import { Button, ErrorNotice, LoadingRows } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { Description } from "@/components/panels/JobDetailsPanel";
import { JobApplyPanel } from "@/components/panels/JobApplyPanel";
import { ApiClientError } from "@/services/http";
import { useSharedJob } from "@/services/jobs";
import { useMe } from "@/services/me";

/**
 * The public page a shared job's link opens (/share/<id>): the job as the View Job panel shows it (logo, title, company, facts and
 * description) with an Apply button. Public and outside the app layout, so it never shows anyone's navigation. For a signed-in JobSeeker,
 * Apply opens the Apply By Email panel. For anyone else it goes to sign-up, which is not built yet, so the button does nothing for now.
 */
export function SharedJob() {
  const { id = "" } = useParams();
  const shared = useSharedJob(id);
  const me = useMe();
  const [applying, setApplying] = useState(false);
  const canApply = me.data?.user.role === "JobSeeker";
  const missing = shared.error instanceof ApiClientError && shared.error.status === 404;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex justify-center"><Logo className="h-10" /></div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {shared.isPending ? (
            <LoadingRows rows={4} cols={1} />
          ) : missing ? (
            <>
              <h1 className="text-lg font-semibold">This job link is not valid</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">The link may be incomplete or have been changed. Ask the person who shared it for the link again.</p>
            </>
          ) : shared.isError ? (
            <ErrorNotice error={shared.error} onRetry={() => void shared.refetch()} />
          ) : (
            (() => {
              const { job, blocks } = shared.data;
              const meta = [job.remote ? "Remote" : job.location || "Location not given", job.employmentType, job.salary].filter(Boolean).join(" · ");
              return (
                <>
                  <div className="flex items-start gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
                    {job.companyLogo && <img src={job.companyLogo} alt={`${job.companyName} logo`} referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 bg-white object-contain dark:border-slate-700" />}
                    <div className="min-w-0 flex-1">
                      <h1 className="text-xl font-semibold leading-snug">{job.title}</h1>
                      {job.companyName && <p className="text-slate-500 dark:text-slate-400">{job.companyName}</p>}
                    </div>
                    <Button type="button" variant="primary" className="shrink-0" onClick={() => { if (canApply) setApplying(true); }} aria-label={`Apply now: ${job.title}`}>Apply Now</Button>
                  </div>
                  <div className="my-4 space-y-1">
                    <p className="text-slate-800 dark:text-slate-100">{meta}</p>
                    {job.remote && job.location && <p className="text-sm text-slate-500 dark:text-slate-400">{CANDIDATE_LOCATION_SOURCES.includes(job.source) ? "Candidates from" : "Based in"}: {shortLocation(job.location)}</p>}
                    {job.skills.length > 0 && <p className="text-sm text-slate-600 dark:text-slate-300">{job.skills.slice(0, 12).join(" · ")}</p>}
                  </div>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Job description</h2>
                  <Description blocks={blocks} />
                  {canApply && applying && <JobApplyPanel job={job} onClose={() => setApplying(false)} />}
                </>
              );
            })()
          )}
        </div>
      </div>
    </div>
  );
}
