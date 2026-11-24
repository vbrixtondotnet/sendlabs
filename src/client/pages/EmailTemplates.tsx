import { useState } from "react";
import type { AvailableTemplateDto, EmailTemplateSummaryDto } from "@shared/api";
import { Badge, Button, Empty, ErrorNotice, FillPage, LoadingRows, Modal, PageHeader, Pagination, Table, TableCard, Td, Th, fmtDate } from "@/components/ui";
import { TemplateEditPanel } from "@/components/panels/TemplateEditPanel";
import { TemplatePreviewPanel, type TemplateTarget } from "@/components/panels/TemplatePreviewPanel";
import { RowActions, type RowAction } from "@/components/RowActions";
import { useRole } from "@/hooks/useRole";
import { usePanel } from "@/hooks/usePanel";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import {
  useAddAvailableTemplate, useAvailableTemplate, useAvailableTemplates, useCreateAvailableTemplate, useCreateEmailTemplate, useEmailTemplate, useEmailTemplates,
  useRemoveAvailableTemplate, useRemoveEmailTemplate, useUpdateAvailableTemplate, useUpdateEmailTemplate,
} from "@/services/emailTemplates";

const PAGE_SIZE = 50;

/** Client-side paging for a list the API returns whole (at most 200 rows). Steps back if the current page empties. */
function usePaged<T>(items: T[]) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  return { page: current, pageCount, setPage, total: items.length, rows: items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE) };
}

const TABS = ["Available Templates", "My Templates"] as const;
type Tab = (typeof TABS)[number];

/**
 * Two lists. Available Templates are starter templates made by the system: read-only, the same for every account (they change
 * only with a release). My Templates are the account's own, the ones its campaign editor offers: add (from Available, or a new
 * one), edit and remove them.
 */
export function EmailTemplates() {
  const { role } = useRole();
  const [tab, setTab] = useState<Tab>("Available Templates");
  const preview = usePanel<TemplateTarget>();
  const previewPanel = preview.item && (
    <TemplatePreviewPanel key={`${preview.item.kind}-${preview.item.id}-${preview.nonce}`} target={preview.item} open={preview.open} onClose={preview.close} onExited={preview.onExited} />
  );

  // A SuperAdmin manages the Available Templates and has no My Templates.
  if (role === "SuperAdmin") {
    return (
      <FillPage>
        <AvailableAdmin />
      </FillPage>
    );
  }

  return (
    <FillPage>
      <PageHeader title="Email Templates" description="Start a campaign from a ready-made message. Add the ones you want to My Templates." />
      <div role="tablist" aria-label="Email Templates" className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? "border-brand-600 text-brand-600 dark:text-brand-400" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>{t}</button>
        ))}
      </div>
      {tab === "Available Templates" ? <AvailableTab onPreview={preview.show} /> : <MyTemplatesTab onPreview={preview.show} />}
      {previewPanel}
    </FillPage>
  );
}

function AvailableTab({ onPreview }: { onPreview: (t: TemplateTarget) => void }) {
  const { toast } = useToast();
  const available = useAvailableTemplates();
  const mine = useEmailTemplates();
  const add = useAddAvailableTemplate();
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

  return (
    <>
      <TableCard>
        {available.isError ? (
          <div className="p-4"><ErrorNotice error={available.error} onRetry={() => void available.refetch()} /></div>
        ) : available.isPending ? (
          <LoadingRows cols={3} rows={5} />
        ) : items.length === 0 ? (
          <Empty>No templates are available yet.</Empty>
        ) : (
          <Table fill>
            <thead><tr><Th>Template</Th><Th>Type</Th><Th className="text-right"><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {paged.rows.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">
                    {t.name}
                    {added.has(t.id) && <span className="ml-2 align-middle"><Badge tone="green">In My Templates</Badge></span>}
                  </Td>
                  <Td><Badge tone="slate">System</Badge></Td>
                  <Td className="whitespace-nowrap text-right">
                    <RowActions
                      label={`Actions for ${t.name}`}
                      actions={[
                        { label: "View", icon: "preview", ariaLabel: `View ${t.name}`, onSelect: () => onPreview({ kind: "available", id: t.id, name: t.name }) },
                        ...(!added.has(t.id)
                          ? [{ label: "Add to My Templates", icon: "add", ariaLabel: `Add ${t.name} to My Templates`, disabled: add.isPending && add.variables === t.id, onSelect: () => void addToMine(t.id, t.name) }]
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
      </TableCard>
    </>
  );
}

/** The SuperAdmin's view: create, edit and delete the Available Templates every account can copy from. */
function AvailableAdmin() {
  const view = usePanel<TemplateTarget>();
  const { toast } = useToast();
  const available = useAvailableTemplates();
  const create = useCreateAvailableTemplate();
  const remove = useRemoveAvailableTemplate();
  const form = usePanel<AvailableTemplateDto | "new">();
  const [removing, setRemoving] = useState<AvailableTemplateDto | null>(null);
  const items = available.data?.items ?? [];
  const paged = usePaged(items);

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
      <PageHeader
        title="Email Templates"
        description="The starter templates every account can copy into its own My Templates. A copy already made is not changed by what you do here."
        actions={<Button variant="primary" onClick={() => form.show("new")}>Create template</Button>}
      />
      <TableCard>
        {available.isError ? (
          <div className="p-4"><ErrorNotice error={available.error} onRetry={() => void available.refetch()} /></div>
        ) : available.isPending ? (
          <LoadingRows cols={3} rows={5} />
        ) : items.length === 0 ? (
          <Empty>No templates yet.</Empty>
        ) : (
          <Table fill>
            <thead><tr><Th>Template</Th><Th>Updated</Th><Th className="text-right"><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>
              {paged.rows.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">{t.name}</Td>
                  <Td><span className="text-slate-500">{fmtDate(t.updatedAt)}</span></Td>
                  <Td className="whitespace-nowrap text-right">
                    <RowActions
                      label={`Actions for ${t.name}`}
                      actions={[
                        { label: "View", icon: "preview", ariaLabel: `View ${t.name}`, onSelect: () => view.show({ kind: "available", id: t.id, name: t.name }) },
                        { label: "Delete", icon: "delete", ariaLabel: `Delete ${t.name}`, danger: true, onSelect: () => setRemoving(t) },
                      ] as RowAction[]}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {paged.total > PAGE_SIZE && <Pagination page={paged.page} pageCount={paged.pageCount} total={paged.total} pageSize={PAGE_SIZE} onPage={paged.setPage} />}
      </TableCard>
      {view.item && (
        <TemplatePreviewPanel
          key={`${view.item.id}-${view.nonce}`}
          target={view.item}
          open={view.open}
          onClose={view.close}
          onExited={view.onExited}
          onEdit={() => {
            const t = items.find((x) => x.id === view.item?.id);
            view.close();
            if (t) form.show(t);
          }}
        />
      )}
      {form.item === "new" && (
        <TemplateEditPanel
          key={`new-available-${form.nonce}`}
          open={form.open}
          onExited={form.onExited}
          title="Create template"
          submitLabel="Create template"
          note="A new template is offered to every account, which can copy it into its My Templates."
          onSubmit={async (input) => { const made = await create.mutateAsync(input); toast(`Template "${made.name}" created`); }}
          onClose={form.close}
        />
      )}
      {form.item && form.item !== "new" && <EditAvailablePanel key={`${form.item.id}-${form.nonce}`} template={form.item} open={form.open} onClose={form.close} onExited={form.onExited} />}
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
        <p className="text-sm"><strong>{removing?.name}</strong> will no longer be available to copy. Copies accounts already made stay as they are.</p>
      </Modal>
    </>
  );
}

/** Edit an Available Template (SuperAdmin) in a SlidePanel. It opens at once and fills in when the message has loaded. */
function EditAvailablePanel({ template, open, onClose, onExited }: { template: AvailableTemplateDto; open: boolean; onClose: () => void; onExited: () => void }) {
  const { toast } = useToast();
  const full = useAvailableTemplate(template.id);
  const update = useUpdateAvailableTemplate();
  return (
    <TemplateEditPanel
      open={open}
      onExited={onExited}
      title={`Edit ${template.name}`}
      submitLabel="Save changes"
      initial={full.data ? { name: full.data.name, html: full.data.htmlBody } : "loading"}
      loadError={full.isError ? <ErrorNotice error={full.error} onRetry={() => void full.refetch()} /> : undefined}
      note="Copies accounts already made are not changed."
      onSubmit={async (input) => { const saved = await update.mutateAsync({ id: template.id, ...input }); toast(`Template "${saved.name}" saved`); }}
      onClose={onClose}
    />
  );
}

/** Edit one of My Templates in a SlidePanel. It opens at once and fills in when the message has loaded. */
function EditMinePanel({ template, open, onClose, onExited }: { template: EmailTemplateSummaryDto; open: boolean; onClose: () => void; onExited: () => void }) {
  const { toast } = useToast();
  const full = useEmailTemplate(template.id);
  const update = useUpdateEmailTemplate();
  return (
    <TemplateEditPanel
      open={open}
      onExited={onExited}
      title={`Edit ${template.name}`}
      submitLabel="Save changes"
      initial={full.data ? { name: full.data.name, html: full.data.htmlBody } : "loading"}
      loadError={full.isError ? <ErrorNotice error={full.error} onRetry={() => void full.refetch()} /> : undefined}
      note={template.systemKey ? "This changes only your copy. The version in Available Templates stays as it is." : "This changes the template campaigns offer. Campaigns already written keep their message."}
      onSubmit={async (input) => { const saved = await update.mutateAsync({ id: template.id, ...input }); toast(`Template "${saved.name}" saved`); }}
      onClose={onClose}
    />
  );
}

function MyTemplatesTab({ onPreview }: { onPreview: (t: TemplateTarget) => void }) {
  const { toast } = useToast();
  const list = useEmailTemplates();
  const remove = useRemoveEmailTemplate();
  const create = useCreateEmailTemplate();
  const form = usePanel<EmailTemplateSummaryDto | "new">();
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
        <Button variant="primary" onClick={() => form.show("new")}>Create template</Button>
      </div>
      <TableCard>
        {list.isError ? (
          <div className="p-4"><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : list.isPending ? (
          <LoadingRows cols={4} rows={4} />
        ) : items.length === 0 ? (
          <Empty>My Templates is empty, so campaigns offer no templates. Add one from Available Templates, or create your own.</Empty>
        ) : (
          <Table fill>
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
                        { label: "View", icon: "preview", ariaLabel: `View ${t.name}`, onSelect: () => onPreview({ kind: "mine", id: t.id, name: t.name }) },
                        { label: "Edit", icon: "edit", ariaLabel: `Edit ${t.name}`, onSelect: () => form.show(t) },
                        { label: "Remove", icon: "delete", ariaLabel: `Remove ${t.name} from My Templates`, danger: true, onSelect: () => setRemoving(t) },
                      ] as RowAction[]}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {paged.total > PAGE_SIZE && <Pagination page={paged.page} pageCount={paged.pageCount} total={paged.total} pageSize={PAGE_SIZE} onPage={paged.setPage} />}
      </TableCard>
      {form.item === "new" && (
        <TemplateEditPanel
          key={`new-mine-${form.nonce}`}
          open={form.open}
          onExited={form.onExited}
          title="Create template"
          submitLabel="Create template"
          note="A new template goes straight into My Templates, so campaigns offer it."
          onSubmit={async (input) => { const made = await create.mutateAsync(input); toast(`Template "${made.name}" created`); }}
          onClose={form.close}
        />
      )}
      {form.item && form.item !== "new" && <EditMinePanel key={`${form.item.id}-${form.nonce}`} template={form.item} open={form.open} onClose={form.close} onExited={form.onExited} />}
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
