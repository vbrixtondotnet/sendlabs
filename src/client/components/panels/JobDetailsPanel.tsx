import type { JobDescriptionBlock, JobDto } from "@shared/api";
import { CANDIDATE_LOCATION_SOURCES, CREDITED_SOURCES, safeApplyUrl } from "@shared/jobs";
import { Button, ErrorNotice } from "@/components/ui";
import { SlidePanel } from "@/components/SlidePanel";
import { postedAgo } from "@/lib/jobs";
import { useJobDescription } from "@/services/jobs";

/** The description, drawn with ordinary elements from plain text blocks. Nothing here is markup from outside. */
function Description({ blocks }: { blocks: JobDescriptionBlock[] }) {
  if (blocks.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">This job has no description.</p>;
  return (
    <div className="space-y-3 text-[0.9375rem] leading-relaxed text-slate-700 dark:text-slate-200">
      {blocks.map((b, i) =>
        b.type === "heading" ? <h3 key={i} className="pt-2 text-base font-semibold text-slate-900 dark:text-slate-100">{b.text}</h3>
        : b.type === "paragraph" ? <p key={i}>{b.text}</p>
        : b.ordered ? <ol key={i} className="list-decimal space-y-1 pl-6">{b.items.map((t, k) => <li key={k}>{t}</li>)}</ol>
        : <ul key={i} className="list-disc space-y-1 pl-6">{b.items.map((t, k) => <li key={k}>{t}</li>)}</ul>,
      )}
    </div>
  );
}

function DescriptionSkeleton() {
  return (
    <div className="animate-pulse space-y-3" role="status" aria-label="Loading the description">
      {[100, 92, 96, 60, 100, 88, 94, 70].map((w, i) => <div key={i} className="h-3 rounded bg-slate-200 dark:bg-slate-800" style={{ width: `${w}%` }} />)}
    </div>
  );
}

/**
 * The panel that slides in from the right when you press View Job: the job's title and company, the facts about it, and its
 * description (loaded now, from our server), with Apply Now at the bottom, which closes this panel and opens the email panel.
 */
export function JobDetailsPanel({ job, open = true, onClose, onExited, onApply }: { job: JobDto; open?: boolean; onClose: () => void; onExited?: () => void; onApply: () => void }) {
  const description = useJobDescription(job.id);
  const meta = [job.remote ? "Remote" : job.location || "Location not given", job.employmentType, job.salary].filter(Boolean).join(" · ");
  const postedLine = postedAgo(job.publishedAt);
  const url = safeApplyUrl(job.url);

  return (
    <SlidePanel
      open={open}
      title={job.title}
      subtitle={job.companyName}
      onClose={onClose}
      onExited={() => onExited?.()}
      footer={<Button type="button" variant="primary" onClick={onApply} aria-label={`Apply now: ${job.title}`}>Apply Now</Button>}
    >
      <div className="mb-5 space-y-1 border-b border-slate-200 pb-4 dark:border-slate-800">
        <p className="text-slate-800 dark:text-slate-100">{meta}</p>
        {job.remote && job.location && <p className="text-sm text-slate-500 dark:text-slate-400">{CANDIDATE_LOCATION_SOURCES.includes(job.source) ? "Candidates from" : "Based in"}: {job.location}</p>}
        {job.skills.length > 0 && <p className="text-sm text-slate-600 dark:text-slate-300">{job.skills.slice(0, 12).join(" · ")}</p>}
        {(postedLine || CREDITED_SOURCES.includes(job.source)) && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {postedLine}
            {/* Remotive's and Jobicy's terms: name them as the source, and link to the job on their site. */}
            {CREDITED_SOURCES.includes(job.source) && <>{postedLine && " · "}via {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">{job.source}</a> : job.source}</>}
          </p>
        )}
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Job description</h2>
      {description.isError ? (
        <ErrorNotice error={description.error} onRetry={() => void description.refetch()} />
      ) : description.isPending ? (
        <DescriptionSkeleton />
      ) : (
        <Description blocks={description.data.blocks} />
      )}
    </SlidePanel>
  );
}
