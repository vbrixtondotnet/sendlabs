import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { MeDto } from "@shared/api";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "@shared/password-rules";
import { Button, Card, CardHeader, ErrorNotice, Field, LoadingRows, Notice, PageHeader, TextInput } from "@/components/ui";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useChangePassword, useMe, useUpdateProfile } from "@/services/me";

const TABS = ["User Details", "Account Details"] as const;
type Tab = (typeof TABS)[number];

/** The signed-in user's own settings: their name and position, and their password. (Organization-wide settings, including Company Details, are under Settings in the sidebar, for Administrators.) */
export function MySettings() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const wanted = params.get("tab");
    return wanted === "account" ? "Account Details" : "User Details";
  });
  const me = useMe();

  return (
    <>
      <PageHeader title="My settings" description="Your own details and your password." />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? "border-brand-600 text-brand-600 dark:text-brand-400" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>{t}</button>
        ))}
      </div>
      {me.isError ? (
        <ErrorNotice error={me.error} onRetry={() => void me.refetch()} />
      ) : !me.data ? (
        <Card className="max-w-2xl"><LoadingRows rows={3} cols={1} /></Card>
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

function UserDetailsTab({ me }: { me: MeDto }) {
  const { toast } = useToast();
  const save = useUpdateProfile();
  const [first, setFirst] = useState(me.user.firstName);
  const [last, setLast] = useState(me.user.lastName);
  const [position, setPosition] = useState(me.user.position);
  const changed = first.trim() !== me.user.firstName || last.trim() !== me.user.lastName || position.trim() !== me.user.position;
  const complete = first.trim() !== "" && last.trim() !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed || !complete || save.isPending) return;
    try {
      const saved = await save.mutateAsync({ firstName: first.trim(), lastName: last.trim(), position: position.trim() });
      setFirst(saved.firstName);
      setLast(saved.lastName);
      setPosition(saved.position);
      toast("Profile updated");
    } catch {
      /* shown below */
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader title="User details" subtitle="How your name and position appear to the rest of your organization." />
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
          <Field label="Position" htmlFor="pf-position" hint="Your job title, shown to the rest of your organization. Optional.">
            <TextInput id="pf-position" autoComplete="organization-title" maxLength={100} placeholder="e.g. Sales Director" value={position} onChange={(e) => setPosition(e.target.value)} />
            {fieldError(save.error, "position") && <p className="mt-1 text-xs text-rose-600">{fieldError(save.error, "position")}</p>}
          </Field>
          <Field label="Email address" htmlFor="pf-email" hint="Your sign-in. Ask an Administrator if it needs to change.">
            <TextInput id="pf-email" value={me.user.email} readOnly disabled />
          </Field>
          <Field label="Role" htmlFor="pf-role" hint="Set by an Administrator of your organization.">
            <TextInput id="pf-role" value={me.user.access} readOnly disabled />
          </Field>
        </div>
        {generalError(save.error, ["firstName", "lastName", "position"]) && <div className="px-5 pb-4"><Notice tone="error">{generalError(save.error, ["firstName", "lastName", "position"])}</Notice></div>}
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
