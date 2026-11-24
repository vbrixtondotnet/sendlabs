import { Button, ErrorNotice, LoadingRows } from "@/components/ui";
import { SlidePanel } from "@/components/SlidePanel";
import { SAMPLE_CONTACT, composeEmailHtml } from "@/lib/merge";
import { useAvailableTemplate, useEmailTemplate } from "@/services/emailTemplates";
import { useMe } from "@/services/me";

/** What is being previewed: one of My Templates or an Available one, both by id. */
export type TemplateTarget = { kind: "mine" | "available"; id: string; name: string };

/** The message as a recipient would see it, filled in with a sample contact, in a SlidePanel. Only the body: the signature, footer and postal address are added when a campaign is sent. */
export function TemplatePreviewPanel({ target, open, onClose, onExited }: { target: TemplateTarget; open: boolean; onClose: () => void; onExited?: () => void }) {
  const mine = useEmailTemplate(target.kind === "mine" ? target.id : null);
  const available = useAvailableTemplate(target.kind === "available" ? target.id : null);
  const full = target.kind === "available" ? available : mine;
  // {{senderCompany}} shows the account's own company name.
  const me = useMe();
  const sender = me.data?.company.name ?? "";
  const doc = full.data
    ? `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;padding:16px">${composeEmailHtml({ body: full.data.htmlBody, signature: "", companyName: sender, postalAddress: "", unsubscribeFooter: false }, SAMPLE_CONTACT)}</body></html>`
    : "";
  return (
    <SlidePanel open={open} onExited={() => onExited?.()} title={target.name} subtitle="Preview" size="lg" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      {full.isError ? (
        <ErrorNotice error={full.error} onRetry={() => void full.refetch()} />
      ) : full.isPending ? (
        <LoadingRows rows={4} cols={1} />
      ) : (
        <>
          <iframe title="Template preview" sandbox="" srcDoc={doc} className="h-[60vh] w-full rounded-lg border border-slate-200 bg-white dark:border-slate-800" />
          <p className="mt-2 text-xs text-slate-500">Filled in with a sample contact (Alex, Example Co). The signature, the unsubscribe footer and your postal address are added when a campaign is sent.</p>
        </>
      )}
    </SlidePanel>
  );
}
