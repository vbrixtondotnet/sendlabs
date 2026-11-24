/** The pay a job source gives, as one line: "USD 60,000 - 80,000 / year". Empty when it gives none. */
const PERIOD: Record<string, string> = { year: "year", yearly: "year", annual: "year", annually: "year", month: "month", monthly: "month", week: "week", weekly: "week", day: "day", daily: "day", hour: "hour", hourly: "hour" };

const amount = (v: number | string | null | undefined): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};

export function payLine(p: { min?: number | string | null | undefined; max?: number | string | null | undefined; currency?: string | null | undefined; period?: string | null | undefined }): string {
  const lo = amount(p.min);
  const hi = amount(p.max);
  if (lo === null && hi === null) return "";
  const fmt = (n: number) => n.toLocaleString("en-US");
  const range = lo !== null && hi !== null && lo !== hi ? `${fmt(lo)} - ${fmt(hi)}` : fmt((lo ?? hi)!);
  const cur = (p.currency ?? "").trim();
  const per = PERIOD[(p.period ?? "").trim().toLowerCase()] ?? "";
  return `${cur ? `${cur} ` : ""}${range}${per ? ` / ${per}` : ""}`;
}
