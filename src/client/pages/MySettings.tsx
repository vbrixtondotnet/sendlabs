import { useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { MeDto } from "@shared/api";
import { AVATAR_ACCEPT, avatarProblem } from "@shared/avatar";
import type { Role } from "@shared/types";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "@shared/password-rules";
import { Button, Card, CardHeader, ErrorNotice, Field, LoadingRows, Notice, PageHeader, TextInput } from "@/components/ui";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { initialsOf, useChangePassword, useMe, useRemoveAvatar, useUpdateProfile, useUploadAvatar } from "@/services/me";
import { CompanyTab, EmailServiceTab } from "@/pages/Settings";

type Tab = "Profile" | "Account Details" | "Company Details" | "Email Service" | "Email Settings";

/**
 * The tabs of Account Settings. Everyone has Profile and Account Details. The rest is what used to be on the Settings page: an Agency also has
 * its Company Details and Email Service; a JobSeeker has its Email Settings (the Gmail connection, without the campaign-only cards).
 */
function tabsFor(role: Role | undefined): readonly Tab[] {
  if (role === "Agency") return ["Profile", "Account Details", "Company Details", "Email Service"];
  if (role === "JobSeeker") return ["Profile", "Account Details", "Email Settings"];
  return ["Profile", "Account Details"];
}

/**
 * The signed-in user's own settings, opened from Account Settings in the user menu: their picture, name and position, their password, and
 * (by role) the company details and the email service. `?tab=` picks a tab (profile, account, company, email); coming back from Google's
 * Connect Gmail screen (?sender=...) opens the email tab.
 */
export function MySettings() {
  const [params] = useSearchParams();
  const me = useMe();
  const tabs = tabsFor(me.data?.user.role);
  const [chosen, setChosen] = useState<Tab | null>(null);
  // Read once, when the page opens: the Gmail connection clears ?sender=... from the address afterwards, and the tab must stay where it is.
  const [first] = useState(() => ({ wanted: params.get("tab"), sender: params.has("sender") }));
  const wanted = first.wanted;
  const emailTab: Tab = me.data?.user.role === "Agency" ? "Email Service" : "Email Settings";
  const fromUrl: Tab = wanted === "account" ? "Account Details" : wanted === "company" ? "Company Details" : wanted === "email" || first.sender ? emailTab : "Profile";
  const tab: Tab = chosen && tabs.includes(chosen) ? chosen : tabs.includes(fromUrl) ? fromUrl : "Profile";
  const setTab = (t: Tab) => setChosen(t);

  return (
    <>
      <PageHeader title="Account Settings" description="Your picture and details, your password, and how your email is sent." />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? "border-brand-600 text-brand-600 dark:text-brand-400" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>{t}</button>
        ))}
      </div>
      {me.isError ? (
        <ErrorNotice error={me.error} onRetry={() => void me.refetch()} />
      ) : !me.data ? (
        <Card className="max-w-2xl"><LoadingRows rows={3} cols={1} /></Card>
      ) : tab === "Profile" ? (
        <ProfileTab me={me.data} />
      ) : tab === "Company Details" ? (
        <CompanyTab />
      ) : tab === "Email Service" || tab === "Email Settings" ? (
        <EmailServiceTab />
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

/** The profile picture: shown big, with Upload / Change picture and Remove. Only images are accepted; it shows in the header at once. */
function PictureField({ me }: { me: MeDto }) {
  const { toast } = useToast();
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const picker = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = upload.isPending || remove.isPending;
  const url = me.user.avatarUrl;

  async function choose(file: File | undefined) {
    if (picker.current) picker.current.value = ""; // so the same file can be chosen again
    if (!file) return;
    const p = avatarProblem(file);
    setProblem(p);
    if (p) return;
    try {
      await upload.mutateAsync(file);
      toast("Profile picture updated");
    } catch (e) {
      setProblem(e instanceof ApiClientError ? (e.fieldErrors[0]?.message ?? e.message) : "The picture could not be uploaded. Please try again.");
    }
  }

  async function clear() {
    setProblem(null);
    try {
      await remove.mutateAsync();
      toast("Profile picture removed");
    } catch {
      setProblem("The picture could not be removed. Please try again.");
    }
  }

  return (
    <div className="p-5 pb-0">
      <p className="mb-2 text-sm font-medium">Profile picture</p>
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-600 text-xl font-semibold text-white" data-testid="profile-picture">
          {url ? <img src={url} alt="Your profile picture" className="h-full w-full object-cover" /> : initialsOf(me.user.displayName, me.user.email)}
        </div>
        <div>
          <input ref={picker} id="pf-picture" type="file" accept={AVATAR_ACCEPT} className="sr-only" aria-label="Profile picture file" onChange={(e) => void choose(e.target.files?.[0])} disabled={busy} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => picker.current?.click()} disabled={busy}>{upload.isPending ? "Uploading…" : url ? "Change picture" : "Upload picture"}</Button>
            {url && <Button type="button" variant="ghost" onClick={() => void clear()} disabled={busy}>{remove.isPending ? "Removing…" : "Remove"}</Button>}
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">JPG, PNG, WebP or GIF, up to 2 MB. It replaces your initials at the top of every page.</p>
          {problem && <p className="mt-1 text-sm text-rose-600 dark:text-rose-400" role="alert">{problem}</p>}
        </div>
      </div>
    </div>
  );
}

function ProfileTab({ me }: { me: MeDto }) {
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
      <CardHeader title="Profile" subtitle="Your picture, and how your name and job title appear in your email signature." />
      <PictureField me={me} />
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
          <Field label="Job Title" htmlFor="pf-position" hint="Shown in your email signature. Optional.">
            <TextInput id="pf-position" autoComplete="organization-title" maxLength={100} placeholder="e.g. Sales Director" value={position} onChange={(e) => setPosition(e.target.value)} />
            {fieldError(save.error, "position") && <p className="mt-1 text-xs text-rose-600">{fieldError(save.error, "position")}</p>}
          </Field>
          <Field label="Email address" htmlFor="pf-email" hint="Your sign-in.">
            <TextInput id="pf-email" value={me.user.email} readOnly disabled />
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
