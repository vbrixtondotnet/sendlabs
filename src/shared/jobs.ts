/** Jobs: the values the API, the database and the Jobs page share. */

/** How a job source delivers its jobs. Only "api" is used so far. */
export const JOB_SOURCE_TYPES = ["api", "feed", "manual"] as const;
export type JobSourceType = (typeof JOB_SOURCE_TYPES)[number];

/** The one source built so far. */
export const REMOTIVE = {
  name: "Remotive",
  endpoint: "https://remotive.com/api/remote-jobs",
  /** Remotive asks for a link back and a mention of Remotive wherever its jobs are shown. */
  homepage: "https://remotive.com",
} as const;
