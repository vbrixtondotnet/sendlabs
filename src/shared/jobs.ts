/** Jobs: the outside sources, and what the app needs to know about them. */
export const REMOTIVE = {
  name: "Remotive",
  endpoint: "https://remotive.com/api/remote-jobs",
  categoriesEndpoint: "https://remotive.com/api/remote-jobs/categories",
  /** Remotive asks for a link back and a mention of Remotive wherever its jobs are shown. */
  homepage: "https://remotive.com",
} as const;

export const ARBEITNOW = {
  name: "Arbeitnow",
  endpoint: "https://www.arbeitnow.com/api/job-board-api",
  /** Arbeitnow asks for a link back to the site. */
  homepage: "https://www.arbeitnow.com",
} as const;

export const JOBICY = {
  name: "Jobicy",
  endpoint: "https://jobicy.com/api/v2/remote-jobs",
  /** Jobicy asks for a link back and credit as the source. */
  homepage: "https://jobicy.com",
} as const;

/** Every source the Jobs page shows, by name. */
export const JOB_SOURCES = [REMOTIVE, ARBEITNOW, JOBICY] as const;

/** On these sources a remote job's location is where candidates may be (not where the job is). Both credit the source on the job. */
/** Sources whose terms ask that the job names them and links back to the job on their site (shown in the View Job panel). */
export const CREDITED_SOURCES: readonly string[] = [REMOTIVE.name, JOBICY.name];

export const CANDIDATE_LOCATION_SOURCES: readonly string[] = [REMOTIVE.name, JOBICY.name];

/** Hosts Apply may open: remotive.com, jobicy.com, and Arbeitnow's national sites. */
const APPLY_HOST = /^(?:(?:[a-z0-9-]+\.)*(?:remotive|jobicy)\.com|(?:www\.)?arbeitnow\.(?:com|co\.uk|fr|ch|nl))$/i;

/** An address Apply may open: https, on one of the job sources' own sites, else "". Used by the server and the page. */
export function safeApplyUrl(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return "";
    return APPLY_HOST.test(u.hostname) ? u.toString() : "";
  } catch {
    return "";
  }
}
