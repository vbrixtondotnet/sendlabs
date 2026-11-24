import { useEffect, useRef, useState, type ReactNode } from "react";

/** How long the panel takes to slide out (the CSS `--slide-ms`: 300 ms, or 160 ms when the system asks for less motion). The exit waits this long. */
const SLIDE_EXIT_MS = 300;

/**
 * THE standard right-hand panel: every task that belongs next to what you were looking at (applying for a job, writing or
 * previewing an email template, a job description) opens in this one component, with its own content as `children`. Do not make a
 * second kind of side panel or use a centred dialog for these: put a new panel in `components/panels/` and build it on this.
 *
 * A panel that slides in from the right edge over the page. The page behind it dims. Setting `open` to false slides it back out, and only then is it removed and
 * `onExited` called, so the host can forget what it was about. Like a dialog it takes focus, keeps Tab inside, closes on Escape or a
 * click on the dimmed page (both call `onClose`; the host decides), and gives focus back to what opened it. `footer` stays at the
 * bottom while the body scrolls.
 */
export function SlidePanel({ open, title, subtitle, onClose, onExited, children, footer, size = "md" }: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onExited?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** `md` (36rem) for forms and short text, `lg` (48rem) for a rich-text editor or a preview. */
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  // Stays mounted while it slides out.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = window.setTimeout(() => { setMounted(false); onExitedRef.current?.(); }, SLIDE_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () => [...(ref.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    // Focus the first field (a field with autoFocus already has it), else the panel itself.
    if (ref.current && !ref.current.contains(document.activeElement)) (focusable().find((el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) ?? ref.current).focus();
    return () => { window.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, [open, mounted]);
  if (!open && !mounted) return null;
  return (
    <div className="fixed inset-0 z-40" {...(open ? {} : { "aria-hidden": true, inert: true })}>
      <div className={`absolute inset-0 bg-slate-900/40 ${open ? "fade-in" : "fade-out"}`} onClick={onClose} aria-hidden="true" />
      <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`${open ? "slide-in-right" : "slide-out-right"} absolute inset-y-0 right-0 flex w-full ${size === "lg" ? "max-w-3xl" : "max-w-xl"} flex-col bg-white shadow-2xl outline-none dark:bg-slate-900`}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-medium">{title}</h2>
            {subtitle && <p className="truncate text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="shrink-0 cursor-pointer rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close panel">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-3.5 dark:border-slate-800">{footer}</div>}
      </aside>
    </div>
  );
}
