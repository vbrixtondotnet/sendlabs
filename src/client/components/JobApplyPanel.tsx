import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { JobDto } from "@shared/api";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES, attachmentProblem, formatBytes } from "@shared/email-attachments";
import { safeApplyUrl } from "@shared/jobs";
import { isValidEmail } from "@shared/email";
import { Button, Field, Notice, SlidePanel, TextArea, TextInput } from "@/components/ui";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useSendApplicationEmail } from "@/services/jobs";
import { useMe } from "@/services/me";
import { useSender } from "@/services/sender";

/** The email the panel starts with, filled in from the job and from you. It is only a starting point: every word can be changed. */
export function draftApplication(job: Pick<JobDto, "title" | "companyName">, yourName: string): { subject: string; body: string } {
  const at = job.companyName ? ` at ${job.companyName}` : "";
  return {
    subject: `Application for ${job.title}${at}`,
    body: [
      `Hello${job.companyName ? ` ${job.companyName} team` : ""},`,
      "",
      `I am writing to apply for the ${job.title} position${at}. I would welcome the chance to discuss how I can contribute.`,
      "",
      "Thank you for your time and consideration.",
      "",
      "Best regards,",
      yourName,
    ].join("\n"),
  };
}

/**
 * The panel that slides in from the right when you press Apply Now on a job: write a personal email to the employer, attach your
 * resume (PDF or Word), and send it from your organization's connected Gmail account. One recipient; there is no CC or BCC.
 */
export function JobApplyPanel({ job, open = true, onClose, onExited }: { job: JobDto; /** False slides it out. */ open?: boolean; onClose: () => void; /** Called once it has finished sliding out. */ onExited?: () => void }) {
  const me = useMe();
  const sender = useSender();
  const { canEdit } = useRole();
  const { toast } = useToast();
  const send = useSendApplicationEmail();

  const yourName = me.data?.user.displayName || me.data?.user.email || "";
  const draft = draftApplication(job, yourName);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  // Your name only arrives with /api/me. Until you have changed the message yourself, the sign-off follows it.
  const edited = useRef(false);
  useEffect(() => { if (!edited.current) setBody(draftApplication(job, yourName).body); }, [job, yourName]);
  const [files, setFiles] = useState<File[]>([]);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const connected = sender.data?.sender?.status === "Connected";
  const total = files.reduce((n, f) => n + f.size, 0);
  const valid = isValidEmail(to.trim().toLowerCase()) && subject.trim() !== "" && body.trim() !== "";
  const postingUrl = safeApplyUrl(job.url);

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    let next = files;
    let problem: string | null = null;
    for (const f of Array.from(picked)) {
      const p = attachmentProblem(f, next);
      if (p) { problem = p; continue; }
      next = [...next, f];
    }
    setFiles(next);
    setFileProblem(problem);
    if (picker.current) picker.current.value = ""; // so the same file can be chosen again after removing it
  };
  const removeFile = (i: number) => { setFiles(files.filter((_, k) => k !== i)); setFileProblem(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !canEdit || !connected || send.isPending) return;
    setError(null);
    try {
      await send.mutateAsync({ to: to.trim(), subject: subject.trim(), body, attachments: files });
      toast(`Email sent to ${to.trim()}`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? (err.fieldErrors[0]?.message ?? err.message) : "The email could not be sent. Please try again");
    }
  };

  return (
    <SlidePanel
      open={open}
      onExited={() => onExited?.()}
      title="Apply by email"
      subtitle={[job.title, job.companyName].filter(Boolean).join(" · ")}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={send.isPending}>Cancel</Button>
          <Button type="submit" form="apply-email-form" variant="primary" disabled={!valid || !canEdit || !connected || send.isPending}>{send.isPending ? "Sending…" : "Send email"}</Button>
        </>
      }
    >
      {postingUrl && (
        <p className="mb-4 text-sm">
          <a href={postingUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-300">View the original job posting</a>
          <span className="text-slate-500 dark:text-slate-400"> (opens in a new tab)</span>
        </p>
      )}

      {!canEdit && <div className="mb-4"><Notice tone="warn" title="Your role cannot send email">You can read the jobs, but an Administrator or Campaign Manager sends the email.</Notice></div>}
      {canEdit && !sender.isPending && !connected && (
        <div className="mb-4">
          <Notice tone="warn" title="Connect your Gmail account first">
            Emails are sent from your organization&apos;s connected Gmail account, and none is connected. An Administrator can connect one in <Link to="/settings" className="font-medium underline">Settings</Link>.
          </Notice>
        </div>
      )}
      {error && <div className="mb-4"><Notice tone="error" title="The email was not sent">{error}</Notice></div>}

      <form id="apply-email-form" onSubmit={(e) => void submit(e)} className="space-y-4" aria-label="Application email">
        {connected && <p className="text-sm text-slate-500 dark:text-slate-400">From: <span className="font-medium text-slate-700 dark:text-slate-200">{sender.data!.sender!.email}</span></p>}

        <Field label="To" htmlFor="apply-to" hint="The email address of the person or team that is hiring.">
          <TextInput id="apply-to" type="email" autoComplete="off" placeholder="hiring@company.com" value={to} onChange={(e) => setTo(e.target.value)} disabled={send.isPending} />
        </Field>
        <Field label="Subject" htmlFor="apply-subject">
          <TextInput id="apply-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} disabled={send.isPending} />
        </Field>
        <Field label="Message" htmlFor="apply-body">
          <TextArea id="apply-body" rows={11} value={body} maxLength={20000} onChange={(e) => { edited.current = true; setBody(e.target.value); }} disabled={send.isPending} />
        </Field>

        <div>
          <p className="mb-1 text-sm font-medium">Attachments</p>
          <input ref={picker} id="apply-files" type="file" multiple accept={ATTACHMENT_ACCEPT} className="sr-only" aria-label="Attach files" onChange={(e) => addFiles(e.target.files)} disabled={send.isPending} />
          <Button type="button" variant="secondary" onClick={() => picker.current?.click()} disabled={send.isPending || files.length >= MAX_ATTACHMENTS}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.5l-8.6 8.6a5 5 0 01-7.1-7.1l9-9a3.3 3.3 0 014.7 4.7l-9 9a1.7 1.7 0 01-2.4-2.4l8.3-8.3" /></svg>
            Attach files
          </Button>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">PDF or Word files only (.pdf, .doc, .docx). Up to {MAX_ATTACHMENTS} files, {formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} in all.</p>
          {fileProblem && <p className="mt-1 text-sm text-rose-600 dark:text-rose-400" role="alert">{fileProblem}</p>}
          {files.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800" aria-label="Attached files">
              {files.map((f, i) => (
                <li key={`${f.name}-${f.size}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{f.name} <span className="text-slate-500 dark:text-slate-400">({formatBytes(f.size)})</span></span>
                  <button type="button" onClick={() => removeFile(i)} disabled={send.isPending} aria-label={`Remove ${f.name}`} className="shrink-0 cursor-pointer rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
                </li>
              ))}
              <li className="px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400">{files.length} of {MAX_ATTACHMENTS} files · {formatBytes(total)} of {formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}</li>
            </ul>
          )}
        </div>
      </form>
    </SlidePanel>
  );
}
