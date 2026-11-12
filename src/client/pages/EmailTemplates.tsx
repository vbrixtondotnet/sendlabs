import { useState, type FormEvent } from "react";
import type { AvailableTemplateDto, EmailTemplateSummaryDto } from "@shared/api";
import { Badge, Button, Card, Empty, ErrorNotice, Field, LoadingRows, Modal, Notice, PageHeader, Pagination, Table, TextInput, Td, Th, fmtDate } from "@/components/ui";
import { RichTextEditor } from "@/components/RichTextEditor";
import { RowActions, type RowAction } from "@/components/RowActions";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/useToast";
import { MERGE_FIELDS, SAMPLE_CONTACT, UNSUBSCRIBE_TAG, composeEmailHtml, isBlankHtml, unknownTags } from "@/lib/merge";
import { ApiClientError } from "@/services/http";
import {
  useAddAvailableTemplate, useAvailableTemplate, useAvailableTemplates, useCreateAvailableTemplate, useCreateEmailTemplate, useEmailTemplate, useEmailTemplates,
  useRemoveAvailableTemplate, useRemoveEmailTemplate, useUpdateAvailableTemplate,
} from "@/services/emailTemplates";

const PAGE_SIZE = 10;

/** Client-side paging for a list the API returns whole (at most 200 rows). Steps back if the current page empties. */
function usePaged<T>(items: T[]) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  return { page: current, pageCount, setPage, total: items.length, rows: items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE) };
}

const TABS = ["Available Templates", "My Templates"] as const;
type Tab = (typeof TABS)[number];

/** What is being previewed: one of My Templates or an Available one, both by id. */
type Target = { kind: "mine" | "available"; id: string; name: string };

/**
 * Two lists. Available Templates are made by the system and are the same for every organization: only the global
 * SuperAdministrator creates, edits and deletes them, and that is the only thing a SuperAdministrator sees here (it belongs
 * to no organization, so it has no My Templates). My Templates are the organization's own, the ones its campaign editor
 * offers: Administrators add (from Available, or a new one) and remove them, Campaign Managers can only look, and Viewers
 * have no access to Email Templates at all.
 */
export function EmailTemplates() {
  const { role, ready, isSuperAdmin } = useRole();
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

  if (isSuperAdmin) {
    return (
      <>
        <AvailableTab onPreview={setPreviewing} />
        <PreviewModal target={previewing} onClose={() => setPreviewing(null)} />
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
  const { isAdmin, isSuperAdmin } = useRole();
  const { toast } = useToast();
  const available = useAvailableTemplates();
  // A SuperAdministrator has no My Templates (and the API would refuse), so the list is only read for the others.
  const mine = useEmailTemplates(!isSuperAdmin);
  const add = useAddAvailableTemplate();
  const create = useCreateAvailableTemplate();
  const remove = useRemoveAvailableTemplate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AvailableTemplateDto | null>(null);
  const [removing, setRemoving] = useState<AvailableTemplateDto | null>(null);
  const items = available.data?.items ?? [];
  const paged = usePaged(items);
  const added = new Set((mine.data?.items ?? []).map((t) => t.systemKey).filter((k): k is string => k !== null));

  async function addToMine(id: string, name: string) {
    try {
      await add.mutateAsync(id);
      toast(`"${name}" added to My Templates`);
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Something went wrong", "error");
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    try {
      await remove.mutateAsync(removing.id);
      toast(`"${removing.name}" deleted`);
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Something went wrong", "error");
    }
    setRemoving(null);
  }

  return (
    <>
      {isSuperAdmin && (
        <PageHeader
          title="Available Templates"
          description="Made by the system and shared by every organization. An Administrator can add them to their own My Templates; their copy is not changed by what you do here."
          actions={<Button variant="primary" onClick={() => setCreating(true)}>Create template</Button>}
        />
      )}
      {!isAdmin && !isSuperAdmin && <div className="mb-4"><Notice tone="info">Your role is read-only: you can look at the templates, and an Administrator adds them to My Templates.</Notice></div>}
      <Card>
        {available.isError ? (
          <div className="p-4"><ErrorNotice error={available.error} onRetry={() => void available.refetch()} /></div>
        ) : available.isPending ? (
          <LoadingRows cols={3} rows={5} />
        ) : items.length === 0 ? (
          <Empty>No templates are available yet.</Empty>
        ) : (
          <Table>
            <thead><tr><Th>Template</Th><Th>{isSuperAdmin ? "Updated" : "Type"}</Th><Th className="text-right"><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {paged.rows.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">
                    {t.name}
                    {added.has(t.id) && <span className="ml-2 align-middle"><Badge tone="green">In My Templates</Badge></span>}
                  </Td>
                  <Td>{isSuperAdmin ? <span className="text-slate-500">{fmtDate(t.updatedAt)}</span> : <Badge tone="slate">System</Badge>}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <RowActions
                      label={`Actions for ${t.name}`}
                      actions={[
                        { label: "Preview", icon: "preview", ariaLabel: `Preview ${t.name}`, onSelect: () => onPreview({ kind: "available", id: t.id, name: t.name }) },
                        ...(isAdmin && !added.has(t.id)
                          ? [{ label: "Add to My Templates", icon: "add", ariaLabel: `Add ${t.name} to My Templates`, disabled: add.isPending && add.variables === t.id, onSelect: () => void addToMine(t.id, t.name) }]
                          : []),
                        ...(isSuperAdmin
                          ? [
                              { label: "Edit", icon: "edit", ariaLabel: `Edit ${t.name}`, onSelect: () => setEditing(t) },
                              { label: "Delete", icon: "delete", ariaLabel: `Delete ${t.name}`, danger: true, onSelect: () => setRemoving(t) },
                            ]
                          : []),
                      ] as RowAction[]}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {paged.total > PAGE_SIZE && <Pagination page={paged.page} pageCount={paged.pageCount} total={paged.total} pageSize={PAGE_SIZE} onPage={paged.setPage} />}
      </Card>
      {isSuperAdmin && creating && (
        <TemplateFormModal
          title="Create template"
          submitLabel="Create template"
          note="A new template is offered to every organization's Administrators, who can add it to their My Templates."
          onSubmit={async (input) => { const made = await create.mutateAsync(input); toast(`Template "${made.name}" created`); }}
          onClose={() => setCreating(false)}
        />
      )}
      {isSuperAdmin && editing && <EditAvailableModal template={editing} onClose={() => setEditing(null)} />}
      {isSuperAdmin && (
        <Modal
          open={removing !== null}
          title="Delete template?"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button onClick={() => setRemoving(null)}>Keep it</Button>
              <Button variant="danger" disabled={remove.isPending} onClick={() => void confirmRemove()}>{remove.isPending ? "Deleting…" : "Delete"}</Button>
            </>
          }
        >
          <p className="text-sm">
            <strong>{removing?.name}</strong> will no longer be available to add. Copies organizations already added to their My Templates stay as they are.
          </p>
        </Modal>
      )}
    </>
  );
}

/** Opens the form for an Available Template once its message has loaded. */
function EditAvailableModal({ template, onClose }: { template: AvailableTemplateDto; onClose: () => void }) {
  const { toast } = useToast();
  const full = useAvailableTemplate(template.id);
  const update = useUpdateAvailableTemplate();
  if (full.isPending || full.isError) {
    return (
      <Modal open title={`Edit ${template.name}`} onClose={onClose} wide footer={<Button onClick={onClose}>Close</Button>}>
        {full.isError ? <ErrorNotice error={full.error} onRetry={() => void full.refetch()} /> : <LoadingRows rows={4} cols={1} />}
      </Modal>
    );
  }
  return (
    <TemplateFormModal
      title={`Edit ${template.name}`}
      submitLabel="Save changes"
      initial={{ name: full.data.name, html: full.data.htmlBody }}
      note="Copies organizations already added to their My Templates are not changed."
      onSubmit={async (input) => { const saved = await update.mutateAsync({ id: template.id, ...input }); toast(`Template "${saved.name}" saved`); }}
      onClose={onClose}
    />
  );
}

function MyTemplatesTab({ onPreview }: { onPreview: (t: Target) => void }) {
  const { isAdmin } = useRole();
  const { toast } = useToast();
  const list = useEmailTemplates();
  const remove = useRemoveEmailTemplate();
  const create = useCreateEmailTemplate();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<EmailTemplateSummaryDto | null>(null);
  const items = list.data?.items ?? [];
  const paged = usePaged(items);

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
            <thead><tr><Th>Template</Th><Th>Source</Th><Th>Added</Th><Th className="text-right"><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {paged.rows.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">{t.name}</Td>
                  <Td><Badge tone={t.systemKey ? "slate" : "blue"}>{t.systemKey ? "From Available" : "Created by you"}</Badge></Td>
                  <Td className="text-slate-500">{fmtDate(t.createdAt)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <RowActions
                      label={`Actions for ${t.name}`}
                      actions={[
                        { label: "Preview", icon: "preview", ariaLabel: `Preview ${t.name}`, onSelect: () => onPreview({ kind: "mine", id: t.id, name: t.name }) },
                        ...(isAdmin ? [{ label: "Remove", icon: "delete", ariaLabel: `Remove ${t.name} from My Templates`, danger: true, onSelect: () => setRemoving(t) }] : []),
                      ] as RowAction[]}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {paged.total > PAGE_SIZE && <Pagination page={paged.page} pageCount={paged.pageCount} total={paged.total} pageSize={PAGE_SIZE} onPage={paged.setPage} />}
      </Card>
      {isAdmin && adding && (
        <TemplateFormModal
          title="Create template"
          submitLabel="Create template"
          note="A new template goes straight into My Templates, so campaigns offer it."
          onSubmit={async (input) => { const made = await create.mutateAsync(input); toast(`Template "${made.name}" created`); }}
          onClose={() => setAdding(false)}
        />
      )}
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
  const available = useAvailableTemplate(target?.kind === "available" ? target.id : null);
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

/**
 * A name and a message in a dialog. Used to create (empty) and to edit (`initial`). It is mounted only while open, so it
 * always starts from `initial`. `onSubmit` does the saving and throws if the server refuses; the reason is shown here.
 */
function TemplateFormModal({ title, submitLabel, initial, note, onSubmit, onClose }: {
  title: string;
  submitLabel: string;
  initial?: { name: string; html: string };
  note: string;
  onSubmit: (input: { name: string; htmlBody: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [html, setHtml] = useState(initial?.html ?? "");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const fieldError = (path: string) => (error instanceof ApiClientError ? error.fieldErrors.find((f) => f.path === path)?.message : undefined);
  const general = error === null ? null
    : error instanceof ApiClientError ? (error.fieldErrors.length > 0 && error.fieldErrors.every((f) => ["name", "htmlBody"].includes(f.path)) ? null : error.message)
    : "Something went wrong. Please try again.";
  const unknown = unknownTags(html);
  const complete = name.trim() !== "" && !isBlankHtml(html);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!complete || pending) return;
    setPending(true);
    try {
      await onSubmit({ name: name.trim(), htmlBody: html });
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="template-form" disabled={!complete || pending}>{pending ? "Saving…" : submitLabel}</Button>
        </>
      }
    >
      <form id="template-form" onSubmit={submit} noValidate className="space-y-4">
        <Field label="Template name" htmlFor="tpl-name" hint="Shown in the list and in the campaign dropdown, e.g. the industry it is written for.">
          <TextInput id="tpl-name" autoFocus autoComplete="off" maxLength={100} value={name} onChange={(e) => { setName(e.target.value); setError(null); }} aria-invalid={!!fieldError("name")} />
          {fieldError("name") && <p className="mt-1 text-xs text-rose-600">{fieldError("name")}</p>}
        </Field>
        <div>
          <RichTextEditor
            label="Message"
            value={html}
            onChange={(v) => { setHtml(v); setError(null); }}
            tags={[...MERGE_FIELDS.map((m) => m.tag), UNSUBSCRIBE_TAG]}
            heightClass="min-h-[14rem]"
            hint="Just the message. A campaign adds your signature, the standard unsubscribe footer and your postal address after it."
          />
          {fieldError("htmlBody") && <p className="mt-1 text-xs text-rose-600">{fieldError("htmlBody")}</p>}
          {!fieldError("htmlBody") && unknown.length > 0 && <p className="mt-1 text-xs text-rose-600">Unknown merge field{unknown.length > 1 ? "s" : ""}: {unknown.join(", ")}</p>}
        </div>
        {general && <Notice tone="error">{general}</Notice>}
        <p className="text-xs text-slate-500">{note}</p>
      </form>
    </Modal>
  );
}
