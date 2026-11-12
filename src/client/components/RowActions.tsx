import { useEffect, useRef, useState } from "react";

export type RowIcon = "preview" | "add" | "edit" | "delete";

export type RowAction = { label: string; icon?: RowIcon; ariaLabel?: string; onSelect: () => void; danger?: boolean; disabled?: boolean };

const PATHS: Record<RowIcon, string> = {
  preview: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  add: "M12 5v14M5 12h14",
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4",
  delete: "M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3",
};

function Icon({ name }: { name: RowIcon }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

const itemCls = "flex w-full items-center gap-2 cursor-pointer whitespace-nowrap rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-800 dark:focus:bg-slate-800";

/**
 * A row's actions as a dropdown: one "Actions" button that opens a small menu. The menu is positioned fixed under the
 * button so a scrolling table cannot clip it; it closes on Escape, on a click elsewhere, on scroll, and after a choice.
 */
export function RowActions({ label, actions }: { label: string; actions: RowAction[] }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); button.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = () => {
    if (open) return setPos(null);
    const r = button.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  };

  return (
    <div ref={root} className="inline-block text-left">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <span aria-hidden="true" className="text-base leading-none">⋯</span>
      </button>
      {open && (
        <div role="menu" aria-label={label} style={{ position: "fixed", top: pos.top, right: pos.right }} className="z-40 min-w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {actions.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              type="button"
              aria-label={a.ariaLabel}
              disabled={a.disabled}
              onClick={() => { setPos(null); a.onSelect(); }}
              className={`${itemCls} ${a.danger ? "text-rose-600" : "text-slate-700 dark:text-slate-200"}`}
            >
              {a.icon && <Icon name={a.icon} />}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
