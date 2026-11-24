import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { SENDER_CONNECT_ERRORS, type SenderConnectError } from "@shared/types";
import { Badge, Button, Card, CardHeader, Empty, ErrorNotice, Field, LoadingRows, Modal, Notice, PageHeader, Pagination, Select, TextArea, TextInput, fmtDate } from "@/components/ui";
import { useToast } from "@/hooks/useToast";
import { goTo } from "@/lib/navigate";
import { EMAIL_FOOTER_ENABLED, LIST_UNSUBSCRIBE_HEADERS_ENABLED } from "@/lib/merge";
import { ApiClientError } from "@/services/http";
import { useConnectGmail, useDisconnectSender, useSender, useSetSenderName } from "@/services/sender";
import { useMe, useUpdateCompany } from "@/services/me";
import { useSuppressions } from "@/services/suppressions";
import { useAddTestRecipient, useRemoveTestRecipient, useTestRecipients } from "@/services/testRecipients";

const TABS = ["Company Details", "Email Service"] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZE = 25;

export function Settings() {
  const [params] = useSearchParams();
  // Coming back from Google's "Connect Gmail" screen (?sender=...) lands on Email Service, where the result is shown.
  const [tab, setTab] = useState<Tab>(() => (params.has("sender") ? "Email Service" : "Company Details"));

  return (
    <>
      <PageHeader title="Settings" description="Company details and the email service: sender, sending limits, unsubscribe rules and data retention." />
      <div className="mb-5"><Notice tone="warn" title="Preview only">Company Details, the Gmail sender (with its test-send allowlist), the unsubscribe settings and the suppression list are connected to the server. Sending limits and data retention, on the Email Service tab, are not saved yet; they will be stored per account once they are connected.</Notice></div>
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? "border-brand-600 text-brand-600 dark:text-brand-400" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>{t}</button>
        ))}
      </div>
      {tab === "Company Details" && <CompanyTab />}
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
  inactive: "Your account is not active, so nothing was connected.",
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

/** The name on the From line. It should match the name the mailbox uses in Gmail: mail under a different name was filed as Spam. */
function SenderNameForm({ current }: { current: string }) {
  const { toast } = useToast();
  const save = useSetSenderName();
  const [value, setValue] = useState(current);
  const changed = value.trim() !== current;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed || save.isPending) return;
    try {
      const saved = await save.mutateAsync(value.trim());
      setValue(saved.sender?.senderName ?? "");
      toast("Sender name saved");
    } catch {
      /* shown below */
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
      <Field label="Sender name" htmlFor="sender-name">
        <div className="flex gap-2">
          <TextInput id="sender-name" value={value} maxLength={100} placeholder="e.g. Marketing Admin" onChange={(e) => setValue(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!changed || save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </Field>
      <p className="text-xs text-slate-500">The name recipients see on the From line. Use the same name this mailbox uses in Gmail: mail sent under a different name has been filed under Spam. Left empty, the name of the user who sends is used.</p>
      {save.isError && <p role="alert" className="text-xs text-rose-600">{save.error instanceof ApiClientError ? save.error.fieldErrors.find((f) => f.path === "senderName")?.message ?? save.error.message : "Something went wrong. Please try again."}</p>}
    </form>
  );
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
                ["Connected on", fmtDate(connectedSender.connectedAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-5 py-2.5"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
              ))}
            </dl>
            <SenderNameForm current={connectedSender.senderName} />
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
 * The account's unsubscribe rules, both on to begin with. Sending applies them: when the
 * first is on, every email gets the standard unsubscribe footer automatically, and the second adds (while LIST_UNSUBSCRIBE_HEADERS_ENABLED) the one-click
 * List-Unsubscribe headers to every email. The postal address in every footer is the one from Company Details.
 */
function ComplianceCard() {
  const me = useMe();
  const company = me.data?.company;
  if (me.isError) return <ErrorNotice error={me.error} onRetry={() => void me.refetch()} />;
  if (!company) return <Card><LoadingRows rows={2} cols={1} /></Card>;

  return (
    <Card>
      <CardHeader title="Unsubscribe and compliance" subtitle="Applied to every campaign you send." />
      <div className="space-y-4 p-5">
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={EMAIL_FOOTER_ENABLED} disabled readOnly className="mt-0.5" />Unsubscribe link in every campaign {EMAIL_FOOTER_ENABLED ? <Badge tone="green">Always on</Badge> : <Badge tone="amber">Off for now</Badge>}</label>
        <p className="-mt-2 pl-6 text-xs text-slate-500">{EMAIL_FOOTER_ENABLED ? "Every email automatically ends with the standard unsubscribe footer. Nobody can edit or remove it." : "The footer at the end of each email (the unsubscribe link, your company name and your postal address) is switched off for now. Recipients can still unsubscribe with the one-click button their mail app shows."}</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={LIST_UNSUBSCRIBE_HEADERS_ENABLED} disabled readOnly className="mt-0.5" />One-click unsubscribe (List-Unsubscribe headers) {LIST_UNSUBSCRIBE_HEADERS_ENABLED ? <Badge tone="green">Always on</Badge> : <Badge tone="amber">Off for now</Badge>}</label>
        <p className="-mt-2 pl-6 text-xs text-slate-500">{LIST_UNSUBSCRIBE_HEADERS_ENABLED ? "Gmail and Yahoo require one-click unsubscribe from senders of marketing email, so it cannot be turned off. A recipient who uses it is added to your suppression list straight away and is never emailed again." : "Campaign emails are sent without these headers, like a one-to-one email, so Gmail is less likely to file them under Promotions. Recipients can still unsubscribe with the link in the footer, and are then added to your suppression list and never emailed again."}</p>
        {EMAIL_FOOTER_ENABLED && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
          The footer of every email shows your company's postal address from <strong>Company Details</strong>:{" "}
          {company.postalAddress ? <span className="whitespace-pre-line font-medium">{company.postalAddress}</span> : <span className="text-amber-700 dark:text-amber-400">not set yet, so campaigns cannot be launched until you add it.</span>}
        </p>}
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

/** The message for one field from a failed save, if the server named that field. */
const fieldError = (e: unknown, path: string) => (e instanceof ApiClientError ? e.fieldErrors.find((f) => f.path === path)?.message : undefined);
const generalError = (e: unknown, fields: string[]) =>
  e instanceof ApiClientError && !(e.fieldErrors.length > 0 && e.fieldErrors.every((f) => fields.includes(f.path))) ? e.message : null;

/**
 * Company details: the account's company name, website and postal address. The website and name go into the email
 * signature of new campaigns, and the address into email footers.
 */
function CompanyTab() {
  const { toast } = useToast();
  const me = useMe();
  const update = useUpdateCompany();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const loaded = me.data?.company;
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
      <CardHeader title="Company details" subtitle="Your company's name, website and postal address." />
      <form onSubmit={submit} noValidate>
        <div className="space-y-4 p-5">
          <Field label="Name" htmlFor="co-name" hint="Used as the sender name on campaign emails.">
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
