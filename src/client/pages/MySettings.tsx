import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { MeDto } from "@shared/api";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "@shared/password-rules";
import { Button, Card, CardHeader, ErrorNotice, Field, LoadingRows, Notice, PageHeader, TextArea, TextInput } from "@/components/ui";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useChangePassword, useMe, useUpdateProfile, useUpdateTenant } from "@/services/me";

const TABS = ["Company Details", "User Details", "Account Details"] as const;
type Tab = (typeof TABS)[number];

/** The signed-in user's own settings: their name, and their password. (Organization-wide settings are under Settings in the sidebar.) */
export function MySettings() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const wanted = params.get("tab");
    return wanted === "account" ? "Account Details" : wanted === "user" ? "User Details" : "Company Details";
  });
  const me = useMe();

  return (
    <>
      <PageHeader title="My settings" description="Your company, your own details, and your password." />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? "border-brand-600 text-brand-600 dark:text-brand-400" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>{t}</button>
        ))}
      </div>
      {me.isError ? (
        <ErrorNotice error={me.error} onRetry={() => void me.refetch()} />
      ) : !me.data ? (
        <Card className="max-w-2xl"><LoadingRows rows={3} cols={1} /></Card>
      ) : tab === "Company Details" ? (
        <CompanyTab me={me.data} />
      ) : tab === "User Details" ? (
        <UserDetailsTab me={me.data} />
      ) : (
        <AccountTab />
      )}
    </>
  );
}

/** The message for one field from a failed save, if the server named that field. */
const fieldError = (e: unknown, path: string) => (e instanceof ApiClientError ? e.fieldErrors.find((f) => f.path === path)?.message : undefined);
const generalError = (e: unknown, fields: string[]) =>
  e instanceof ApiClientError && !(e.fieldErrors.length > 0 && e.fieldErrors.every((f) => fields.includes(f.path))) ? e.message : null;

/** Company details: the organization's name and the postal address printed in its email footers. Administrators edit; everyone else reads. */
function CompanyTab({ me }: { me: MeDto }) {
  const { toast } = useToast();
  const update = useUpdateTenant();
  const isAdmin = me.user.access === "Administrator";
  const [name, setName] = useState(me.tenant.name);
  const [address, setAddress] = useState(me.tenant.postalAddress);

  const nameChanged = name.trim() !== me.tenant.name;
  // Compared the way the server tidies it, so retyping the same address with different spacing is not a change.
  const tidy = (v: string) => v.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  const addressChanged = tidy(address) !== me.tenant.postalAddress;
  const changed = isAdmin && (nameChanged || addressChanged);
  const complete = name.trim() !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed || !complete || update.isPending) return;
    update.reset();
    try {
      // Only what changed is sent. The server saves both or neither.
      const saved = await update.mutateAsync({ ...(nameChanged ? { name: name.trim() } : {}), ...(addressChanged ? { postalAddress: address } : {}) });
      setName(saved.name);
      setAddress(saved.postalAddress);
      toast("Company details updated");
    } catch {
      /* shown below */
    }
  }

  const nameError = fieldError(update.error, "name");
  const addressError = fieldError(update.error, "postalAddress");
  const general = generalError(update.error, ["name", "postalAddress"]);

  return (
    <Card className="max-w-2xl">
      <CardHeader title="Company details" subtitle={isAdmin ? "Your organization's name and postal address." : "Your organization's name and postal address. Only an Administrator can change these."} />
      <form onSubmit={submit} noValidate>
        <div className="space-y-4 p-5">
          <Field label="Name" htmlFor="co-name" hint={isAdmin ? "Shown to everyone in your organization and in the invitations you send." : ""}>
            <TextInput id="co-name" autoComplete="organization" maxLength={100} value={isAdmin ? name : me.tenant.name} readOnly={!isAdmin} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameError} />
            {nameError && <p className="mt-1 text-xs text-rose-600">{nameError}</p>}
          </Field>
          <Field label="Postal address" htmlFor="co-address" hint="Included in the footer of every email.">
            <TextArea
              id="co-address"
              rows={2}
              maxLength={500}
              placeholder={isAdmin ? "Company name, street, city, country" : "Not set yet"}
              value={isAdmin ? address : me.tenant.postalAddress}
              readOnly={!isAdmin}
              disabled={!isAdmin}
              onChange={(e) => setAddress(e.target.value)}
              aria-invalid={!!addressError}
            />
            {addressError && <p className="mt-1 text-xs text-rose-600">{addressError}</p>}
          </Field>
        </div>
        {general && <div className="px-5 pb-4"><Notice tone="error">{general}</Notice></div>}
        {isAdmin && (
          <div className="flex justify-end border-t border-slate-200 px-5 py-3.5 dark:border-slate-800">
            <Button type="submit" variant="primary" disabled={!changed || !complete || update.isPending}>{update.isPending ? "Saving…" : "Save changes"}</Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function UserDetailsTab({ me }: { me: MeDto }) {
  const { toast } = useToast();
  const save = useUpdateProfile();
  const [first, setFirst] = useState(me.user.firstName);
  const [last, setLast] = useState(me.user.lastName);
  const changed = first.trim() !== me.user.firstName || last.trim() !== me.user.lastName;
  const complete = first.trim() !== "" && last.trim() !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed || !complete || save.isPending) return;
    try {
      const saved = await save.mutateAsync({ firstName: first.trim(), lastName: last.trim() });
      setFirst(saved.firstName);
      setLast(saved.lastName);
      toast("Profile updated");
    } catch {
      /* shown below */
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader title="User details" subtitle="How your name appears to the rest of your organization." />
      <form onSubmit={submit} noValidate>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="First name" htmlFor="pf-first">
            <TextInput id="pf-first" autoComplete="given-name" maxLength={100} value={first} onChange={(e) => setFirst(e.target.value)} />
            {fieldError(save.error, "firstName") && <p className="mt-1 text-xs text-rose-600">{fieldError(save.error, "firstName")}</p>}
          </Field>
          <Field label="Last name" htmlFor="pf-last">
            <TextInput id="pf-last" autoComplete="family-name" maxLength={100} value={last} onChange={(e) => setLast(e.target.value)} />
            {fieldError(save.error, "lastName") && <p className="mt-1 text-xs text-rose-600">{fieldError(save.error, "lastName")}</p>}
          </Field>
          <Field label="Email address" htmlFor="pf-email" hint="Your sign-in. Ask an Administrator if it needs to change.">
            <TextInput id="pf-email" value={me.user.email} readOnly disabled />
          </Field>
          <Field label="Role" htmlFor="pf-role" hint="Set by an Administrator of your organization.">
            <TextInput id="pf-role" value={me.user.access} readOnly disabled />
          </Field>
        </div>
        {generalError(save.error, ["firstName", "lastName"]) && <div className="px-5 pb-4"><Notice tone="error">{generalError(save.error, ["firstName", "lastName"])}</Notice></div>}
        <div className="flex justify-end border-t border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <Button type="submit" variant="primary" disabled={!changed || !complete || save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>
    </Card>
  );
}

function AccountTab() {
  const { toast } = useToast();
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);

  const problem = passwordProblem(next) ?? (next !== "" && next === current ? "Choose a password different from your current one" : null);
  const mismatch = confirm !== next;
  const error = change.error;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (current === "" || problem || mismatch || change.isPending) return;
    try {
      await change.mutateAsync({ currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      setTouched(false);
      toast("Password changed. Your other devices were signed out.");
    } catch {
      setCurrent(""); // never keep a rejected password on screen
    }
  }

  const currentError = fieldError(error, "currentPassword");
  const nextError = (touched && problem) || fieldError(error, "newPassword");

  return (
    <Card className="max-w-2xl">
      <CardHeader title="Password" subtitle="Change the password you sign in with." />
      <form onSubmit={submit} noValidate>
        <div className="space-y-4 p-5">
          <Field label="Current password" htmlFor="pw-current">
            <TextInput id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} aria-invalid={!!currentError} />
            {currentError && <p className="mt-1 text-xs text-rose-600">{currentError}</p>}
          </Field>
          <Field label="New password" htmlFor="pw-new" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
            <TextInput id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={!!nextError} />
            {nextError && <p className="mt-1 text-xs text-rose-600">{nextError}</p>}
          </Field>
          <Field label="Confirm new password" htmlFor="pw-confirm">
            <TextInput id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={touched && mismatch} />
            {touched && mismatch && <p className="mt-1 text-xs text-rose-600">The passwords do not match.</p>}
          </Field>
          <p className="text-xs text-slate-500">Changing your password signs you out everywhere else. This device stays signed in.</p>
        </div>
        {generalError(error, ["currentPassword", "newPassword"]) && <div className="px-5 pb-4"><Notice tone="error">{generalError(error, ["currentPassword", "newPassword"])}</Notice></div>}
        <div className="flex justify-end border-t border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <Button type="submit" variant="primary" disabled={current === "" || next === "" || confirm === "" || change.isPending}>{change.isPending ? "Changing…" : "Change password"}</Button>
        </div>
      </form>
    </Card>
  );
}
