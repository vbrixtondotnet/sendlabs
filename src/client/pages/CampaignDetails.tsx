import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CampaignDto } from "@shared/api";
import { CAMPAIGN_ACTIONS } from "@shared/status";
import { RECIPIENT_STATUSES, type RecipientStatus } from "@shared/types";
import {
  Button, Card, CardHeader, CampaignStatusBadge, Empty, ErrorNotice, LoadingRows, Modal, Notice, PageHeader, Pagination, ProgressBar,
  RecipientStatusBadge, Select, StackedBar, StatCard, Table, TextInput, Td, Th, fmt, fmtDate, recipientLabel, segmentColors,
} from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useCampaign, useCampaignAction, useRecipients } from "@/services/campaigns";

const STATUS_ORDER: RecipientStatus[] = ["Accepted", "Processing", "Queued", "Pending", "Failed", "Skipped", "Cancelled"];
const PAGE_SIZE = 12;

export function CampaignDetails() {
  const { id = "" } = useParams();
  const campaign = useCampaign(id);

  if (campaign.isPending) {
    return <><PageHeader title="Campaign" /><Card><LoadingRows rows={4} cols={4} /></Card></>;
  }
  if (campaign.isError) {
    const notFound = campaign.error instanceof ApiClientError && campaign.error.status === 404;
    return (
      <>
        <PageHeader title={notFound ? "Campaign not found" : "Campaign"} />
        {notFound ? <Link to="/campaigns" className="text-brand-600 hover:underline">Back to campaigns</Link> : <ErrorNotice error={campaign.error} onRetry={() => void campaign.refetch()} />}
      </>
    );
  }
  return <Details campaign={campaign.data} />;
}

function Details({ campaign }: { campaign: CampaignDto }) {
  const { canEdit } = useRole();
  const { toast } = useToast();
  const act = useCampaignAction();
  const [status, setStatus] = useState<RecipientStatus | "">("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const sending = campaign.status === "Sending";
  const search = useDebounced(q.trim());
  const recipients = useRecipients(campaign.id, { page, pageSize: PAGE_SIZE, q: search, status }, sending);

  const t = campaign.totals;
  const total = RECIPIENT_STATUSES.reduce((n, s) => n + t[s], 0);
  const awaiting = t.Pending + t.Queued + t.Processing;
  const daysLeft = Math.ceil(t.Pending / campaign.dailyLimit);
  const can = (a: keyof typeof CAMPAIGN_ACTIONS) => (CAMPAIGN_ACTIONS[a].from as readonly string[]).includes(campaign.status);

  async function run(action: keyof typeof CAMPAIGN_ACTIONS, message: string) {
    try {
      await act.mutateAsync({ id: campaign.id, action });
      toast(message, "info");
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Something went wrong", "error");
    }
    setConfirmCancel(false);
  }

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={`Subject: ${campaign.subject}`}
        actions={
          <>
            <CampaignStatusBadge status={campaign.status} />
            {canEdit && campaign.status === "Draft" && <Link to={`/campaigns/${campaign.id}/edit`}><Button variant="primary">Edit draft</Button></Link>}
            {canEdit && can("pause") && <Button disabled={act.isPending} onClick={() => run("pause", "Campaign paused")}>Pause</Button>}
            {canEdit && can("resume") && <Button variant="primary" disabled={act.isPending} onClick={() => run("resume", "Campaign resumed")}>Resume</Button>}
            {canEdit && can("cancel") && <Button variant="danger" onClick={() => setConfirmCancel(true)}>Cancel campaign</Button>}
          </>
        }
      />

      <p className="-mt-3 mb-5 text-sm text-slate-500">
        Created by {campaign.createdBy} · {fmtDate(campaign.createdAt)}
        {campaign.launchedAt && <> · launched {fmtDate(campaign.launchedAt)}</>}
      </p>

      {campaign.status === "Paused" && <div className="mb-4"><Notice tone="warn">Paused. No further messages will be queued until you resume.</Notice></div>}
      {campaign.status === "Cancelled" && <div className="mb-4"><Notice>Cancelled. Unsent recipients were marked Cancelled. Messages already accepted cannot be recalled.</Notice></div>}
      {campaign.status === "Draft" && <div className="mb-4"><Notice>This campaign is a draft. Launching is not connected yet, so no recipients exist.</Notice></div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Recipients" value={fmt(total)} />
        <StatCard label="Accepted by Gmail" value={fmt(t.Accepted)} tone="good" hint={total ? `${((t.Accepted / total) * 100).toFixed(1)}% of list` : undefined} />
        <StatCard label="Awaiting send" value={fmt(awaiting)} hint="Pending, queued, processing" />
        <StatCard label="Failed" value={fmt(t.Failed)} tone={t.Failed ? "bad" : "default"} />
        <StatCard label="Skipped" value={fmt(t.Skipped)} tone={t.Skipped ? "warn" : "default"} hint="Suppressed or ineligible" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Progress" />
          <div className="space-y-4 p-5">
            {total > 0 ? <StackedBar totals={t} /> : <p className="text-sm text-slate-500">No recipients yet.</p>}
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {STATUS_ORDER.filter((s) => t[s] > 0).map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${segmentColors[s]}`} aria-hidden="true" />
                  {recipientLabel[s]} <span className="tabular-nums text-slate-500">{fmt(t[s])}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">"Accepted by Gmail" means Google accepted the message for processing. It does not confirm inbox delivery.</p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Daily drip" />
          <div className="space-y-4 p-5 text-sm">
            {total > 0 && awaiting > 0 ? (
              <>
                <div>
                  <div className="mb-1.5 flex justify-between"><span className="font-medium">Overall</span><span className="tabular-nums text-slate-500">{fmt(t.Accepted)} / {fmt(total)}</span></div>
                  <ProgressBar value={t.Accepted} max={total} />
                </div>
                <dl className="space-y-1.5">
                  <div className="flex justify-between"><dt className="text-slate-500">Daily cap</dt><dd>{fmt(campaign.dailyLimit)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Window</dt><dd>{campaign.sendWindowStart} to {campaign.sendWindowEnd}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Timezone</dt><dd>{campaign.timezone}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Days remaining</dt><dd>about {Math.max(1, daysLeft)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Next run</dt><dd className="text-right">{campaign.status === "Paused" ? "Paused" : campaign.nextRunAt ? fmtDate(campaign.nextRunAt) : "Not scheduled"}</dd></div>
                </dl>
              </>
            ) : (
              <dl className="space-y-1.5">
                <div className="flex justify-between"><dt className="text-slate-500">Daily cap</dt><dd>{fmt(campaign.dailyLimit)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Window</dt><dd>{campaign.sendWindowStart} to {campaign.sendWindowEnd}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Timezone</dt><dd>{campaign.timezone}</dd></div>
                <p className="pt-2 text-slate-500">{total === 0 ? "Not launched yet." : "Nothing left to send. The daily schedule has stopped."}</p>
              </dl>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recipients" subtitle="Paginated, in send order. Each row is one independent email." />
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <TextInput className="max-w-xs" placeholder="Search by email" aria-label="Search recipients" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select className="max-w-[14rem]" aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value as RecipientStatus | ""); setPage(1); }}>
            <option value="">All statuses</option>
            {STATUS_ORDER.filter((s) => t[s] > 0).map((s) => <option key={s} value={s}>{recipientLabel[s]} ({fmt(t[s])})</option>)}
          </Select>
        </div>
        {recipients.isError ? (
          <div className="p-4"><ErrorNotice error={recipients.error} onRetry={() => void recipients.refetch()} /></div>
        ) : recipients.isPending ? (
          <LoadingRows cols={5} />
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>Recipient</Th><Th>Status</Th><Th className="text-right">Attempts</Th><Th>Accepted at</Th><Th>Note</Th></tr>
              </thead>
              <tbody>
                {recipients.data.items.map((r) => {
                  const name = [r.personalization.firstName, r.personalization.lastName].filter(Boolean).join(" ");
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <Td>{name && <span className="font-medium">{name}</span>}<p className={name ? "text-xs text-slate-500" : ""}>{r.email}</p></Td>
                      <Td><RecipientStatusBadge status={r.status} /></Td>
                      <Td className="text-right tabular-nums">{r.attemptCount}</Td>
                      <Td className="whitespace-nowrap text-slate-500">{fmtDate(r.acceptedAt)}</Td>
                      <Td className="max-w-xs text-xs text-slate-600 dark:text-slate-300">{r.lastError ?? r.skipReason ?? ""}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {recipients.data.items.length === 0 && <Empty>{total === 0 ? "No recipients yet." : "No recipients match."}</Empty>}
            <Pagination page={page} pageCount={Math.max(1, Math.ceil(recipients.data.total / PAGE_SIZE))} total={recipients.data.total} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={confirmCancel}
        title="Cancel this campaign?"
        onClose={() => setConfirmCancel(false)}
        footer={
          <>
            <Button onClick={() => setConfirmCancel(false)}>Go back</Button>
            <Button variant="danger" disabled={act.isPending} onClick={() => run("cancel", "Campaign cancelled")}>Cancel campaign</Button>
          </>
        }
      >
        <p className="text-sm">Unsent recipients ({fmt(t.Pending + t.Queued)}) will be marked Cancelled. Emails Gmail has already accepted cannot be recalled, and anything mid-send may still go out.</p>
      </Modal>
    </>
  );
}
