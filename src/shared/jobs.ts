/** Jobs: the one outside source, Remotive, and what the app needs to know about it. */
export const REMOTIVE = {
  name: "Remotive",
  endpoint: "https://remotive.com/api/remote-jobs",
  categoriesEndpoint: "https://remotive.com/api/remote-jobs/categories",
  /** Remotive asks for a link back and a mention of Remotive wherever its jobs are shown. */
  homepage: "https://remotive.com",
} as const;

/** An address Apply may open: https, on remotive.com (the link Remotive supplies for a job), else "". Used by the server and the page. */
export function safeApplyUrl(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return "";
    if (u.hostname !== "remotive.com" && !u.hostname.endsWith(".remotive.com")) return "";
    return u.toString();
  } catch {
    return "";
  }
}
