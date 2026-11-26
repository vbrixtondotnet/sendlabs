import type { JobDescriptionBlock, JobDto } from "@shared/api";
import { CANDIDATE_LOCATION_SOURCES, shortLocation } from "@shared/jobs";
import { Button, ErrorNotice } from "@/components/ui";
import { SlidePanel } from "@/components/SlidePanel";
import { useJobDescription } from "@/services/jobs";

/** The description, drawn with ordinary elements from plain text blocks. Nothing here is markup from outside. */
/** A line a source adds about itself ("Originally posted on Himalayas", "Posted 1 month ago via X"): never shown in the panel. */
const SOURCE_NOTE = /^\s*((originally\s+)?(posted|published)\b.{0,80}|(via|source|apply\s+(on|at|via))\b.{0,60})\s*$/i;
const withoutSourceNotes = (blocks: JobDescriptionBlock[]) => blocks.filter((b) => !((b.type === "paragraph" || b.type === "heading") && SOURCE_NOTE.test(b.text)));

function Description({ blocks: all }: { blocks: JobDescriptionBlock[] }) {
  const blocks = withoutSourceNotes(all);
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

  return (
    <SlidePanel
      open={open}
      title={job.title}
      subtitle={job.companyName}
      beside={job.companyLogo ? <img src={job.companyLogo} alt={`${job.companyName} logo`} referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 bg-white object-contain dark:border-slate-700" /> : undefined}
      onClose={onClose}
      onExited={() => onExited?.()}
      footer={<Button type="button" variant="primary" onClick={onApply} aria-label={`Apply now: ${job.title}`}>Apply Now</Button>}
    >
      <div className="mb-5 space-y-1 border-b border-slate-200 pb-4 dark:border-slate-800">
        <p className="text-slate-800 dark:text-slate-100">{meta}</p>
        {job.remote && job.location && <p className="text-sm text-slate-500 dark:text-slate-400">{CANDIDATE_LOCATION_SOURCES.includes(job.source) ? "Candidates from" : "Based in"}: {shortLocation(job.location)}</p>}
        {job.skills.length > 0 && <p className="text-sm text-slate-600 dark:text-slate-300">{job.skills.slice(0, 12).join(" · ")}</p>}
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
