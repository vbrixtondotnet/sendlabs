import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import type { InvitationDto } from "@shared/api";
import { ACCESS_LEVELS, SENDER_CONNECT_ERRORS, type AccessId, type SenderConnectError } from "@shared/types";
import { Badge, Button, Card, CardHeader, Empty, ErrorNotice, Field, LoadingRows, Modal, Notice, PageHeader, Pagination, Select, Table, TextArea, TextInput, Td, Th, fmtDate } from "@/components/ui";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/useToast";
import { goTo } from "@/lib/navigate";
import { ApiClientError } from "@/services/http";
import { useConnectGmail, useDisconnectSender, useSender } from "@/services/sender";
import { useMe, useUpdateTenant } from "@/services/me";
import { useSuppressions } from "@/services/suppressions";
import { useAddTestRecipient, useRemoveTestRecipient, useTestRecipients } from "@/services/testRecipients";
import { useInvitations, useInviteUser, useRemoveUser, useResendInvitation, useRevokeInvitation, useUsers } from "@/services/users";
import type { UserDto } from "@shared/api";

const TABS = ["Company Details", "Users & access", "Email Service"] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZE = 25;

export function Settings() {
  const { isAdmin, ready } = useRole();
  const [params] = useSearchParams();
  // Coming back from Google's "Connect Gmail" screen (?sender=...) lands on Email Service, where the result is shown.
  const [tab, setTab] = useState<Tab>(() => (params.has("sender") ? "Email Service" : "Company Details"));

  if (!ready) return <PageHeader title="Settings" />; // who you are is still loading

  // Settings are for Administrators only. Anyone else who opens the address is sent back to the start page.
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <>
      <PageHeader title="Settings" description="Company details, users and access, and the email service: sender, sending limits, unsubscribe rules and data retention." />
      <div className="mb-5"><Notice tone="warn" title="Preview only">Company Details, Users & access, the Gmail sender (with its test-send allowlist), the unsubscribe settings and the suppression list are connected to the server. Sending limits and data retention, on the Email Service tab, are not saved yet; they will be stored per tenant once they are connected.</Notice></div>
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? "border-brand-600 text-brand-600 dark:text-brand-400" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>{t}</button>
        ))}
      </div>
      {tab === "Company Details" && <CompanyTab />}
      {tab === "Users & access" && <UsersTab />}
      {tab === "Email Service" && <EmailServiceTab />}
    </>
  );
}

/** What each failure code means to a person, and what to do about it. The server only ever sends the code. */
const CONNECT_ERROR_TEXT: Record<SenderConnectError, string> = {
  denied: "Google access was not granted. Connect again and allow Sendrix to send email on your behalf.",
  invalid_state: "That connection link expired or was already used. Start again with Connect Gmail.",
  exchange_failed: "Google did not accept the connection. Please try again in a moment.",
  missing_permission: "Sendrix needs permission to send email. On Google's screen, leave the box for sending email ticked, then try again.",
  no_refresh_token: "Google did not let Sendrix stay connected. Remove Sendrix at myaccount.google.com/permissions, then connect again.",
  email_unavailable: "Sendrix could not confirm which email address you connected. Please try again.",
  not_configured: "Gmail connection is not set up on this server yet.",
  inactive: "Your account or organization is not active, so nothing was connected.",
};

/** The `?sender=` result Google's callback redirected back with, read once and then removed from the address. */
function useConnectResult() {
  const [params, setParams] = useSearchParams();
  const { toast } = useToast();
  const [result] = useState(() => {
    const sender = params.get("sender");
    const reason = params.get("reason");
    if (sender === "connected") return { ok: true as const };
    if (sender === "error") {
      const known = (SENDER_CONNECT_ERRORS as readonly string[]).includes(reason ?? "");
      return { ok: false as const, reason: (known ? reason : "exchange_failed") as SenderConnectError };
    }
    return null;
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (params.has("sender") || params.has("reason")) setParams({}, { replace: true }); // a refresh must not replay it
    if (result?.ok) toast("Gmail connected");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { error: result && !result.ok && !dismissed ? result.reason : null, dismiss: () => setDismissed(true) };
}

function SenderSection() {
  const { toast } = useToast();
  const sender = useSender();
  const connect = useConnectGmail();
  const disconnect = useDisconnectSender();
  const [confirming, setConfirming] = useState(false);
  const result = useConnectResult();

  // Pressing Back from Google's page can restore this page frozen mid-redirect. Make the button usable again.
  const { reset: resetConnect } = connect;
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) resetConnect(); };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [resetConnect]);

  const connectedSender = sender.data?.sender ?? null;
  const configured = sender.data?.configured ?? true;
  const redirecting = connect.isPending || connect.isSuccess;

  async function startConnect() {
    try {
      const { url } = await connect.mutateAsync();
      goTo(url);
    } catch {
      /* shown below */
    }
  }

  async function confirmDisconnect() {
    try {
      await disconnect.mutateAsync();
      toast("Gmail disconnected", "info");
      setConfirming(false);
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Something went wrong", "error");
    }
  }

  const connectError = connect.error instanceof ApiClientError ? connect.error : null;
  const connectButton = (label: string, variant: "primary" | "secondary" = "primary") => (
    <Button variant={variant} disabled={!configured || redirecting} onClick={startConnect}>
      {redirecting ? "Redirecting to Google…" : label}
    </Button>
  );

  return (
    <>
      <Card>
        <CardHeader
          title="Gmail sender"
          action={
            !sender.data ? null : connectedSender ? (
              <Badge tone={connectedSender.status === "Connected" ? "green" : "amber"}>{connectedSender.status === "Connected" ? "Connected" : "Needs reconnecting"}</Badge>
            ) : (
              <Badge>{configured ? "Not connected" : "Not available"}</Badge>
            )
          }
        />

        {result.error && (
          <div className="px-5 pt-4">
            <Notice tone="error" title="Gmail was not connected">
              <p>{CONNECT_ERROR_TEXT[result.error]}</p>
              <Button className="mt-3" onClick={result.dismiss}>Dismiss</Button>
            </Notice>
          </div>
        )}

        {sender.isError ? (
          <div className="p-4"><ErrorNotice error={sender.error} onRetry={() => void sender.refetch()} /></div>
        ) : sender.isPending ? (
          <LoadingRows rows={3} cols={2} />
        ) : connectedSender ? (
          <>
            {connectedSender.status !== "Connected" && (
              <div className="px-5 pt-4">
                <Notice tone="warn" title="Reconnect to keep sending">Google no longer accepts the saved permission. Campaigns cannot be sent until you connect again.</Notice>
              </div>
            )}
            <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {[
                ["Sending address", connectedSender.email],
                ["Permission", connectedSender.permissions.join(", ") || "None"],
                ["Connected by", connectedSender.connectedBy || "Unknown"],
                ["Connected on", fmtDate(connectedSender.connectedAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-5 py-2.5"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
              ))}
            </dl>
            {connectError && <div className="px-5 pb-3"><Notice tone="error">{connectError.message}</Notice></div>}
            <div className="flex flex-wrap gap-2 border-t border-slate-200 px-5 py-3.5 dark:border-slate-800">
              {connectButton("Reconnect", connectedSender.status === "Connected" ? "secondary" : "primary")}
              <Button variant="ghost" className="text-rose-600" disabled={redirecting} onClick={() => setConfirming(true)}>Disconnect</Button>
            </div>
          </>
        ) : (
          <div className="space-y-4 p-5">
            {!configured && (
              <Notice tone="warn" title="Gmail connection is not set up on this server yet">
                The Google credentials have not been added, so accounts cannot be connected. See "Connecting Gmail" in the README.
              </Notice>
            )}
            <div>
              {connectButton("Connect Gmail")}
              <p className="mt-2 max-w-md text-sm text-slate-500">
                Required to send campaigns to your leads and to invite people to your account. You will be taken to Google to approve, then brought back here. Sendrix only asks to send email on your behalf and to see which address you connected, never to read your inbox.
              </p>
            </div>
            {connectError && <Notice tone="error" title="Could not start the connection">{connectError.code === "GMAIL_NOT_CONFIGURED" ? "Gmail connection is not set up on this server yet." : connectError.message}</Notice>}
          </div>
        )}
      </Card>

      <TestAllowlistCard />

      <div className="lg:col-span-2"><Notice tone="info">Sendrix stores a secure, encrypted key that lets it send on your behalf. It never sees your Google password, and you can disconnect at any time here or at myaccount.google.com/permissions.</Notice></div>

      <Modal
        open={confirming}
        title="Disconnect Gmail?"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Keep connected</Button>
            <Button variant="danger" disabled={disconnect.isPending} onClick={confirmDisconnect}>{disconnect.isPending ? "Disconnecting…" : "Disconnect"}</Button>
          </>
        }
      >
        <p className="text-sm">Sendrix will stop being able to send from <strong>{connectedSender?.email}</strong> and Google will be told to cancel its permission. Campaigns cannot be sent and invitations cannot be emailed until you connect an account again. Campaigns already sent are not affected.</p>
      </Modal>
    </>
  );
}

/** The addresses a campaign's "Send test email" goes to. A test is only ever mailed here, never to anyone else. */
function TestAllowlistCard() {
  const { toast } = useToast();
  const list = useTestRecipients();
  const add = useAddTestRecipient();
  const remove = useRemoveTestRecipient();
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = address.trim();
    if (!value || add.isPending) return;
    setProblem(null);
    try {
      await add.mutateAsync(value);
      setAddress("");
      toast(`${value} added to the test-send allowlist`);
    } catch (err) {
      setProblem(err instanceof ApiClientError ? (err.fieldErrors[0]?.message ?? err.message) : "Something went wrong. Please try again.");
    }
  }

  async function doRemove(id: string, email: string) {
    try {
      await remove.mutateAsync(id);
      toast(`${email} removed from the allowlist`, "info");
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Something went wrong", "error");
    }
  }

  const items = list.data?.items ?? [];
  return (
    <Card>
      <CardHeader title="Test-send allowlist" subtitle="Every test email from a campaign goes to these addresses, and only these." />
      {list.isError ? (
        <div className="p-4"><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></div>
      ) : list.isPending ? (
        <LoadingRows rows={2} cols={2} />
      ) : items.length === 0 ? (
        <Empty>No test addresses yet. Add one to be able to send a test.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {items.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
              <span className="min-w-0 truncate font-medium">{r.email}</span>
              <Button variant="ghost" className="text-rose-600" aria-label={`Remove ${r.email}`} disabled={remove.isPending} onClick={() => void doRemove(r.id, r.email)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} noValidate className="border-t border-slate-200 p-4 dark:border-slate-800">
        <div className="flex gap-2">
          <TextInput type="email" placeholder="Add address" aria-label="Add test address" autoComplete="off" value={address} onChange={(e) => { setAddress(e.target.value); setProblem(null); }} />
          <Button type="submit" disabled={!address.trim() || add.isPending}>{add.isPending ? "Adding…" : "Add"}</Button>
        </div>
        {problem && <p role="alert" className="mt-2 text-xs text-rose-600">{problem}</p>}
      </form>
    </Card>
  );
}

function SendingLimitsCard() {
  const { toast } = useToast();
  return (
    <Card>
      <CardHeader title="Default sending limits" subtitle="Applied to new campaigns. Conservative defaults." />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Max emails per day" htmlFor="d" hint="Check Google's current Workspace limits."><TextInput id="d" type="number" defaultValue={500} /></Field>
        <Field label="Max emails per minute" htmlFor="m"><TextInput id="m" type="number" defaultValue={6} /></Field>
        <Field label="Window start" htmlFor="ws"><TextInput id="ws" type="time" defaultValue="09:00" /></Field>
        <Field label="Window end" htmlFor="we"><TextInput id="we" type="time" defaultValue="17:00" /></Field>
        <Field label="Timezone" htmlFor="tz"><Select id="tz" defaultValue="America/Los_Angeles">{["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "UTC"].map((z) => <option key={z}>{z}</option>)}</Select></Field>
        <Field label="Max attempts per message" htmlFor="a"><TextInput id="a" type="number" defaultValue={3} /></Field>
      </div>
      <div className="flex justify-end border-t border-slate-200 px-5 py-3.5 dark:border-slate-800"><Button variant="primary" onClick={() => toast("Not connected yet: nothing was saved", "info")}>Save limits</Button></div>
    </Card>
  );
}

/** Addresses that are never emailed again: everyone who used an unsubscribe link, newest first. Read-only. */
function SuppressionCard() {
  const [page, setPage] = useState(1);
  const list = useSuppressions(page, PAGE_SIZE);
  return (
    <Card>
      <CardHeader title="Suppression list" subtitle="Addresses that unsubscribed. They are excluded from every send." />
      {list.isError ? (
        <div className="p-4"><ErrorNotice error={list.error} onRetry={() => void list.refetch()} /></div>
      ) : list.isPending ? (
        <LoadingRows rows={2} cols={2} />
      ) : list.data.items.length === 0 ? (
        <Empty>No suppressed addresses yet.</Empty>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {list.data.items.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="min-w-0 truncate font-medium">{r.email}</span>
                <span className="shrink-0 text-xs text-slate-500">{r.reason}, {fmtDate(r.createdAt)}</span>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageCount={Math.max(1, Math.ceil(list.data.total / PAGE_SIZE))} total={list.data.total} pageSize={PAGE_SIZE} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

/**
 * The organization's unsubscribe rules, both on for every organization to begin with. Sending applies them: when the
 * first is on, every email gets the standard unsubscribe footer automatically, and the second adds the one-click
 * List-Unsubscribe headers to every email. The postal address in every footer is the one from Company Details.
 */
function ComplianceCard() {
  const { toast } = useToast();
  const me = useMe();
  const update = useUpdateTenant();
  const [requireLink, setRequireLink] = useState(true);
  const [oneClick, setOneClick] = useState(true);
  const [seeded, setSeeded] = useState(false);
  const tenant = me.data?.tenant;

  // Fill the form once, when the company has loaded. Later refreshes must not overwrite what is being ticked.
  useEffect(() => {
    if (tenant && !seeded) {
      setRequireLink(tenant.requireUnsubscribeLink);
      setOneClick(tenant.oneClickUnsubscribe);
      setSeeded(true);
    }
  }, [tenant, seeded]);

  if (me.isError) return <ErrorNotice error={me.error} onRetry={() => void me.refetch()} />;
  if (!tenant || !seeded) return <Card><LoadingRows rows={2} cols={1} /></Card>;

  const requireChanged = requireLink !== tenant.requireUnsubscribeLink;
  const oneClickChanged = oneClick !== tenant.oneClickUnsubscribe;
  const changed = requireChanged || oneClickChanged;

  async function save() {
    if (!changed || update.isPending) return;
    update.reset();
    try {
      const saved = await update.mutateAsync({ ...(requireChanged ? { requireUnsubscribeLink: requireLink } : {}), ...(oneClickChanged ? { oneClickUnsubscribe: oneClick } : {}) });
      setRequireLink(saved.requireUnsubscribeLink);
      setOneClick(saved.oneClickUnsubscribe);
      toast("Unsubscribe settings updated");
    } catch {
      /* shown below */
    }
  }

  return (
    <Card>
      <CardHeader title="Unsubscribe and compliance" subtitle="Applied to every campaign your organization sends." />
      <div className="space-y-4 p-5">
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={requireLink} onChange={(e) => setRequireLink(e.target.checked)} className="mt-0.5" />Require an unsubscribe link in every campaign</label>
        <p className="-mt-2 pl-6 text-xs text-slate-500">When on, every email automatically ends with the standard unsubscribe footer. Nobody can edit or remove it.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={oneClick} onChange={(e) => setOneClick(e.target.checked)} className="mt-0.5" />Add one-click List-Unsubscribe headers</label>
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
          The footer of every email shows your company's postal address from <strong>Company Details</strong>:{" "}
          {tenant.postalAddress ? <span className="whitespace-pre-line font-medium">{tenant.postalAddress}</span> : <span className="text-amber-700 dark:text-amber-400">not set yet, so campaigns cannot be launched until you add it.</span>}
        </p>
        {update.isError && <Notice tone="error">{update.error instanceof ApiClientError ? update.error.message : "Something went wrong. Please try again."}</Notice>}
      </div>
      <div className="flex justify-end border-t border-slate-200 px-5 py-3.5 dark:border-slate-800">
        <Button variant="primary" disabled={!changed || update.isPending} onClick={() => void save()}>{update.isPending ? "Saving…" : "Save"}</Button>
      </div>
    </Card>
  );
}

/** Everything about how email goes out, in one place: the Gmail sender and test sends, unsubscribe rules, limits, suppression, retention. */
function EmailServiceTab() {
  // Two equal columns, so every section is the same width: Gmail sender | test-send allowlist, then
  // unsubscribe and compliance | sending limits, then suppression list | data retention. One column on a phone.
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SenderSection />
      <ComplianceCard />
      <SendingLimitsCard />
      <SuppressionCard />
      <DataRetentionCard />
    </div>
  );
}

/** What went wrong inviting, in words an Administrator can act on. The server's message already says what to do. */
function inviteErrorText(e: unknown): string {
  if (!(e instanceof ApiClientError)) return "Something went wrong. Please try again.";
  if (e.code === "VALIDATION_ERROR") return e.fieldErrors[0]?.message ?? e.message;
  return e.message;
}

function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const sender = useSender();
  const invite = useInviteUser();
  const [form, setForm] = useState({ email: "", firstName: "", lastName: "", position: "", accessId: "campaign-manager" as AccessId });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const noSender = sender.isSuccess && (!sender.data.sender || sender.data.sender.status !== "Connected");
  const complete = form.email.trim() && form.firstName.trim() && form.lastName.trim();
  const { reset } = invite;

  function close() {
    reset();
    setForm({ email: "", firstName: "", lastName: "", position: "", accessId: "campaign-manager" });
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!complete || invite.isPending || noSender) return;
    try {
      const sent = await invite.mutateAsync({ ...form, email: form.email.trim(), firstName: form.firstName.trim(), lastName: form.lastName.trim(), position: form.position.trim() });
      toast(`Invitation sent to ${sent.email}`);
      close();
    } catch {
      /* shown in the dialog */
    }
  }

  return (
    <Modal
      open={open}
      title="Add user"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-user-form" disabled={!complete || invite.isPending || noSender}>{invite.isPending ? "Sending…" : "Send invitation"}</Button>
        </>
      }
    >
      <form id="add-user-form" onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">Sendrix emails them an invitation. When they accept and choose a password, they become a user of your organization.</p>
        {noSender && (
          <Notice tone="warn" title="Connect Gmail first">Invitations are sent from your connected Gmail account. Connect one on the Sender tab, then come back.</Notice>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="au-first"><TextInput id="au-first" autoFocus autoComplete="off" value={form.firstName} onChange={set("firstName")} maxLength={100} /></Field>
          <Field label="Last name" htmlFor="au-last"><TextInput id="au-last" autoComplete="off" value={form.lastName} onChange={set("lastName")} maxLength={100} /></Field>
        </div>
        <Field label="Position" htmlFor="au-position" hint="Their job title. Optional; they can change it themselves later.">
          <TextInput id="au-position" autoComplete="off" placeholder="e.g. Sales Director" value={form.position} onChange={set("position")} maxLength={100} />
        </Field>
        <Field label="Email address" htmlFor="au-email"><TextInput id="au-email" type="email" autoComplete="off" value={form.email} onChange={set("email")} /></Field>
        <Field label="Role" htmlFor="au-role" hint={ACCESS_LEVELS.find((a) => a.id === form.accessId)?.description ?? ""}>
          <Select id="au-role" value={form.accessId} onChange={set("accessId")}>
            {ACCESS_LEVELS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        {invite.isError && <Notice tone="error">{inviteErrorText(invite.error)}</Notice>}
      </form>
    </Modal>
  );
}

function InvitationsCard() {
  const { toast } = useToast();
  const invitations = useInvitations();
  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();
  const [revoking, setRevoking] = useState<InvitationDto | null>(null);

  async function doResend(i: InvitationDto) {
    try {
      await resend.mutateAsync(i.id);
      toast(`Invitation sent again to ${i.email}`);
    } catch (e) {
      toast(inviteErrorText(e), "error");
    }
  }

  async function doRevoke() {
    if (!revoking) return;
    try {
      await revoke.mutateAsync(revoking.id);
      toast(`Invitation to ${revoking.email} withdrawn`, "info");
      setRevoking(null);
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Something went wrong", "error");
      setRevoking(null);
    }
  }

  if (invitations.isPending) return null;
  if (invitations.isError) return <div className="border-t border-slate-200 p-4 dark:border-slate-800"><ErrorNotice error={invitations.error} onRetry={() => void invitations.refetch()} /></div>;
  const items = invitations.data.items;
  if (items.length === 0) return null;

  return (
    <div className="border-t border-slate-200 dark:border-slate-800">
      <div className="px-5 pt-4"><h3 className="text-sm font-semibold">Pending invitations</h3><p className="text-xs text-slate-500">Invited, but they have not accepted yet. Links work for 7 days.</p></div>
      <Table>
        <thead><tr><Th>Name</Th><Th>Position</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Expires</Th><Th className="text-right">Actions</Th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <Td className="font-medium">{`${i.firstName} ${i.lastName}`.trim()}</Td>
              <Td className="text-slate-600 dark:text-slate-300">{i.position || <span className="text-slate-400">-</span>}</Td>
              <Td className="text-slate-600 dark:text-slate-300">{i.email}</Td>
              <Td>{i.access}</Td>
              <Td><Badge tone={i.status === "Pending" ? "amber" : "slate"}>{i.status}</Badge></Td>
              <Td className="text-slate-500">{fmtDate(i.expiresAt)}</Td>
              <Td className="whitespace-nowrap text-right">
                <Button variant="ghost" aria-label={`Resend invitation to ${i.email}`} disabled={resend.isPending} onClick={() => void doResend(i)}>Resend</Button>
                <Button variant="ghost" className="text-rose-600" aria-label={`Revoke invitation to ${i.email}`} onClick={() => setRevoking(i)}>Revoke</Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Modal
        open={revoking !== null}
        title="Withdraw this invitation?"
        onClose={() => setRevoking(null)}
        footer={
          <>
            <Button onClick={() => setRevoking(null)}>Keep it</Button>
            <Button variant="danger" disabled={revoke.isPending} onClick={() => void doRevoke()}>{revoke.isPending ? "Withdrawing…" : "Withdraw"}</Button>
          </>
        }
      >
        <p className="text-sm">The link in the email sent to <strong>{revoking?.email}</strong> will stop working.</p>
      </Modal>
    </div>
  );
}

function UsersTab() {
  const [page, setPage] = useState(1);
  const users = useUsers(page, PAGE_SIZE);
  const [adding, setAdding] = useState(false);
  const me = useMe();
  const remove = useRemoveUser();
  const [removing, setRemoving] = useState<UserDto | null>(null);
  const { toast } = useToast();

  async function doRemove() {
    if (!removing) return;
    const who = removing;
    try {
      await remove.mutateAsync(who.id);
      toast(`${who.displayName || who.email} was removed`, "info");
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Something went wrong", "error");
    }
    setRemoving(null);
  }

  return (
    <Card>
      <CardHeader
        title="Users"
        subtitle="The people in your organization. Sign-in is by email and password."
        action={<Button variant="primary" onClick={() => setAdding(true)}>Add user</Button>}
      />
      <AddUserModal open={adding} onClose={() => setAdding(false)} />
      {users.isError ? (
        <div className="p-4"><ErrorNotice error={users.error} onRetry={() => void users.refetch()} /></div>
      ) : users.isPending ? (
        <LoadingRows cols={6} rows={3} />
      ) : (
        <>
          <Table>
            <thead><tr><Th>Name</Th><Th>Position</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Last active</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {users.data.items.map((u) => (
                <tr key={u.id}>
                  <Td className="font-medium">{u.displayName || <span className="font-normal text-slate-400">(no name)</span>}</Td>
                  <Td className="text-slate-600 dark:text-slate-300">{u.position || <span className="text-slate-400">-</span>}</Td>
                  <Td className="text-slate-600 dark:text-slate-300">{u.email}</Td>
                  <Td>
                    <Select aria-label={`Role for ${u.displayName || u.email}`} className="max-w-[12rem]" value={u.access} disabled title="Changing access is not built yet" onChange={() => undefined}>
                      {ACCESS_LEVELS.map((a) => <option key={a.id}>{a.name}</option>)}
                    </Select>
                  </Td>
                  <Td><Badge tone={u.status === "Active" ? "green" : "slate"}>{u.status}</Badge></Td>
                  <Td className="text-slate-500">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never"}</Td>
                  <Td className="text-right">
                    {u.id === me.data?.user.id ? (
                      <span className="text-xs text-slate-400">You</span>
                    ) : (
                      <Button variant="ghost" className="text-rose-600" aria-label={`Remove ${u.displayName || u.email}`} onClick={() => setRemoving(u)}>Remove</Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {users.data.items.length === 0 && <Empty>No users.</Empty>}
          <Pagination page={page} pageCount={Math.max(1, Math.ceil(users.data.total / PAGE_SIZE))} total={users.data.total} pageSize={PAGE_SIZE} onPage={setPage} />
        </>
      )}
      <InvitationsCard />
      <Modal
        open={removing !== null}
        title="Remove this user?"
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Keep user</Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => void doRemove()}>{remove.isPending ? "Removing…" : "Remove user"}</Button>
          </>
        }
      >
        <p className="text-sm"><strong>{removing?.displayName || removing?.email}</strong> ({removing?.email}) will be signed out and lose access to your organization. Nothing they created is deleted, and you can invite them again later.</p>
      </Modal>
      <div className="grid gap-3 border-t border-slate-200 p-5 text-sm dark:border-slate-800 sm:grid-cols-3">
        {ACCESS_LEVELS.map((a) => (
          <div key={a.id}><p className="font-semibold">{a.name}</p><p className="text-slate-500">{a.description}</p></div>
        ))}
      </div>
    </Card>
  );
}

/** The message for one field from a failed save, if the server named that field. */
const fieldError = (e: unknown, path: string) => (e instanceof ApiClientError ? e.fieldErrors.find((f) => f.path === path)?.message : undefined);
const generalError = (e: unknown, fields: string[]) =>
  e instanceof ApiClientError && !(e.fieldErrors.length > 0 && e.fieldErrors.every((f) => fields.includes(f.path))) ? e.message : null;

/**
 * Company details: the organization's name, website and postal address. The website and name go into the email
 * signature of new campaigns, and the address into email footers. Administrators only (so is this whole page).
 */
function CompanyTab() {
  const { toast } = useToast();
  const me = useMe();
  const update = useUpdateTenant();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const loaded = me.data?.tenant;
  const [seeded, setSeeded] = useState(false);

  // Fill the form once, when the company has loaded. Later refreshes must not overwrite what is being typed.
  useEffect(() => {
    if (loaded && !seeded) {
      setName(loaded.name);
      setWebsite(loaded.website);
      setAddress(loaded.postalAddress);
      setSeeded(true);
    }
  }, [loaded, seeded]);

  if (me.isError) return <ErrorNotice error={me.error} onRetry={() => void me.refetch()} />;
  if (!loaded || !seeded) return <Card className="max-w-2xl"><LoadingRows rows={3} cols={1} /></Card>;

  const nameChanged = name.trim() !== loaded.name;
  const websiteChanged = website.trim() !== loaded.website;
  // Compared the way the server tidies it, so retyping the same address with different spacing is not a change.
  const tidy = (v: string) => v.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  const addressChanged = tidy(address) !== loaded.postalAddress;
  const changed = nameChanged || websiteChanged || addressChanged;
  const complete = name.trim() !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed || !complete || update.isPending) return;
    update.reset();
    try {
      // Only what changed is sent. The server saves all of it or none of it.
      const saved = await update.mutateAsync({
        ...(nameChanged ? { name: name.trim() } : {}),
        ...(websiteChanged ? { website: website.trim() } : {}),
        ...(addressChanged ? { postalAddress: address } : {}),
      });
      setName(saved.name);
      setWebsite(saved.website);
      setAddress(saved.postalAddress);
      toast("Company details updated");
    } catch {
      /* shown below */
    }
  }

  const nameError = fieldError(update.error, "name");
  const websiteError = fieldError(update.error, "website");
  const addressError = fieldError(update.error, "postalAddress");
  const general = generalError(update.error, ["name", "website", "postalAddress"]);

  return (
    <Card className="max-w-2xl">
      <CardHeader title="Company details" subtitle="Your organization's name, website and postal address." />
      <form onSubmit={submit} noValidate>
        <div className="space-y-4 p-5">
          <Field label="Name" htmlFor="co-name" hint="Shown to everyone in your organization, in invitations, and as the sender name on campaign emails.">
            <TextInput id="co-name" autoComplete="organization" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameError} />
            {nameError && <p className="mt-1 text-xs text-rose-600">{nameError}</p>}
          </Field>
          <Field label="Website" htmlFor="co-website" hint="Shown in the email signature of new campaigns, e.g. example.com.">
            <TextInput id="co-website" type="text" inputMode="url" autoComplete="url" maxLength={200} placeholder="example.com" value={website} onChange={(e) => setWebsite(e.target.value)} aria-invalid={!!websiteError} />
            {websiteError && <p className="mt-1 text-xs text-rose-600">{websiteError}</p>}
          </Field>
          <Field label="Postal address" htmlFor="co-address" hint="Included in the footer of every email.">
            <TextArea id="co-address" rows={2} maxLength={500} placeholder="Company name, street, city, country" value={address} onChange={(e) => setAddress(e.target.value)} aria-invalid={!!addressError} />
            {addressError && <p className="mt-1 text-xs text-rose-600">{addressError}</p>}
          </Field>
        </div>
        {general && <div className="px-5 pb-4"><Notice tone="error">{general}</Notice></div>}
        <div className="flex justify-end border-t border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <Button type="submit" variant="primary" disabled={!changed || !complete || update.isPending}>{update.isPending ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>
    </Card>
  );
}

function DataRetentionCard() {
  const { toast } = useToast();
  return (
    <Card>
      <CardHeader title="Data retention" subtitle="Applied by a scheduled purge job." />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Delete uploaded CSV files after (days)" htmlFor="r1"><TextInput id="r1" type="number" defaultValue={7} /></Field>
        <Field label="Keep attempt logs for (days)" htmlFor="r2"><TextInput id="r2" type="number" defaultValue={365} /></Field>
        <Field label="Keep audit events for (days)" htmlFor="r3"><TextInput id="r3" type="number" defaultValue={730} /></Field>
        <Field label="Keep suppressed contacts" htmlFor="r4" hint="Suppression entries are kept so opt-outs are honored.">
          <Select id="r4" defaultValue="forever"><option value="forever">Indefinitely</option></Select>
        </Field>
      </div>
      <div className="flex justify-end border-t border-slate-200 px-5 py-3.5 dark:border-slate-800"><Button variant="primary" onClick={() => toast("Not connected yet: nothing was saved", "info")}>Save</Button></div>
    </Card>
  );
}
