import { Link } from "react-router-dom";
import type { CampaignSummaryDto } from "@shared/api";
import { RECIPIENT_STATUSES, type RecipientStatus } from "@shared/types";
import { Button, Card, CardHeader, CampaignStatusBadge, ErrorNotice, LoadingRows, Notice, PageHeader, ProgressBar, StackedBar, StatCard, fmt, fmtDate } from "@/components/ui";
import { useRole } from "@/hooks/useRole";
import { useCampaigns } from "@/services/campaigns";
import { useContacts } from "@/services/contacts";

const count = (c: CampaignSummaryDto) => RECIPIENT_STATUSES.reduce((n, s) => n + c.totals[s], 0);

export function Overview() {
  const { canEdit } = useRole();
  // The API has no dashboard endpoint yet, so the figures are derived from the 100 newest active campaigns.
  const list = useCampaigns({ page: 1, pageSize: 100, archived: "exclude" }, { refetchMs: 15_000 });
  const contacts = useContacts({ page: 1, pageSize: 1 });

  const actions = canEdit && (
    <>
      <Link to="/imports"><Button>Import contacts</Button></Link>
      <Link to="/campaigns/new"><Button variant="primary">New campaign</Button></Link>
    </>
  );

  if (list.isError) {
    return (<><PageHeader title="Overview" actions={actions} /><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></>);
  }
  if (list.isPending) {
    return (<><PageHeader title="Overview" actions={actions} /><Card><LoadingRows rows={5} cols={4} /></Card></>);
  }

  const campaigns = list.data.items;
  const sum = (s: RecipientStatus) => campaigns.reduce((a, c) => a + c.totals[s], 0);
  const by = (s: string) => campaigns.filter((c) => c.status === s).length;
  const sendingNow = campaigns.find((c) => c.status === "Sending");
  const attention = campaigns.filter((c) => c.status === "Paused" || c.status === "Failed" || c.totals.Failed > 0);

  return (
    <>
      <PageHeader title="Overview" description="Campaign activity and daily sending progress." actions={actions} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Contacts" value={contacts.data ? fmt(contacts.data.total) : "…"} hint="In the database" />
        <StatCard label="Campaigns" value={fmt(list.data.total)} hint={`${by("Sending")} sending · ${by("Draft")} draft · ${by("Paused")} paused`} />
        <StatCard label="Accepted by Gmail" value={fmt(sum("Accepted"))} hint="Not the same as inbox delivery" tone="good" />
        <StatCard label="Failed" value={fmt(sum("Failed"))} hint="Across all campaigns" tone={sum("Failed") ? "bad" : "default"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Now sending"
            subtitle={sendingNow ? sendingNow.name : "No campaign is sending"}
            action={sendingNow && <Link to={`/campaigns/${sendingNow.id}`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">View campaign</Link>}
          />
          {sendingNow ? (
            <div className="space-y-5 p-5">
              <div>
                <div className="mb-1.5 flex items-baseline justify-between text-sm">
                  <span className="font-medium">Whole list</span>
                  <span className="tabular-nums text-slate-500">{fmt(sendingNow.totals.Accepted)} of {fmt(count(sendingNow))} accepted</span>
                </div>
                <ProgressBar value={sendingNow.totals.Accepted} max={count(sendingNow)} />
              </div>
              <StackedBar totals={sendingNow.totals} />
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div><dt className="text-slate-500">Daily cap</dt><dd className="font-semibold">{fmt(sendingNow.dailyLimit)}</dd></div>
                <div><dt className="text-slate-500">Window</dt><dd className="font-semibold">{sendingNow.sendWindowStart} to {sendingNow.sendWindowEnd}</dd></div>
                <div><dt className="text-slate-500">Awaiting</dt><dd className="font-semibold">{fmt(sendingNow.totals.Pending + sendingNow.totals.Queued + sendingNow.totals.Processing)}</dd></div>
                <div><dt className="text-slate-500">Next run</dt><dd className="font-semibold">{sendingNow.nextRunAt ? fmtDate(sendingNow.nextRunAt) : "Not scheduled"}</dd></div>
              </dl>
            </div>
          ) : (
            <p className="p-5 text-sm text-slate-500">Launch a campaign to start the daily drip. Launching is not connected to the backend yet.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Needs attention" />
          {attention.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">Nothing needs attention.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {attention.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link to={`/campaigns/${c.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="text-xs text-slate-500">{c.totals.Failed > 0 ? `${fmt(c.totals.Failed)} failed` : "Needs a decision"}</span>
                    </span>
                    <CampaignStatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recent campaigns" action={<Link to="/campaigns" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">All campaigns</Link>} />
        {campaigns.length === 0 ? (
          <div className="p-5"><Notice>No campaigns yet. Create one to get started.</Notice></div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {campaigns.slice(0, 4).map((c) => (
              <li key={c.id}>
                <Link to={c.status === "Draft" ? `/campaigns/${c.id}/edit` : `/campaigns/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.launchedAt ? `Launched ${fmtDate(c.launchedAt)}` : `Created ${fmtDate(c.createdAt)}`} · {c.createdBy}</p>
                  </div>
                  <div className="hidden w-48 sm:block">{count(c) > 0 && <StackedBar totals={c.totals} />}</div>
                  <CampaignStatusBadge status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
