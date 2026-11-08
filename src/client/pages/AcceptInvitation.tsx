import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "@shared/password-rules";
import { Button, Field, LoadingRows, Notice, TextInput } from "@/components/ui";
import { goTo } from "@/lib/navigate";
import { useAcceptInvitation, useInvitationPreview } from "@/services/invitations";
import { ApiClientError } from "@/services/http";

/**
 * The page the "Accept invitation" button in the email opens. Public: the person has no account yet, and the secret
 * in the address is what proves the invitation is theirs. Standing outside the app layout on purpose, so it never
 * asks "who am I" or shows anyone's navigation.
 */
export function AcceptInvitation() {
  const { token = "" } = useParams();
  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation(token);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);

  const problem = passwordProblem(password);
  const mismatch = confirm !== password;
  const invalidLink = preview.error instanceof ApiClientError && preview.error.code === "INVITATION_INVALID";
  const error = accept.error instanceof ApiClientError ? accept.error : null;
  const done = accept.isSuccess;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (problem || mismatch || accept.isPending) return;
    try {
      const { redirectTo } = await accept.mutateAsync(password);
      // A full page load, so the app starts fresh as the new user. Only ever to a path inside this app.
      goTo(redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/");
    } catch {
      /* shown below */
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7l9 6 9-6M3 7v10h18V7H3z" /></svg>
          </div>
          <span className="text-xl font-semibold tracking-tight">Sendlab</span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {preview.isPending ? (
            <LoadingRows rows={3} cols={1} />
          ) : invalidLink ? (
            <>
              <h1 className="text-lg font-semibold">This invitation is no longer valid</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">The link may have expired, been used already, or been replaced by a newer invitation. Ask the person who invited you to send a new one.</p>
            </>
          ) : preview.isError ? (
            <>
              <h1 className="text-lg font-semibold">We could not open this invitation</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{preview.error instanceof ApiClientError ? preview.error.message : "Something went wrong."}</p>
              <Button className="mt-4" onClick={() => void preview.refetch()}>Try again</Button>
            </>
          ) : (
            <form onSubmit={submit} noValidate>
              <h1 className="text-lg font-semibold">Welcome{preview.data.firstName ? `, ${preview.data.firstName}` : ""}</h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                <strong>{preview.data.tenantName}</strong> has invited you to Sendlab as {preview.data.access === "Administrator" ? "an" : "a"} <strong>{preview.data.access}</strong>. Choose a password to activate your account.
              </p>

              <div className="mt-5 space-y-4">
                <Field label="Email" htmlFor="inv-email">
                  <TextInput id="inv-email" value={preview.data.email} readOnly disabled />
                </Field>
                <Field label="Password" htmlFor="inv-password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
                  <TextInput id="inv-password" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={touched && !!problem} aria-describedby={touched && problem ? "inv-password-error" : undefined} />
                  {touched && problem && <p id="inv-password-error" className="mt-1 text-xs text-rose-600">{problem}</p>}
                </Field>
                <Field label="Confirm password" htmlFor="inv-confirm">
                  <TextInput id="inv-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={touched && mismatch} aria-describedby={touched && mismatch ? "inv-confirm-error" : undefined} />
                  {touched && mismatch && <p id="inv-confirm-error" className="mt-1 text-xs text-rose-600">The passwords do not match.</p>}
                </Field>
              </div>

              {error && (
                <div className="mt-4">
                  <Notice tone="error">
                    {error.code === "INVITATION_INVALID"
                      ? "This invitation is no longer valid. Ask for a new one."
                      : error.code === "EMAIL_EXISTS"
                        ? "An account with this email address already exists."
                        : error.fieldErrors[0]?.message ?? error.message}
                  </Notice>
                </div>
              )}

              <Button type="submit" variant="primary" className="mt-5 w-full" disabled={accept.isPending || done}>
                {done ? "Taking you to your dashboard…" : accept.isPending ? "Activating…" : "Activate account"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
