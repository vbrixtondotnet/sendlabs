import { useState } from "react";
import type { Role } from "@shared/types";
import { suppressions, users } from "@/mock/data";
import { Badge, Button, Card, CardHeader, Field, Notice, PageHeader, Select, Table, TextArea, TextInput, Td, Th, fmtDate } from "@/components/ui";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/useToast";

const TABS = ["Sender", "Sending limits", "Compliance", "Users & access", "Data retention"] as const;
type Tab = (typeof TABS)[number];

export function Settings() {
  const { isAdmin } = useRole();
  const [tab, setTab] = useState<Tab>("Sender");

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Settings" />
        <Notice tone="warn" title="Administrators only">Settings, sender connection and user management require the Administrator role. Use "Preview as" at the top right to switch.</Notice>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" description="Sender connection, sending limits, compliance and access." />
      <div className="mb-5"><Notice tone="warn" title="Preview only">Nothing on this page is connected to the server yet. Values are examples.</Notice></div>
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>{t}</button>
        ))}
      </div>
      {tab === "Sender" && <SenderTab />}
      {tab === "Sending limits" && <LimitsTab />}
      {tab === "Compliance" && <ComplianceTab />}
      {tab === "Users & access" && <UsersTab />}
      {tab === "Data retention" && <RetentionTab />}
    </>
  );
}

function SenderTab() {
  const { toast } = useToast();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Gmail sender" action={<Badge tone="green">Connected</Badge>} />
        <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {[
            ["Auth method", "Service account with domain-wide delegation"],
            ["Service account", "sendlab-sender@project-id.iam.gserviceaccount.example"],
            ["Impersonated mailbox", "outreach@itimpact.example"],
            ["Granted scope", "gmail.send (only)"],
            ["Last verified", "Today, 09:00"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-5 py-2.5"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
          ))}
        </dl>
        <div className="flex gap-2 border-t border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <Button onClick={() => toast("Verified: a token was minted for the sender mailbox (mock)")}>Verify connection</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Test-send allowlist" subtitle="Test emails can only go to these addresses." />
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {["bvillanueva@itimpact.com", "dana.l@itimpact.example"].map((e) => <li key={e} className="flex items-center justify-between px-5 py-2.5">{e}<Button variant="ghost" onClick={() => toast("Removed (mock)", "info")}>Remove</Button></li>)}
        </ul>
        <div className="flex gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
          <TextInput type="email" placeholder="Add address" aria-label="Add test address" />
          <Button onClick={() => toast("Added (mock)")}>Add</Button>
        </div>
      </Card>
      <div className="lg:col-span-2"><Notice tone="info">The service-account key is stored as a server secret and is never shown in the browser. It can only act as the single allowlisted mailbox above.</Notice></div>
    </div>
  );
}

function LimitsTab() {
  const { toast } = useToast();
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Default sending limits" subtitle="Applied to new campaigns. Conservative defaults." />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Max emails per day" htmlFor="d" hint="Check Google's current Workspace limits."><TextInput id="d" type="number" defaultValue={500} /></Field>
        <Field label="Max emails per minute" htmlFor="m"><TextInput id="m" type="number" defaultValue={6} /></Field>
        <Field label="Window start" htmlFor="ws"><TextInput id="ws" type="time" defaultValue="09:00" /></Field>
        <Field label="Window end" htmlFor="we"><TextInput id="we" type="time" defaultValue="17:00" /></Field>
        <Field label="Timezone" htmlFor="tz"><Select id="tz" defaultValue="America/Los_Angeles">{["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "UTC"].map((z) => <option key={z}>{z}</option>)}</Select></Field>
        <Field label="Max attempts per message" htmlFor="a"><TextInput id="a" type="number" defaultValue={3} /></Field>
      </div>
      <div className="flex justify-end border-t border-slate-200 px-5 py-3.5 dark:border-slate-800"><Button variant="primary" onClick={() => toast("Limits saved (mock)")}>Save limits</Button></div>
    </Card>
  );
}

function ComplianceTab() {
  const { toast } = useToast();
  return (
    <div className="space-y-6">
      <Card className="max-w-2xl">
        <CardHeader title="Required before launch" />
        <div className="space-y-4 p-5">
          <Field label="Sender postal address" htmlFor="addr" hint="Included in the footer of every email."><TextArea id="addr" rows={2} defaultValue="IT Impact Inc., 123 Example Street, Sample City" /></Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" defaultChecked className="mt-0.5" />Require an unsubscribe link in every campaign</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" defaultChecked className="mt-0.5" />Add one-click <span className="font-mono text-xs">List-Unsubscribe</span> headers</label>
          <div className="flex justify-end"><Button variant="primary" onClick={() => toast("Compliance settings saved (mock)")}>Save</Button></div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Suppression list" subtitle={`${suppressions.length} addresses are excluded from every send.`} action={<Button onClick={() => toast("Address added to suppression list (mock)")}>Add address</Button>} />
        <Table>
          <thead><tr><Th>Email</Th><Th>Reason</Th><Th>Added</Th></tr></thead>
          <tbody>
            {suppressions.slice(0, 10).map((s) => (
              <tr key={s.email}><Td>{s.email}</Td><Td><Badge tone={s.reason === "Complaint" ? "red" : s.reason === "Bounced" ? "amber" : "slate"}>{s.reason}</Badge></Td><Td className="text-slate-500">{fmtDate(s.addedAt)}</Td></tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function UsersTab() {
  const { toast } = useToast();
  const [roles, setRoles] = useState<Record<string, Role>>(Object.fromEntries(users.map((u) => [u.id, u.role])));
  return (
    <Card>
      <CardHeader title="Users" subtitle="Sign-in is handled by Cloudflare Access. Roles are assigned here." action={<Button variant="primary" onClick={() => toast("Invitation recorded (mock)")}>Add user</Button>} />
      <Table>
        <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Last active</Th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <Td className="font-medium">{u.name}</Td>
              <Td className="text-slate-600 dark:text-slate-300">{u.email}</Td>
              <Td>
                <Select aria-label={`Role for ${u.name}`} className="max-w-[12rem]" value={roles[u.id]} onChange={(e) => { setRoles({ ...roles, [u.id]: e.target.value as Role }); toast(`${u.name} is now ${e.target.value} (mock)`, "info"); }}>
                  {(["Administrator", "Campaign Manager", "Viewer"] as Role[]).map((r) => <option key={r}>{r}</option>)}
                </Select>
              </Td>
              <Td className="text-slate-500">{fmtDate(u.lastActive)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="grid gap-3 border-t border-slate-200 p-5 text-sm dark:border-slate-800 sm:grid-cols-3">
        <div><p className="font-semibold">Administrator</p><p className="text-slate-500">Everything, plus users, settings and sender connection.</p></div>
        <div><p className="font-semibold">Campaign Manager</p><p className="text-slate-500">Import, manage contacts and campaigns, test-send, launch, monitor.</p></div>
        <div><p className="font-semibold">Viewer</p><p className="text-slate-500">Read-only access to dashboards, campaigns and reports.</p></div>
      </div>
    </Card>
  );
}

function RetentionTab() {
  const { toast } = useToast();
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Data retention" subtitle="Applied by a scheduled purge job." />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Delete uploaded CSV files after (days)" htmlFor="r1"><TextInput id="r1" type="number" defaultValue={7} /></Field>
        <Field label="Keep attempt logs for (days)" htmlFor="r2"><TextInput id="r2" type="number" defaultValue={365} /></Field>
        <Field label="Keep audit events for (days)" htmlFor="r3"><TextInput id="r3" type="number" defaultValue={730} /></Field>
        <Field label="Keep suppressed contacts" htmlFor="r4" hint="Suppression entries are kept so opt-outs are honored.">
          <Select id="r4" defaultValue="forever"><option value="forever">Indefinitely</option></Select>
        </Field>
      </div>
      <div className="flex justify-end border-t border-slate-200 px-5 py-3.5 dark:border-slate-800"><Button variant="primary" onClick={() => toast("Retention saved (mock)")}>Save</Button></div>
    </Card>
  );
}
