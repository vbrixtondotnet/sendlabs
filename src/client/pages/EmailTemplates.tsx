import { useState, type FormEvent } from "react";
import type { EmailTemplateSummaryDto } from "@shared/api";
import { Badge, Button, Card, Empty, ErrorNotice, Field, LoadingRows, Modal, Notice, PageHeader, Table, TextInput, Td, Th, fmtDate } from "@/components/ui";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/useToast";
import { MERGE_FIELDS, SAMPLE_CONTACT, UNSUBSCRIBE_TAG, composeEmailHtml, isBlankHtml, unknownTags } from "@/lib/merge";
import { ApiClientError } from "@/services/http";
import {
  useAddAvailableTemplate, useAvailableTemplate, useAvailableTemplates, useCreateEmailTemplate, useEmailTemplate, useEmailTemplates, useRemoveEmailTemplate,
} from "@/services/emailTemplates";

const TABS = ["Available Templates", "My Templates"] as const;
type Tab = (typeof TABS)[number];

/** What is being previewed: one of My Templates (by id) or an Available one (by key). */
type Target = { kind: "mine"; id: string; name: string } | { kind: "available"; key: string; name: string };

/**
 * Two lists. Available Templates are made by the system and are the same for every organization (only a future global
 * SuperAdministrator will manage them). My Templates are the organization's own, the ones its campaign editor offers:
 * Administrators add (from Available, or a new one) and remove them, Campaign Managers can only look, and Viewers have no
 * access to Email Templates at all.
 */
export function EmailTemplates() {
  const { role, ready } = useRole();
  const [tab, setTab] = useState<Tab>("Available Templates");
  const [previewing, setPreviewing] = useState<Target | null>(null);

  if (ready && role === "Viewer") {
    return (
      <>
        <PageHeader title="Email Templates" />
        <Notice tone="warn" title="No access">Your role does not have access to Email Templates.</Notice>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Email Templates" description="Start a campaign from a ready-made message. Add the ones you want to My Templates." />
      <div role="tablist" aria-label="Email Templates" className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? "border-brand-600 text-brand-600 dark:text-brand-400" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>{t}</button>
        ))}
      </div>
      {tab === "Available Templates" ? <AvailableTab onPreview={setPreviewing} /> : <MyTemplatesTab onPreview={setPreviewing} />}
      <PreviewModal target={previewing} onClose={() => setPreviewing(null)} />
    </>
  );
}

function AvailableTab({ onPreview }: { onPreview: (t: Target) => void }) {
  const { isAdmin } = useRole();
  const { toast } = useToast();
  const available = useAvailableTemplates();
  const mine = useEmailTemplates();
  const add = useAddAvailableTemplate();
  const items = available.data?.items ?? [];
  const added = new Set((mine.data?.items ?? []).map((t) => t.systemKey).filter((k): k is string => k !== null));

  async function addToMine(key: string, name: string) {
    try {
      await add.mutateAsync(key);
      toast(`"${name}" added to My Templates`);
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Something went wrong", "error");
    }
  }

  return (
    <>
      {!isAdmin && <div className="mb-4"><Notice tone="info">Your role is read-only: you can look at the templates, and an Administrator adds them to My Templates.</Notice></div>}
      <Card>
        {available.isError ? (
          <div className="p-4"><ErrorNotice error={available.error} onRetry={() => void available.refetch()} /></div>
        ) : available.isPending ? (
          <LoadingRows cols={3} rows={5} />
        ) : items.length === 0 ? (
          <Empty>No templates are available yet.</Empty>
        ) : (
          <Table>
            <thead><tr><Th>Template</Th><Th>Type</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.key}>
                  <Td className="font-medium">
                    {t.name}
                    {added.has(t.key) && <span className="ml-2 align-middle"><Badge tone="green">In My Templates</Badge></span>}
                  </Td>
                  <Td><Badge tone="slate">System</Badge></Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button variant="ghost" aria-label={`Preview ${t.name}`} onClick={() => onPreview({ kind: "available", key: t.key, name: t.name })}>Preview</Button>
                    {isAdmin && !added.has(t.key) && (
                      <Button
                        variant="ghost"
                        aria-label={`Add ${t.name} to My Templates`}
                        disabled={add.isPending && add.variables === t.key}
                        onClick={() => void addToMine(t.key, t.name)}
                      >
                        Add to My Templates
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function MyTemplatesTab({ onPreview }: { onPreview: (t: Target) => void }) {
  const { isAdmin } = useRole();
  const { toast } = useToast();
  const list = useEmailTemplates();
  const remove = useRemoveEmailTemplate();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<EmailTemplateSummaryDto | null>(null);
  const items = list.data?.items ?? [];

  async function confirmRemove() {
    if (!removing) return;
    try {
      await remove.mutateAsync(removing.id);
      toast(`"${removing.name}" removed from My Templates`);
      setRemoving(null);
    } catch (e) {
      setRemoving(null);
      toast(e instanceof ApiClientError ? e.message : "Something went wrong", "error");
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">These are the templates offered when writing a campaign.</p>
        {isAdmin && <Button variant="primary" onClick={() => setAdding(true)}>Create template</Button>}
      </div>
      {!isAdmin && <div className="mb-4"><Notice tone="info">Your role is read-only: you can look at My Templates, and an Administrator manages them.</Notice></div>}
      <Card>
        {list.isError ? (
          <div className="p-4"><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : list.isPending ? (
          <LoadingRows cols={4} rows={4} />
        ) : items.length === 0 ? (
          <Empty>My Templates is empty, so campaigns offer no templates.{isAdmin ? " Add one from Available Templates, or create your own." : ""}</Empty>
        ) : (
          <Table>
            <thead><tr><Th>Template</Th><Th>Source</Th><Th>Added</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">{t.name}</Td>
                  <Td><Badge tone={t.systemKey ? "slate" : "blue"}>{t.systemKey ? "From Available" : "Created by you"}</Badge></Td>
                  <Td className="text-slate-500">{fmtDate(t.createdAt)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button variant="ghost" aria-label={`Preview ${t.name}`} onClick={() => onPreview({ kind: "mine", id: t.id, name: t.name })}>Preview</Button>
                    {isAdmin && <Button variant="ghost" className="text-rose-600" aria-label={`Remove ${t.name} from My Templates`} onClick={() => setRemoving(t)}>Remove</Button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {isAdmin && <AddTemplateModal open={adding} onClose={() => setAdding(false)} />}
      <Modal
        open={removing !== null}
        title="Remove template?"
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Keep it</Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => void confirmRemove()}>{remove.isPending ? "Removing…" : "Remove"}</Button>
          </>
        }
      >
        <p className="text-sm">
          <strong>{removing?.name}</strong> will no longer be offered when writing a campaign. Campaigns already written keep their message.
          {removing && removing.systemKey === null && " It was created by you, so it cannot be brought back."}
        </p>
      </Modal>
    </>
  );
}

/** The message as a recipient would see it, filled in with a sample contact. Only the body: the signature, the unsubscribe footer and the postal address are added when a campaign is sent. */
function PreviewModal({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const mine = useEmailTemplate(target?.kind === "mine" ? target.id : null);
  const available = useAvailableTemplate(target?.kind === "available" ? target.key : null);
  const full = target?.kind === "available" ? available : mine;
  const doc = full.data
    ? `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;padding:16px">${composeEmailHtml({ body: full.data.htmlBody, signature: "", companyName: "", postalAddress: "", unsubscribeFooter: false }, SAMPLE_CONTACT)}</body></html>`
    : "";
  return (
    <Modal open={target !== null} title={target?.name ?? "Template"} onClose={onClose} wide footer={<Button onClick={onClose}>Close</Button>}>
      {full.isError ? (
        <ErrorNotice error={full.error} onRetry={() => void full.refetch()} />
      ) : full.isPending ? (
        <LoadingRows rows={4} cols={1} />
      ) : (
        <>
          <iframe title="Template preview" sandbox="" srcDoc={doc} className="h-96 w-full rounded-lg border border-slate-200 bg-white dark:border-slate-800" />
          <p className="mt-2 text-xs text-slate-500">Filled in with a sample contact (Alex, Example Co). The signature, the unsubscribe footer and your postal address are added when a campaign is sent.</p>
        </>
      )}
    </Modal>
  );
}

function AddTemplateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const create = useCreateEmailTemplate();
  const [name, setName] = useState("");
  const [html, setHtml] = useState("");
  const { reset } = create;
  const fieldError = (path: string) => (create.error instanceof ApiClientError ? create.error.fieldErrors.find((f) => f.path === path)?.message : undefined);
  const general = create.error instanceof ApiClientError && !(create.error.fieldErrors.length > 0 && create.error.fieldErrors.every((f) => ["name", "htmlBody"].includes(f.path))) ? create.error.message : create.isError && !(create.error instanceof ApiClientError) ? "Something went wrong. Please try again." : null;
  const unknown = unknownTags(html);
  const complete = name.trim() !== "" && !isBlankHtml(html);

  function close() {
    reset();
    setName("");
    setHtml("");
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!complete || create.isPending) return;
    try {
      const made = await create.mutateAsync({ name: name.trim(), htmlBody: html });
      toast(`Template "${made.name}" created`);
      close();
    } catch {
      /* shown in the dialog */
    }
  }

  return (
    <Modal
      open={open}
      title="Create template"
      onClose={close}
      wide
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-template-form" disabled={!complete || create.isPending}>{create.isPending ? "Creating…" : "Create template"}</Button>
        </>
      }
    >
      <form id="add-template-form" onSubmit={submit} noValidate className="space-y-4">
        <Field label="Template name" htmlFor="tpl-name" hint="Shown in the list and in the campaign dropdown, e.g. the industry it is written for.">
          <TextInput id="tpl-name" autoFocus autoComplete="off" maxLength={100} value={name} onChange={(e) => { setName(e.target.value); reset(); }} aria-invalid={!!fieldError("name")} />
          {fieldError("name") && <p className="mt-1 text-xs text-rose-600">{fieldError("name")}</p>}
        </Field>
        <div>
          <RichTextEditor
            label="Message"
            value={html}
            onChange={(v) => { setHtml(v); reset(); }}
            tags={[...MERGE_FIELDS.map((m) => m.tag), UNSUBSCRIBE_TAG]}
            heightClass="min-h-[14rem]"
            hint="Just the message. A campaign adds your signature, the standard unsubscribe footer and your postal address after it."
          />
          {fieldError("htmlBody") && <p className="mt-1 text-xs text-rose-600">{fieldError("htmlBody")}</p>}
          {!fieldError("htmlBody") && unknown.length > 0 && <p className="mt-1 text-xs text-rose-600">Unknown merge field{unknown.length > 1 ? "s" : ""}: {unknown.join(", ")}</p>}
        </div>
        {general && <Notice tone="error">{general}</Notice>}
        <p className="text-xs text-slate-500">A new template goes straight into My Templates, so campaigns offer it.</p>
      </form>
    </Modal>
  );
}
