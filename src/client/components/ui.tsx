import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { CampaignStatus, RecipientStatus } from "@shared/types";
import { ApiClientError } from "@/services/http";

/* ---------- formatting ---------- */
export const fmt = (n: number) => n.toLocaleString("en-US");
export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "n/a";
export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/* ---------- Card / layout ---------- */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action, subtitle }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: string | undefined; tone?: "default" | "good" | "warn" | "bad" }) {
  const tones = {
    default: "text-slate-900 dark:text-slate-100",
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-rose-600 dark:text-rose-400",
  } as const;
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </Card>
  );
}

/* ---------- Buttons ---------- */
type Variant = "primary" | "secondary" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:hover:bg-indigo-600",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
  danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:hover:bg-rose-600",
  ghost: "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
};

export function Button({
  variant = "secondary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    />
  );
}

/* ---------- Badges ---------- */
const badgeTones = {
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  indigo: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
} as const;
export type BadgeTone = keyof typeof badgeTones;

export function Badge({ tone = "slate", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

const campaignTone: Record<CampaignStatus, BadgeTone> = {
  Draft: "slate",
  Queuing: "blue",
  Queued: "blue",
  Sending: "indigo",
  Paused: "amber",
  Completed: "green",
  CompletedWithErrors: "amber",
  Failed: "red",
  Cancelled: "slate",
};
const campaignLabel: Record<CampaignStatus, string> = {
  Draft: "Draft",
  Queuing: "Queuing",
  Queued: "Queued",
  Sending: "Sending",
  Paused: "Paused",
  Completed: "Completed",
  CompletedWithErrors: "Completed with errors",
  Failed: "Failed",
  Cancelled: "Cancelled",
};
export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return <Badge tone={campaignTone[status]}>{campaignLabel[status]}</Badge>;
}

export const recipientTone: Record<RecipientStatus, BadgeTone> = {
  Pending: "slate",
  Queued: "blue",
  Processing: "indigo",
  Accepted: "green",
  Failed: "red",
  Skipped: "amber",
  Cancelled: "slate",
};
/** The product never says "Delivered": Gmail API acceptance is not inbox delivery. */
export const recipientLabel: Record<RecipientStatus, string> = {
  Pending: "Pending",
  Queued: "Queued",
  Processing: "Processing",
  Accepted: "Accepted by Gmail",
  Failed: "Failed",
  Skipped: "Skipped",
  Cancelled: "Cancelled",
};
export function RecipientStatusBadge({ status }: { status: RecipientStatus }) {
  return <Badge tone={recipientTone[status]}>{recipientLabel[status]}</Badge>;
}

/* ---------- Progress ---------- */
export const segmentColors: Record<RecipientStatus, string> = {
  Accepted: "bg-emerald-500",
  Processing: "bg-indigo-500",
  Queued: "bg-sky-400",
  Failed: "bg-rose-500",
  Skipped: "bg-amber-400",
  Cancelled: "bg-slate-400",
  Pending: "bg-slate-200 dark:bg-slate-700",
};

export function StackedBar({ totals }: { totals: Record<RecipientStatus, number> }) {
  const total = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const order: RecipientStatus[] = ["Accepted", "Processing", "Queued", "Failed", "Skipped", "Cancelled", "Pending"];
  return (
    <div
      className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      role="img"
      aria-label={order.map((s) => `${recipientLabel[s]} ${totals[s]}`).join(", ")}
    >
      {order.map((s) =>
        totals[s] > 0 ? <div key={s} className={segmentColors[s]} style={{ width: `${(totals[s] / total) * 100}%` }} title={`${recipientLabel[s]}: ${fmt(totals[s])}`} /> : null,
      )}
    </div>
  );
}

export function ProgressBar({ value, max, tone = "indigo" }: { value: number; max: number; tone?: "indigo" | "green" }) {
  const pct = Math.min(100, (value / (max || 1)) * 100);
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div className={`h-full ${tone === "green" ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ---------- Tables ---------- */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ children, className = "" }: { children?: ReactNode; className?: string }) => (
  <th scope="col" className={`whitespace-nowrap bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400 ${className}`}>
    {children}
  </th>
);
export const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) => (
  <td className={`border-t border-slate-100 px-4 py-2.5 align-middle dark:border-slate-800 ${className}`}>{children}</td>
);

export function Pagination({ page, pageCount, total, pageSize, onPage }: { page: number; pageCount: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400" aria-label="Pagination">
      <span>
        {fmt(from)}-{fmt(to)} of {fmt(total)}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => onPage(1)} disabled={page <= 1} aria-label="First page">«</Button>
        <Button variant="secondary" onClick={() => onPage(page - 1)} disabled={page <= 1}>Previous</Button>
        <span className="px-1 tabular-nums">
          Page {fmt(page)} / {fmt(pageCount)}
        </span>
        <Button variant="secondary" onClick={() => onPage(page + 1)} disabled={page >= pageCount}>Next</Button>
        <Button variant="secondary" onClick={() => onPage(pageCount)} disabled={page >= pageCount} aria-label="Last page">»</Button>
      </div>
    </nav>
  );
}

/* ---------- Form controls ---------- */
const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:disabled:bg-slate-800";

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}
export const TextInput = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${inputCls} ${p.className ?? ""}`} />;
export const TextArea = (p: React.ComponentProps<"textarea">) => <textarea {...p} className={`${inputCls} ${p.className ?? ""}`} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${inputCls} ${p.className ?? ""}`} />;

/* ---------- Modal ---------- */
export function Modal({ open, title, onClose, children, footer, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass a fresh onClose every render. Keep it in a ref so the effect below runs only when the dialog
  // opens or closes: re-running it on every keystroke would pull focus out of the field being typed in.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    // Focus the dialog itself, unless a field inside it (autoFocus) already has focus.
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative max-h-[90vh] w-full overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-slate-900 ${wide ? "max-w-2xl" : "max-w-lg"}`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close dialog">✕</button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3.5 dark:border-slate-800">{footer}</div>}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "error" | "good"; title?: string; children: ReactNode }) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
    warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
    error: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200",
    good: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  } as const;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`} role={tone === "error" ? "alert" : undefined}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">{children}</div>;
}

/* ---------- Loading and errors (live data) ---------- */

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiClientError ? error : null;
  const message =
    e?.code === "NETWORK"
      ? "Could not reach the API. Start it with `npm run dev:api` and reload."
      : e?.code === "AUTH_NOT_CONFIGURED"
        ? "The API refused the request: authentication is not configured for this environment."
        : (e?.message ?? "Something went wrong.");
  return (
    <Notice tone="error" title="Could not load data">
      <p>{message}</p>
      {e?.correlationId && <p className="mt-1 text-xs opacity-80">Reference: {e.correlationId}</p>}
      {onRetry && <Button className="mt-3" onClick={onRetry}>Try again</Button>}
    </Notice>
  );
}

/** Placeholder rows while a table loads. */
export function LoadingRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3.5">
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className="h-4 flex-1 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ))}
    </div>
  );
}
