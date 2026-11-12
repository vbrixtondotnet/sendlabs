import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Modal, Select } from "@/components/ui";
import { useToast } from "@/hooks/useToast";
import { ApiClientError } from "@/services/http";
import { fetchEmailTemplate, useEmailTemplates } from "@/services/emailTemplates";
import type { EmailTemplateDto } from "@shared/api";

/**
 * A small dropdown of My Templates: the templates added from the Email Templates page. Choosing one puts its message in
 * the email body. If the body already has something you wrote, it asks before replacing it. Only the body changes: the
 * subject, the signature and everything else stay.
 *
 * `isStarting` says the body is still empty or is only the untouched starting text (or the last template chosen), so
 * there is nothing of yours to lose and no need to ask.
 */
export function TemplatePicker({ isStarting, onUse }: { isStarting: boolean; onUse: (htmlBody: string, name: string) => void }) {
  const { toast } = useToast();
  const list = useEmailTemplates();
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<EmailTemplateDto | null>(null);
  const picked = list.data?.items ?? [];

  async function choose(id: string) {
    if (!id) return;
    setLoading(true);
    try {
      const template = await fetchEmailTemplate(id);
      if (isStarting) onUse(template.htmlBody, template.name);
      else setPending(template);
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "The template could not be loaded", "error");
    } finally {
      setLoading(false);
    }
  }

  // Nothing to show while it loads or if it could not load: the editor works without templates.
  if (list.isPending || list.isError) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label htmlFor="tpl-pick" className="text-sm font-medium">Start from a template</label>
      {picked.length > 0 ? (
        <Select id="tpl-pick" className="max-w-xs" value="" disabled={loading} onChange={(e) => void choose(e.target.value)}>
          <option value="">{loading ? "Loading…" : "Choose a template…"}</option>
          {picked.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      ) : (
        <span className="text-sm text-slate-500">
          My Templates is empty. <Link to="/templates" className="font-medium text-brand-600 hover:underline">Add some on Email Templates</Link>.
        </span>
      )}
      <Modal
        open={pending !== null}
        title="Replace your message?"
        onClose={() => setPending(null)}
        footer={
          <>
            <Button onClick={() => setPending(null)}>Keep my message</Button>
            <Button variant="primary" onClick={() => { if (pending) onUse(pending.htmlBody, pending.name); setPending(null); }}>Use the template</Button>
          </>
        }
      >
        <p className="text-sm">Using <strong>{pending?.name}</strong> replaces the email body you have written. Your subject, signature and the other settings are not changed.</p>
      </Modal>
    </div>
  );
}
