/** "Posted just now", "Posted 2 hours ago", "Posted 3 days ago", "Posted 2 weeks ago", "Posted 1 month ago". */
export function postedAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const hours = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 3_600_000));
  const unit = (n: number, word: string) => `Posted ${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (hours < 1) return "Posted just now";
  if (hours < 24) return unit(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return unit(days, "day");
  if (days < 30) return unit(Math.floor(days / 7), "week");
  return unit(Math.floor(days / 30), "month");
}

/** A banner colour for a company that has no picture of its own: the same name always gets the same one. */
export function bannerFor(name: string): string {
  const palette = [
    "linear-gradient(135deg,#0ea5b7,#0b3b5a)", "linear-gradient(135deg,#7c3aed,#312e81)", "linear-gradient(135deg,#2563eb,#0f172a)",
    "linear-gradient(135deg,#f97316,#7c2d12)", "linear-gradient(135deg,#06b6d4,#164e63)", "linear-gradient(135deg,#22c55e,#14532d)",
    "linear-gradient(135deg,#ef4444,#7f1d1d)", "linear-gradient(135deg,#64748b,#0f172a)", "linear-gradient(135deg,#ec4899,#701a75)",
  ];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}
