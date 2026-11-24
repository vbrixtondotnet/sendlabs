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
