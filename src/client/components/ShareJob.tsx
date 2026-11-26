import { useEffect, useState } from "react";
import type { JobDto } from "@shared/api";
import { SHARE_NETWORKS, SHARE_NETWORK_LABEL, SHARE_REWARD, shareWindowUrl, type ShareNetwork } from "@shared/shares";
import { Button } from "@/components/ui";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { useConfirmShare, useStartShare } from "@/services/jobs";

/** A small LinkedIn / Facebook mark. Text on a coloured square, so there is no logo artwork to ship. */
const MARK: Record<ShareNetwork, { text: string; cls: string }> = {
  linkedin: { text: "in", cls: "bg-[#0a66c2] font-bold" },
  facebook: { text: "f", cls: "bg-[#1877f2] font-bold" },
};

/**
 * Share this job on LinkedIn or Facebook to earn credit, on every job card. Pressing a network opens that network's own share window with
 * the public link of the job (/share/<id>). The networks do not tell us whether the person posted, so afterwards they confirm with
 * "I've posted it" (offered once there has been time to write the post) and the server gives the credit, once per job per network, with
 * limits (see shared/shares.ts).
 */
export function ShareJob({ job }: { job: JobDto }) {
  const { toast } = useToast();
  const start = useStartShare();
  const confirm = useConfirmShare();
  const [pending, setPending] = useState<{ network: ShareNetwork; shareId: string; readyAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick while waiting, so the button can say how long is left and then switch on.
  useEffect(() => {
    if (!pending || Date.now() >= pending.readyAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [pending]);

  async function share(network: ShareNetwork) {
    // Open the window now, in the click, so the browser does not block it; it is pointed at the network once our server has the link.
    const win = window.open("", "sendrix-share", "popup,width=720,height=640");
    try {
      const r = await start.mutateAsync({ jobId: job.id, title: job.title, network });
      const target = shareWindowUrl(network, r.url);
      if (win) win.location.href = target;
      else window.open(target, "_blank", "noopener,noreferrer");
      if (r.alreadyRewarded) {
        setPending(null);
        toast(`Shared. You have already earned the credit for this job on ${SHARE_NETWORK_LABEL[network]}.`, "info");
      } else {
        const at = Date.now() + r.confirmAfterMs;
        setNow(Date.now());
        setPending({ network, shareId: r.shareId, readyAt: at });
      }
    } catch (e) {
      win?.close();
      toast(e instanceof ApiClientError ? e.message : "The job could not be shared. Please try again.", "error");
    }
  }

  async function posted() {
    if (!pending) return;
    try {
      const r = await confirm.mutateAsync(pending.shareId);
      setPending(null);
      toast(r.rewarded ? `Thank you for sharing! ${SHARE_REWARD} Credit has been added to your account.` : "This share has already earned its credit.", r.rewarded ? "success" : "info");
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "The credit could not be added. Please try again.", "error");
    }
  }

  if (pending) {
    const wait = Math.max(0, Math.ceil((pending.readyAt - now) / 1000));
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300" role="group" aria-label="Confirm your share">
        <span>Posted it on {SHARE_NETWORK_LABEL[pending.network]}?</span>
        <Button type="button" variant="primary" className="cursor-pointer !px-2.5 !py-0.5 text-xs" onClick={() => void posted()} disabled={wait > 0 || confirm.isPending}>
          {wait > 0 ? `I've posted it (${wait}s)` : confirm.isPending ? "Adding…" : "I've posted it"}
        </Button>
        <button type="button" className="cursor-pointer underline" onClick={() => setPending(null)}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400" role="group" aria-label="Share this job">
      <span>Share this job and earn {SHARE_REWARD} Credit</span>
      {SHARE_NETWORKS.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => void share(n)}
          disabled={start.isPending}
          aria-label={`Share on ${SHARE_NETWORK_LABEL[n]}`}
          title={`Share on ${SHARE_NETWORK_LABEL[n]}`}
          className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded text-xs leading-none text-white transition hover:opacity-85 disabled:opacity-50 ${MARK[n].cls}`}
        >
          {MARK[n].text}
        </button>
      ))}
    </div>
  );
}
