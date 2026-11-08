import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CampaignSummaryDto } from "@shared/api";
import { CAMPAIGN_STATUSES, type CampaignStatus } from "@shared/types";
import { isCampaignInFlight } from "@shared/status";
import {
  Button, Card, CampaignStatusBadge, Empty, ErrorNotice, LoadingRows, Modal, PageHeader, Pagination, Select, StackedBar, Table, TextInput, Td, Th, fmt, fmtDay,
} from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useArchiveCampaign, useCampaigns, useDeleteCampaign, useDuplicateCampaign } from "@/services/campaigns";

const PAGE_SIZE = 15;
const statusLabel = (s: CampaignStatus) => (s === "CompletedWithErrors" ? "Completed with errors" : s);
const recipientCount = (c: CampaignSummaryDto) => Object.values(c.totals).reduce((a, b) => a + b, 0);

export function Campaigns() {
  const { canEdit } = useRole();
  const { toast } = useToast();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<CampaignStatus | "">("");
  const [archived, setArchived] = useState<"exclude" | "only">("exclude");
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<CampaignSummaryDto | null>(null);

  const search = useDebounced(q.trim());
  const list = useCampaigns({ page, pageSize: PAGE_SIZE, q: search, status, archived });
  const duplicate = useDuplicateCampaign();
  const archive = useArchiveCampaign();
  const remove = useDeleteCampaign();
  const total = list.data?.total ?? 0;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Something went wrong", "error");
    }
  };

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Each recipient gets their own individually addressed email."
        actions={canEdit && <Link to="/campaigns/new"><Button variant="primary">New campaign</Button></Link>}
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <TextInput className="max-w-xs" placeholder="Search name or subject" aria-label="Search campaigns" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select className="max-w-[14rem]" aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value as CampaignStatus | ""); setPage(1); }}>
            <option value="">All statuses</option>
            {CAMPAIGN_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </Select>
          <Select className="max-w-[12rem]" aria-label="Archived" value={archived} onChange={(e) => { setArchived(e.target.value as "exclude" | "only"); setPage(1); }}>
            <option value="exclude">Active</option>
            <option value="only">Archived</option>
          </Select>
        </div>

        {list.isError ? (
          <div className="p-4"><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></div>
        ) : list.isPending ? (
          <LoadingRows cols={5} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Campaign</Th><Th>Status</Th><Th>Progress</Th><Th className="text-right">Recipients</Th><Th>Created</Th><Th><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <Td>
                      <Link to={c.status === "Draft" ? `/campaigns/${c.id}/edit` : `/campaigns/${c.id}`} className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400">{c.name}</Link>
                      <p className="max-w-md truncate text-xs text-slate-500">{c.subject}</p>
                    </Td>
                    <Td><CampaignStatusBadge status={c.status} /></Td>
                    <Td className="w-48">{recipientCount(c) > 0 ? <StackedBar totals={c.totals} /> : <span className="text-xs text-slate-400">Not launched</span>}</Td>
                    <Td className="text-right tabular-nums">{recipientCount(c) > 0 ? fmt(recipientCount(c)) : "n/a"}</Td>
                    <Td className="whitespace-nowrap text-slate-500">{fmtDay(c.createdAt)}<br /><span className="text-xs">{c.createdBy}</span></Td>
                    <Td className="text-right">
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" disabled={duplicate.isPending} onClick={() => run(async () => { const d = await duplicate.mutateAsync(c.id); nav(`/campaigns/${d.id}/edit`); }, "Duplicated as a new draft")}>Duplicate</Button>
                          {c.archivedAt ? (
                            <Button variant="ghost" onClick={() => run(() => archive.mutateAsync({ id: c.id, archived: false }), "Restored")}>Restore</Button>
                          ) : (
                            !isCampaignInFlight(c.status) && <Button variant="ghost" onClick={() => run(() => archive.mutateAsync({ id: c.id, archived: true }), "Archived")}>Archive</Button>
                          )}
                          {c.status === "Draft" && <Button variant="ghost" className="text-rose-600" onClick={() => setToDelete(c)}>Delete</Button>}
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {list.data.items.length === 0 && (
              <Empty>{search || status ? "No campaigns match your filters." : archived === "only" ? "No archived campaigns." : "No campaigns yet. Create your first one."}</Empty>
            )}
            <Pagination page={page} pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={toDelete !== null}
        title="Delete this draft?"
        onClose={() => setToDelete(null)}
        footer={
          <>
            <Button onClick={() => setToDelete(null)}>Keep</Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => toDelete && run(async () => { await remove.mutateAsync(toDelete.id); setToDelete(null); }, "Draft deleted")}>Delete draft</Button>
          </>
        }
      >
        <p className="text-sm">"{toDelete?.name}" will be permanently deleted. Only drafts can be deleted. Launched campaigns can be archived instead.</p>
      </Modal>
    </>
  );
}
