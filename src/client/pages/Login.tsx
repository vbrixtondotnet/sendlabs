import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Button, Field, Notice, TextInput } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { goTo } from "@/lib/navigate";
import { safeNext, useLogin } from "@/services/auth";
import { ApiClientError } from "@/services/http";
import { useMe } from "@/services/me";

/** What each failure means to a person. The wrong-credentials answer is deliberately the same for every cause. */
function errorText(e: ApiClientError): string {
  switch (e.code) {
    case "INVALID_CREDENTIALS": return "Incorrect email or password.";
    case "TOO_MANY_ATTEMPTS": return e.message;
    case "USER_DISABLED":
    case "TENANT_SUSPENDED": return e.message;
    case "AUTH_NOT_CONFIGURED": return "Signing in is not available on this server yet.";
    case "NETWORK": return e.message;
    default: return e.fieldErrors[0]?.message ?? "Something went wrong. Please try again.";
  }
}

/**
 * The sign-in page. Stands outside the app layout on purpose: it has no navigation and never asks who you are,
 * except to send you straight on if you already are signed in.
 */
export function Login() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const me = useMe();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Already signed in: nothing to do here.
  if (me.data) return <Navigate to={next} replace />;

  const error = login.error instanceof ApiClientError ? login.error : null;
  const complete = email.trim() !== "" && password !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!complete || login.isPending || login.isSuccess) return;
    try {
      await login.mutateAsync({ email: email.trim(), password });
      // A full page load, so the app starts fresh as this user rather than with whatever was cached before.
      goTo(next);
    } catch {
      setPassword(""); // a failed password is never worth keeping on screen
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo className="h-12" />
        </div>

        <form onSubmit={submit} noValidate className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Use the email address and password for your Sendrix account.</p>

          <div className="mt-5 space-y-4">
            <Field label="Email address" htmlFor="login-email">
              <TextInput id="login-email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" htmlFor="login-password">
              <div className="relative">
                <TextInput id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pr-16" />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </Field>
          </div>

          {error && <div className="mt-4"><Notice tone="error">{errorText(error)}</Notice></div>}

          <Button type="submit" variant="primary" className="mt-5 w-full" disabled={!complete || login.isPending || login.isSuccess}>
            {login.isSuccess ? "Signing you in…" : login.isPending ? "Signing in…" : "Sign in"}
          </Button>
          <p className="mt-4 text-center text-xs text-slate-500">New here? Ask an Administrator of your organization to invite you.</p>
        </form>
      </div>
    </div>
  );
}
