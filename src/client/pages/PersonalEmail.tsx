import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { PersonalEmailDto } from "@shared/api";
import { Button, Card, CardHeader, Empty, ErrorNotice, Field, LoadingRows, Modal, Notice, PageHeader, Table, TextArea, TextInput, Td, Th, fmt, fmtDate } from "@/components/ui";
import { useRole } from "@/hooks/useRole";
import { findPlaceholders, personalEmailWarnings, placeholderMessage } from "@shared/personal-email-hints";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { usePersonalEmails, useSendPersonalEmail } from "@/services/personalEmails";
import { useSender } from "@/services/sender";

/**
 * One-to-one email: a message you write to one person, sent through the configured provider (the organization's Gmail account, or Postmark) with
 * nothing added. It is for individually written mail, so there is no unsubscribe footer; a list of people is what
 * Campaigns are for. A small daily limit keeps it that way, and an address that asked not to be emailed is refused.
 */
export function PersonalEmail() {
  const { role, ready } = useRole();
  const { toast } = useToast();
  // Only Administrators and Campaign Managers may read it, so nothing is requested until the role is known and allowed.
  const allowed = ready && role !== "Viewer" && role !== "SuperAdministrator";
  const list = usePersonalEmails(allowed);
  const sender = useSender();
  const send = useSendPersonalEmail();
  const [to, setTo] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [viewing, setViewing] = useState<PersonalEmailDto | null>(null);

  if (ready && (role === "Viewer" || role === "SuperAdministrator")) {
    return (
      <>
        <PageHeader title="One-to-one email" />
        <Notice tone="warn" title="No access">Your role does not have access to One-to-one email.</Notice>
      </>
    );
  }

  const error = send.error instanceof ApiClientError ? send.error : null;
  const fieldError = (path: string) => error?.fieldErrors.find((f) => f.path === path)?.message;
  const general = send.isError ? (error ? (error.fieldErrors.length > 0 && error.code === "VALIDATION_ERROR" ? null : error.message) : "Something went wrong. Please try again.") : null;
  // Gmail needs a connected account. Another provider (Postmark) is set up on the server, so there is nothing to connect.
  const provider = list.data?.provider;
  const needsGmail = provider === "gmail";
  const connected = provider !== undefined && (!needsGmail || sender.data?.sender?.status === "Connected");
  const used = list.data?.sentToday ?? 0;
  const limit = list.data?.dailyLimit ?? 25;
  // A merge tag still in the text would reach the person as it is, so it blocks sending. The other warnings only explain what mail
  // filters notice (the same text sent to several people, a subject that suggests an existing deal, a very long first message).
  const tags = findPlaceholders(`${subject}\n${body}`);
  const warnings = personalEmailWarnings({ to, subject, body, recent: list.data?.items ?? [] });
  const complete = to.trim() !== "" && subject.trim() !== "" && body.trim() !== "" && tags.length === 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!complete || send.isPending) return;
    try {
      await send.mutateAsync({ to: to.trim(), ...(replyTo.trim() ? { replyTo: replyTo.trim() } : {}), subject: subject.trim(), body });
      toast(`Email sent to ${to.trim()}`);
      setTo("");
      setSubject("");
      setBody("");
    } catch {
      /* shown under the form */
    }
  }

  return (
    <>
      <PageHeader title="One-to-one email" description="Write to one person, and it is sent right now with nothing added." />
      <div className="mb-4">
        <Notice tone="info">
          For emails you write yourself to one person at a time. Nothing is added to it: no unsubscribe footer and no tracking. To reach a list of people, use a{" "}
          <Link to="/campaigns" className="font-medium underline">campaign</Link>, which handles unsubscribes. An address that asked not to be emailed is refused here too.
        </Notice>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader title="New email" subtitle={`${fmt(used)} of ${fmt(limit)} sent in the last 24 hours${provider === "postmark" ? " · sent through Postmark" : ""}`} />
          <form onSubmit={(e) => void submit(e)} className="space-y-4 p-5">
            {needsGmail && sender.data && !connected && (
              <Notice tone="warn" title="No Gmail account connected">
                An Administrator needs to connect one in <Link to="/settings" className="font-medium underline">Settings</Link> before you can send.
              </Notice>
            )}
            <Field label="To" htmlFor="pe-to">
              <TextInput id="pe-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" autoComplete="off" />
              {fieldError("to") && <p className="mt-1 text-xs text-rose-600">{fieldError("to")}</p>}
            </Field>
            <Field label="Reply-To (optional)" htmlFor="pe-reply" hint="Only if replies should go to a different address from the sender.">
              <TextInput id="pe-reply" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} autoComplete="off" />
              {fieldError("replyTo") && <p className="mt-1 text-xs text-rose-600">{fieldError("replyTo")}</p>}
            </Field>
            <Field label="Subject" htmlFor="pe-subject">
              <TextInput id="pe-subject" value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />
              {fieldError("subject") && <p className="mt-1 text-xs text-rose-600">{fieldError("subject")}</p>}
            </Field>
            <Field label="Message" htmlFor="pe-body" hint="Plain text, with your line breaks kept. No formatting.">
              <TextArea id="pe-body" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
              {fieldError("body") && <p className="mt-1 text-xs text-rose-600">{fieldError("body")}</p>}
            </Field>
            {tags.length > 0 && <p role="alert" className="text-sm text-rose-600">{placeholderMessage(tags)}.</p>}
            {warnings.map((w) => <Notice key={w.code} tone="warn">{w.message}</Notice>)}
            {general && <p role="alert" className="text-sm text-rose-600">{general}</p>}
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={!complete || !connected || send.isPending || used >= limit}>{send.isPending ? "Sending…" : "Send email"}</Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Recently sent" />
          {list.isError ? (
            <div className="p-4"><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></div>
          ) : list.isPending ? (
            <LoadingRows cols={3} rows={4} />
          ) : list.data.items.length === 0 ? (
            <Empty>Nothing sent yet.</Empty>
          ) : (
            <Table>
              <thead><tr><Th>To</Th><Th>Subject</Th><Th>Sent</Th></tr></thead>
              <tbody>
                {list.data.items.map((m) => (
                  <tr key={m.id}>
                    <Td className="max-w-[12rem] truncate">{m.to}</Td>
                    <Td className="max-w-[14rem] truncate">
                      <button type="button" className="text-left font-medium text-brand-600 hover:underline" onClick={() => setViewing(m)}>{m.subject}</button>
                    </Td>
                    <Td className="whitespace-nowrap text-slate-500">{fmtDate(m.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Modal open={viewing !== null} title={viewing?.subject ?? "Email"} onClose={() => setViewing(null)} footer={<Button onClick={() => setViewing(null)}>Close</Button>}>
        {viewing && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-slate-600 dark:text-slate-300">
              <dt className="text-slate-500">To</dt><dd>{viewing.to}</dd>
              <dt className="text-slate-500">Sent by</dt><dd>{viewing.sentBy}</dd>
              <dt className="text-slate-500">Sent</dt><dd>{fmtDate(viewing.createdAt)}</dd>
            </dl>
            <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans dark:bg-slate-800/50">{viewing.body}</pre>
          </div>
        )}
      </Modal>
    </>
  );
}
