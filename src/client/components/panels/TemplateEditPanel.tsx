import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, Field, LoadingRows, Notice, TextInput } from "@/components/ui";
import { SlidePanel } from "@/components/SlidePanel";
import { RichTextEditor } from "@/components/RichTextEditor";
import { MERGE_FIELDS, UNSUBSCRIBE_TAG, isBlankHtml, unknownTags } from "@/lib/merge";
import { ApiClientError } from "@/services/http";

/**
 * Create or edit an email template, in a SlidePanel. `onSubmit` saves it (and may throw); the panel then slides out. For an existing
 * template pass `initial` once it has loaded (or "loading" while it has not, or `loadError`), so the panel opens at once and fills in.
 */
export function TemplateEditPanel({ open, onExited, title, subtitle, submitLabel, initial, loadError, note, onSubmit, onClose }: {
  open: boolean;
  onExited?: () => void;
  title: string;
  subtitle?: string;
  submitLabel: string;
  /** The template to edit, once it has loaded. Leave out to start a new one; pass "loading" while it is still being fetched. */
  initial?: { name: string; html: string } | "loading";
  /** Why the template could not be loaded, if it could not. */
  loadError?: ReactNode;
  note: string;
  onSubmit: (input: { name: string; htmlBody: string }) => Promise<void>;
  onClose: () => void;
}) {
  const loaded = initial !== "loading" ? initial : undefined;
  const [name, setName] = useState(loaded?.name ?? "");
  const [html, setHtml] = useState(loaded?.html ?? "");
  // An existing template arrives after the panel has opened: fill the form once, when it does.
  const [seeded, setSeeded] = useState(initial !== "loading");
  useEffect(() => {
    if (!seeded && loaded) { setName(loaded.name); setHtml(loaded.html); setSeeded(true); }
  }, [seeded, loaded]);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const fieldError = (path: string) => (error instanceof ApiClientError ? error.fieldErrors.find((f) => f.path === path)?.message : undefined);
  const general = error === null ? null
    : error instanceof ApiClientError ? (error.fieldErrors.length > 0 && error.fieldErrors.every((f) => ["name", "htmlBody"].includes(f.path)) ? null : error.message)
    : "Something went wrong. Please try again.";
  const unknown = unknownTags(html);
  const complete = seeded && name.trim() !== "" && !isBlankHtml(html);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!complete || pending) return;
    setPending(true);
    try {
      await onSubmit({ name: name.trim(), htmlBody: html });
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <SlidePanel
      open={open}
      onExited={() => onExited?.()}
      title={title}
      {...(subtitle ? { subtitle } : {})}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="template-form" disabled={!complete || pending}>{pending ? "Saving…" : submitLabel}</Button>
        </>
      }
    >
      {loadError ? (
        loadError
      ) : !seeded ? (
        <LoadingRows rows={4} cols={1} />
      ) : (
        <form id="template-form" onSubmit={submit} noValidate className="space-y-4">
          <Field label="Template name" htmlFor="tpl-name" hint="Shown in the list and in the campaign dropdown, e.g. the industry it is written for.">
            <TextInput id="tpl-name" autoFocus autoComplete="off" maxLength={100} value={name} onChange={(e) => { setName(e.target.value); setError(null); }} aria-invalid={!!fieldError("name")} />
            {fieldError("name") && <p className="mt-1 text-xs text-rose-600">{fieldError("name")}</p>}
          </Field>
          <div>
            <RichTextEditor
              label="Message"
              value={html}
              onChange={(v) => { setHtml(v); setError(null); }}
              tags={[...MERGE_FIELDS.map((m) => m.tag), UNSUBSCRIBE_TAG]}
              heightClass="min-h-[14rem]"
              hint="Just the message. A campaign adds your signature, the standard unsubscribe footer and your postal address after it."
            />
            {fieldError("htmlBody") && <p className="mt-1 text-xs text-rose-600">{fieldError("htmlBody")}</p>}
            {!fieldError("htmlBody") && unknown.length > 0 && <p className="mt-1 text-xs text-rose-600">Unknown merge field{unknown.length > 1 ? "s" : ""}: {unknown.join(", ")}</p>}
          </div>
          {general && <Notice tone="error">{general}</Notice>}
          <p className="text-xs text-slate-500">{note}</p>
        </form>
      )}
    </SlidePanel>
  );
}
