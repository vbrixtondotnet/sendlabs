import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { CampaignDto } from "@shared/api";
import type { ContactFields } from "@shared/types";
import { windowIsValid } from "@shared/schemas";
import { DEFAULT_HTML_BODY } from "@shared/defaults";
import {
  Button, Card, CardHeader, ErrorNotice, Field, LoadingRows, Modal, Notice, PageHeader, Select, TextArea, TextInput, fmt,
} from "@/components/ui";
import { ColumnMapper, CsvDropzone, CsvFileBar, ValidationSummary } from "@/components/csv";
import { useCsvFile } from "@/hooks/useCsvFile";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/useToast";
import { MERGE_FIELDS, renderTemplate, UNSUBSCRIBE_TAG, unknownTags } from "@/lib/merge";
import { ApiClientError } from "@/services/http";
import { useCampaign, useCreateCampaign, useUpdateCampaign } from "@/services/campaigns";
import { useContacts } from "@/services/contacts";
import { useSender } from "@/services/sender";
import { useCreateImport, useImports } from "@/services/imports";

const TIMEZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "UTC"];
type Source = "contacts" | "import" | "upload";

export function CampaignEditor() {
  const { id } = useParams();
  const { canEdit } = useRole();
  const existing = useCampaign(id);

  if (!canEdit) {
    return (<><PageHeader title="Campaign editor" /><Notice tone="warn">Your role is read-only and cannot create or edit campaigns.</Notice></>);
  }
  if (id && existing.isPending) return <><PageHeader title="Edit draft" /><Card><LoadingRows rows={4} cols={3} /></Card></>;
  if (id && existing.isError) {
    const notFound = existing.error instanceof ApiClientError && existing.error.status === 404;
    return (
      <>
        <PageHeader title={notFound ? "Campaign not found" : "Edit draft"} />
        {notFound ? <Link to="/campaigns" className="text-indigo-600 hover:underline">Back to campaigns</Link> : <ErrorNotice error={existing.error} onRetry={() => void existing.refetch()} />}
      </>
    );
  }
  if (id && existing.data && existing.data.status !== "Draft") {
    return (
      <>
        <PageHeader title={existing.data.name} />
        <Notice tone="warn" title="This campaign is locked">
          Only drafts can be edited. <Link to={`/campaigns/${existing.data.id}`} className="font-medium underline">View the campaign</Link>
        </Notice>
      </>
    );
  }
  return <EditorForm key={id ?? "new"} initial={existing.data ?? null} />;
}

function EditorForm({ initial }: { initial: CampaignDto | null }) {
  const nav = useNavigate();
  const { toast } = useToast();
  const create = useCreateCampaign();
  const update = useUpdateCampaign();
  const csv = useCsvFile();
  const importCsv = useCreateImport();
  const senderStatus = useSender();
  const senderEmail = senderStatus.data?.sender?.email ?? null;
  const imports = useImports(1, 100);

  const [name, setName] = useState(initial?.name ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [html, setHtml] = useState(initial?.htmlBody ?? DEFAULT_HTML_BODY);
  const [text, setText] = useState(initial?.textBody ?? "");
  const [source, setSource] = useState<Source>(initial?.recipientImportId ? "import" : "contacts");
  const [importId, setImportId] = useState(initial?.recipientImportId ?? "");
  const [daily, setDaily] = useState(initial?.dailyLimit ?? 500);
  const [from, setFrom] = useState(initial?.sendWindowStart ?? "09:00");
  const [to, setTo] = useState(initial?.sendWindowEnd ?? "17:00");
  const [tz, setTz] = useState(initial?.timezone ?? "America/Los_Angeles");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [previewIdx, setPreviewIdx] = useState(0);
  const [testTo, setTestTo] = useState("");
  const [launchOpen, setLaunchOpen] = useState(false);
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const saving = create.isPending || update.isPending;
  const saveError = (create.error ?? update.error) as unknown;
  const fieldErrors = saveError instanceof ApiClientError ? saveError.fieldErrors : [];

  /* ---- audience: every contact, the people in a saved import, or a file about to be imported ---- */
  const allContacts = useContacts({ page: 1, pageSize: 8 });
  const completedImports = (imports.data?.items ?? []).filter((i) => i.status === "Completed");
  const chosenImport = completedImports.find((i) => i.id === importId);
  const uploaded = source === "upload" ? csv.result : null;
  const audienceTotal = source === "contacts" ? (allContacts.data?.total ?? 0) : source === "import" ? (chosenImport?.validRows ?? 0) : 0;

  const previewContacts: Partial<ContactFields>[] = useMemo(() => {
    if (source === "upload" && uploaded && uploaded.valid.length > 0) return uploaded.valid.slice(0, 8);
    if (allContacts.data && allContacts.data.items.length > 0) return allContacts.data.items;
    return [{ firstName: "Alex", lastName: "Sample", companyName: "Example Co", industry: "construction", email: "alex@example.test" }];
  }, [source, uploaded, allContacts.data]);
  const sample = previewContacts[Math.min(previewIdx, previewContacts.length - 1)] ?? {};

  const days = Math.ceil(audienceTotal / (daily || 1));

  /* ---- validation (the server re-checks everything) ---- */
  const unknown = unknownTags(subject + html + text);
  const problems: string[] = [];
  // Campaigns are sent from the tenant's own connected Gmail account. Without one, nothing can be sent.
  if (senderStatus.isPending) problems.push("Checking your Gmail sender");
  else if (!senderStatus.data?.sender) problems.push("Connect a Gmail sender in Settings before launching");
  else if (senderStatus.data.sender.status !== "Connected") problems.push("Reconnect your Gmail sender in Settings before launching");
  if (!name.trim()) problems.push("Campaign name is required");
  if (!subject.trim()) problems.push("Subject is required");
  if (!html.trim()) problems.push("HTML body is required");
  if (!html.includes(UNSUBSCRIBE_TAG)) problems.push(`Body must include an ${UNSUBSCRIBE_TAG} link`);
  if (unknown.length) problems.push(`Unknown merge field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
  if (!Number.isInteger(daily) || daily < 1 || daily > 2000) problems.push("Daily limit must be a whole number from 1 to 2,000");
  if (!windowIsValid(from, to)) problems.push("The send window must end after it starts");
  if (source === "import" && !chosenImport) problems.push("Choose an import for the recipients");
  else if (source === "upload") problems.push("Import the uploaded CSV first (use the button in Recipients)");
  else if (audienceTotal < 1) problems.push("There are no recipients");

  function insert(tag: string) {
    const el = bodyRef.current;
    if (!el) return setHtml(html + tag);
    const { selectionStart: s, selectionEnd: e } = el;
    setHtml(html.slice(0, s) + tag + html.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + tag.length, s + tag.length); });
  }

  /** Creates the draft, or updates it. Returns the saved campaign, or null if the server rejected it. */
  async function save(): Promise<CampaignDto | null> {
    const fields = {
      name, subject, htmlBody: html, textBody: text.trim() === "" ? null : text,
      dailyLimit: daily, sendWindowStart: from, sendWindowEnd: to, timezone: tz,
      // null = every contact. The choice is saved with the draft and resolved into recipients at launch.
      recipientImportId: source === "import" && importId ? importId : null,
    };
    try {
      return initial ? await update.mutateAsync({ id: initial.id, patch: fields }) : await create.mutateAsync(fields);
    } catch {
      return null; // the error is shown from the mutation state
    }
  }

  /** Uploads the reviewed file for real, then selects the resulting import as this campaign's recipients. */
  async function importNow() {
    if (!csv.file) return;
    try {
      const imported = await importCsv.mutateAsync({ file: csv.file, mapping: csv.mapping });
      csv.reset();
      setImportId(imported.id);
      setSource("import");
      toast(`Imported ${fmt(imported.createdContacts)} new contacts. ${fmt(imported.validRows)} will be emailed.`);
    } catch {
      /* shown in the Recipients card */
    }
  }

  async function onSaveDraft() {
    const saved = await save();
    if (!saved) return;
    toast("Draft saved");
    nav("/campaigns");
  }

  async function onConfirmLaunch() {
    const saved = await save();
    if (!saved) return;
    setLaunchOpen(false);
    toast("Saved as a draft. Launching is not connected to the backend yet.", "info");
    nav(`/campaigns/${saved.id}`);
  }

  const fieldError = (path: string) => fieldErrors.find((f) => f.path === path)?.message;
  const previewDoc = `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;padding:16px">${renderTemplate(html, sample, true)}</body></html>`;

  return (
    <>
      <PageHeader
        title={initial ? "Edit draft" : "New campaign"}
        description="Content and the daily sending schedule are saved to the server. Choosing recipients happens at launch."
        actions={
          <>
            <Link to="/campaigns"><Button>Cancel</Button></Link>
            <Button disabled={saving} onClick={onSaveDraft}>{saving ? "Saving…" : "Save draft"}</Button>
            <Button variant="primary" disabled={problems.length > 0 || saving} onClick={() => { setAck1(false); setAck2(false); setLaunchOpen(true); }}>Review and launch</Button>
          </>
        }
      />

      {saveError !== null && saveError !== undefined && (
        <div className="mb-4">
          <Notice tone="error" title="Could not save the draft">
            {saveError instanceof ApiClientError ? (
              <>
                <p>{saveError.message}</p>
                {fieldErrors.length > 0 && <ul className="mt-1 list-disc pl-5">{fieldErrors.map((f) => <li key={f.path}>{f.path}: {f.message}</li>)}</ul>}
                {saveError.correlationId && <p className="mt-1 text-xs opacity-80">Reference: {saveError.correlationId}</p>}
              </>
            ) : "Something went wrong."}
          </Notice>
        </div>
      )}

      {problems.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn" title="Before you can launch">
            <ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <div className="grid gap-4 p-5">
              <Field label="Campaign name" htmlFor="name">
                <TextInput id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Access-to-SQL Migration Outreach" />
                {fieldError("name") && <p className="mt-1 text-xs text-rose-600">{fieldError("name")}</p>}
              </Field>
              <Field label="Subject" htmlFor="subject" hint="Merge fields are allowed, e.g. {{firstName}}">
                <TextInput id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                {fieldError("subject") && <p className="mt-1 text-xs text-rose-600">{fieldError("subject")}</p>}
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Recipients"
              subtitle="Saved with the draft. The list is built when you launch, which is not connected yet."
              action={
                <div className="inline-flex rounded-lg border border-slate-300 p-0.5 text-sm dark:border-slate-700" role="tablist" aria-label="Recipient source">
                  {([["contacts", "All contacts"], ["import", "An import"], ["upload", "Upload CSV"]] as const).map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={source === k} onClick={() => setSource(k)} className={`rounded-md px-3 py-1 font-medium ${source === k ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>{label}</button>
                  ))}
                </div>
              }
            />
            <div className="space-y-4 p-5">
              {fieldError("recipientImportId") && <Notice tone="error">{fieldError("recipientImportId")}</Notice>}

              {source === "contacts" && (
                allContacts.isError ? <ErrorNotice error={allContacts.error} onRetry={() => void allContacts.refetch()} /> : (
                  <p className="text-sm text-slate-600 dark:text-slate-300">Every contact in your database ({allContacts.data ? fmt(allContacts.data.total) : "…"}) will be emailed, each with their own message.</p>
                )
              )}

              {source === "import" && (
                imports.isError ? <ErrorNotice error={imports.error} onRetry={() => void imports.refetch()} /> : (
                  <Field label="Import" htmlFor="imp" hint="Everyone with a valid email in that file is emailed, including contacts that already existed.">
                    <Select id="imp" value={importId} onChange={(e) => setImportId(e.target.value)}>
                      <option value="">{imports.isPending ? "Loading imports…" : completedImports.length === 0 ? "No imports yet" : "Choose an import"}</option>
                      {completedImports.map((i) => <option key={i.id} value={i.id}>{i.filename} ({fmt(i.validRows)} contacts, {new Date(i.createdAt).toLocaleDateString("en-US")})</option>)}
                    </Select>
                  </Field>
                )
              )}

              {source === "upload" && csv.status !== "ready" && <CsvDropzone csv={csv} compact />}
              {source === "upload" && csv.status === "ready" && csv.result && (
                <>
                  <CsvFileBar csv={csv} />
                  <details open={csv.mapping.email === undefined} className="rounded-lg border border-slate-200 dark:border-slate-800">
                    <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Column mapping</summary>
                    <div className="border-t border-slate-200 p-4 dark:border-slate-800"><ColumnMapper csv={csv} /></div>
                  </details>
                  {csv.mapping.email !== undefined && <ValidationSummary result={csv.result} filename={csv.filename} compact />}
                  {importCsv.isError && (
                    <Notice tone="error" title="The import did not complete">
                      {importCsv.error instanceof ApiClientError ? importCsv.error.message : "Something went wrong."}
                    </Notice>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-600 dark:text-slate-300">Uploading saves the contacts. Existing addresses keep their details.</p>
                    <Button variant="primary" disabled={csv.mapping.email === undefined || csv.result.counts.valid === 0 || importCsv.isPending} onClick={importNow}>
                      {importCsv.isPending ? "Importing…" : `Import ${fmt(csv.result.counts.valid)} contacts and use them`}
                    </Button>
                  </div>
                </>
              )}

              <Notice tone="info">The suppression list is not built yet, so opted-out addresses are not excluded automatically.</Notice>
              <dl className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
                <div className="flex justify-between font-semibold"><dt>Will be emailed</dt><dd className="tabular-nums">{fmt(audienceTotal)}</dd></div>
              </dl>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Message"
              action={
                <div className="inline-flex rounded-lg border border-slate-300 p-0.5 text-sm dark:border-slate-700" role="tablist">
                  {(["edit", "preview"] as const).map((t) => (
                    <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 font-medium capitalize ${tab === t ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>{t}</button>
                  ))}
                </div>
              }
            />
            {tab === "edit" ? (
              <div className="space-y-4 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">Insert:</span>
                  {[...MERGE_FIELDS.map((m) => m.tag), UNSUBSCRIBE_TAG].map((m) => (
                    <button key={m} onClick={() => insert(m)} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700">{m}</button>
                  ))}
                </div>
                <Field label="HTML body" htmlFor="html">
                  <TextArea id="html" ref={bodyRef} rows={14} className="font-mono text-xs" value={html} onChange={(e) => setHtml(e.target.value)} />
                  {fieldError("htmlBody") && <p className="mt-1 text-xs text-rose-600">{fieldError("htmlBody")}</p>}
                </Field>
                <Field label="Plain-text body (optional)" htmlFor="text" hint="Left blank, a plain-text version is generated from the HTML."><TextArea id="text" rows={4} value={text} onChange={(e) => setText(e.target.value)} /></Field>
              </div>
            ) : (
              <div className="space-y-3 p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <label htmlFor="pv" className="text-sm font-medium">Preview as</label>
                  <Select id="pv" className="max-w-xs" value={previewIdx} onChange={(e) => setPreviewIdx(Number(e.target.value))}>
                    {previewContacts.map((c, i) => <option key={i} value={i}>{[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email}{c.companyName ? `, ${c.companyName}` : ""}</option>)}
                  </Select>
                </div>
                <div className="rounded-lg border border-slate-200 text-sm dark:border-slate-800">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50">
                    <dt className="text-slate-500">From</dt><dd>{senderEmail ?? <span className="text-slate-400">(no sender connected)</span>}</dd>
                    <dt className="text-slate-500">To</dt><dd>{sample.email ?? ""}</dd>
                    <dt className="text-slate-500">Subject</dt><dd className="font-medium">{renderTemplate(subject || "(no subject)", sample, false)}</dd>
                  </dl>
                  <iframe title="Rendered email preview" sandbox="" srcDoc={previewDoc} className="h-80 w-full rounded-b-lg bg-white" />
                </div>
                <p className="text-xs text-slate-500">
                  Values are HTML-escaped. Blank values fall back to: {MERGE_FIELDS.filter((m) => m.fallback).map((m) => `${m.tag} → "${m.fallback}"`).join(", ")}.
                </p>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Daily sending schedule" />
            <div className="space-y-3 p-5">
              <Field label="Max emails per day" htmlFor="daily">
                <TextInput id="daily" type="number" min={1} max={2000} value={daily} onChange={(e) => setDaily(Number(e.target.value))} />
                {fieldError("dailyLimit") && <p className="mt-1 text-xs text-rose-600">{fieldError("dailyLimit")}</p>}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Window start" htmlFor="from"><TextInput id="from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="Window end" htmlFor="to"><TextInput id="to" type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              </div>
              <Field label="Timezone" htmlFor="tz">
                <Select id="tz" value={tz} onChange={(e) => setTz(e.target.value)}>
                  {(TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES]).map((z) => <option key={z}>{z}</option>)}
                </Select>
              </Field>
              <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200">
                At {fmt(daily)} per day, {fmt(audienceTotal)} recipients take about <strong>{Math.max(days, 0)} sending day{days === 1 ? "" : "s"}</strong>. Sending stops by itself after the last recipient.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Test send" />
            <div className="space-y-3 p-5">
              <Field label="Send a test to" htmlFor="test" hint="Test sending is not connected yet. It needs the Gmail sender.">
                <TextInput id="test" type="email" placeholder="you@itimpact.example" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              </Field>
              <Button className="w-full" disabled>Send test email</Button>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={launchOpen}
        title="Review launch"
        onClose={() => setLaunchOpen(false)}
        footer={
          <>
            <Button onClick={() => setLaunchOpen(false)}>Go back</Button>
            <Button variant="primary" disabled={!(ack1 && ack2) || saving} onClick={onConfirmLaunch}>{saving ? "Saving…" : "Save draft (launch not connected)"}</Button>
          </>
        }
      >
        <Notice tone="info">Launching is not connected to the backend yet. Confirming saves this campaign as a draft.</Notice>
        <dl className="mt-4 space-y-2 text-sm">
          {[
            ["Campaign", name],
            ["Sender mailbox", senderEmail ?? "(none connected)"],
            ["Subject", subject],
            ["Recipients", `${fmt(audienceTotal)} (each receives a separate email)`],
            ["Schedule", `${fmt(daily)} per day, ${from} to ${to} ${tz}, about ${days} days`],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[8rem_1fr] gap-2"><dt className="text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>
          ))}
        </dl>
        <div className="mt-4"><Notice tone="warn">Check Google's current Workspace sending limits. Gmail accepting a message does not guarantee inbox delivery. Content and schedule lock once launched.</Notice></div>
        <div className="mt-4 space-y-2 text-sm">
          <label className="flex gap-2"><input type="checkbox" checked={ack1} onChange={(e) => setAck1(e.target.checked)} className="mt-0.5" />I have previewed the email and sent a test.</label>
          <label className="flex gap-2"><input type="checkbox" checked={ack2} onChange={(e) => setAck2(e.target.checked)} className="mt-0.5" />The unsubscribe link and sender postal address are present, and I have the right to email these contacts.</label>
        </div>
      </Modal>
    </>
  );
}
