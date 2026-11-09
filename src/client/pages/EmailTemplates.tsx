import { useState, type FormEvent } from "react";
import type { EmailTemplateSummaryDto } from "@shared/api";
import { Badge, Button, Card, Empty, ErrorNotice, Field, LoadingRows, Modal, Notice, PageHeader, Table, TextInput, Td, Th, fmtDate } from "@/components/ui";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/useToast";
import { MERGE_FIELDS, SAMPLE_CONTACT, UNSUBSCRIBE_TAG, composeEmailHtml, isBlankHtml, unknownTags } from "@/lib/merge";
import { ApiClientError } from "@/services/http";
import { useCreateEmailTemplate, useEmailTemplate, useEmailTemplates, useSetTemplateSelected } from "@/services/emailTemplates";

/**
 * The organization's email templates: ready-made message bodies a campaign can start from. "Add to My Templates" puts one
 * in the small dropdown shown when writing a campaign (and "Remove from My Templates" takes it out). Administrators and
 * Campaign Managers do that, Viewers only look, and Administrators add new templates.
 */
export function EmailTemplates() {
  const { isAdmin, canEdit } = useRole();
  const { toast } = useToast();
  const list = useEmailTemplates();
  const pick = useSetTemplateSelected();
  const [previewing, setPreviewing] = useState<EmailTemplateSummaryDto | null>(null);
  const [adding, setAdding] = useState(false);
  const items = list.data?.items ?? [];
  const pickedCount = items.filter((t) => t.selected).length;

  async function toggle(t: EmailTemplateSummaryDto, selected: boolean) {
    try {
      await pick.mutateAsync({ id: t.id, selected });
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Something went wrong", "error");
    }
  }

  return (
    <>
      <PageHeader
        title="Email Templates"
        description="Ready-made messages to start a campaign from. Add the ones you want to My Templates."
        actions={isAdmin && <Button variant="primary" onClick={() => setAdding(true)}>Add template</Button>}
      />
      {!canEdit && <div className="mb-4"><Notice tone="info">Your role is read-only: you can look at the templates but not add them to My Templates.</Notice></div>}
      <Card>
        {list.isError ? (
          <div className="p-4"><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : list.isPending ? (
          <LoadingRows cols={4} rows={5} />
        ) : items.length === 0 ? (
          <Empty>No templates yet.</Empty>
        ) : (
          <>
            <div className="border-b border-slate-200 px-5 py-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
              {pickedCount === 0 ? "My Templates is empty, so campaigns offer no templates." : `${pickedCount} of ${items.length} in My Templates, offered when writing a campaign.`}
            </div>
            <Table>
              <thead><tr><Th>Template</Th><Th>Type</Th><Th>Added</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id}>
                    <Td className="font-medium">
                      {t.name}
                      {t.selected && <span className="ml-2 align-middle"><Badge tone="green">In My Templates</Badge></span>}
                    </Td>
                    <Td><Badge tone={t.builtin ? "slate" : "blue"}>{t.builtin ? "Built in" : "Added by you"}</Badge></Td>
                    <Td className="text-slate-500">{fmtDate(t.createdAt)}</Td>
                    <Td className="whitespace-nowrap text-right">
                      <Button variant="ghost" aria-label={`Preview ${t.name}`} onClick={() => setPreviewing(t)}>Preview</Button>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          className={t.selected ? "text-rose-600" : ""}
                          aria-label={`${t.selected ? "Remove" : "Add"} ${t.name} ${t.selected ? "from" : "to"} My Templates`}
                          disabled={pick.isPending && pick.variables?.id === t.id}
                          onClick={() => void toggle(t, !t.selected)}
                        >
                          {t.selected ? "Remove from My Templates" : "Add to My Templates"}
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Card>
      <PreviewModal template={previewing} onClose={() => setPreviewing(null)} />
      {isAdmin && <AddTemplateModal open={adding} onClose={() => setAdding(false)} />}
    </>
  );
}

/** The message as a recipient would see it, filled in with a sample contact. Only the body: the signature, the unsubscribe footer and the postal address are added when a campaign is sent. */
function PreviewModal({ template, onClose }: { template: EmailTemplateSummaryDto | null; onClose: () => void }) {
  const full = useEmailTemplate(template?.id ?? null);
  const doc = full.data
    ? `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;padding:16px">${composeEmailHtml({ body: full.data.htmlBody, signature: "", companyName: "", postalAddress: "", unsubscribeFooter: false }, SAMPLE_CONTACT)}</body></html>`
    : "";
  return (
    <Modal open={template !== null} title={template?.name ?? "Template"} onClose={onClose} wide footer={<Button onClick={onClose}>Close</Button>}>
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
      toast(`Template "${made.name}" added`);
      close();
    } catch {
      /* shown in the dialog */
    }
  }

  return (
    <Modal
      open={open}
      title="Add template"
      onClose={close}
      wide
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-template-form" disabled={!complete || create.isPending}>{create.isPending ? "Adding…" : "Add template"}</Button>
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
        <p className="text-xs text-slate-500">A new template is not offered in campaigns until you add it to My Templates in the list.</p>
      </form>
    </Modal>
  );
}
