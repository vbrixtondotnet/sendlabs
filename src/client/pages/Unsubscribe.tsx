import { useParams } from "react-router-dom";
import { Button, LoadingRows } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { ApiClientError } from "@/services/http";
import { useUnsubscribe, useUnsubscribeInfo } from "@/services/unsubscribe";

/**
 * The page the "Unsubscribe" link at the bottom of every email opens. Public: the person is not signed in to anything,
 * and the signed token in the address is the only credential. Opening the page changes nothing; the person has to press
 * the button, so a mail scanner that opens every link cannot unsubscribe anyone. It stands outside the app layout on
 * purpose, so it never asks "who am I" or shows anyone's navigation.
 */
export function Unsubscribe() {
  const { token = "" } = useParams();
  const info = useUnsubscribeInfo(token);
  const unsubscribe = useUnsubscribe(token);
  const invalid = info.error instanceof ApiClientError && info.error.code === "UNSUBSCRIBE_INVALID";
  const done = unsubscribe.data;
  const failed = unsubscribe.error instanceof ApiClientError ? unsubscribe.error.message : unsubscribe.isError ? "Something went wrong. Please try again." : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo className="h-12" />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {info.isPending ? (
            <LoadingRows rows={3} cols={1} />
          ) : invalid ? (
            <>
              <h1 className="text-lg font-semibold">This unsubscribe link is not valid</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">The link may be incomplete or have been changed. Open it again from the email, or reply to the email and ask to be removed.</p>
            </>
          ) : info.isError ? (
            <>
              <h1 className="text-lg font-semibold">We could not open this page</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{info.error instanceof ApiClientError ? info.error.message : "Something went wrong."} Please try again in a moment.</p>
            </>
          ) : info.data.test ? (
            <>
              <h1 className="text-lg font-semibold">This is a test email</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                The link works, and this is the page your recipients will see. Nothing was changed: <strong>{info.data.email}</strong> has not been unsubscribed from {info.data.companyName}.
              </p>
            </>
          ) : done?.unsubscribed || info.data.alreadyUnsubscribed ? (
            <>
              <h1 className="text-lg font-semibold">{done?.unsubscribed ? "You have been unsubscribed" : "You are already unsubscribed"}</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                <strong>{info.data.email}</strong> will not receive any more emails from {info.data.companyName}.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold">Unsubscribe from {info.data.companyName}?</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                <strong>{info.data.email}</strong> will stop receiving emails from {info.data.companyName}. This takes effect straight away.
              </p>
              {failed && <p role="alert" className="mt-3 text-sm text-rose-600">{failed}</p>}
              <Button variant="primary" className="mt-5 w-full" disabled={unsubscribe.isPending} onClick={() => unsubscribe.mutate()}>
                {unsubscribe.isPending ? "Unsubscribing…" : "Unsubscribe"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
