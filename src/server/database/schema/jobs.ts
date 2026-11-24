import { bigint, boolean, check, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { JOB_SOURCE_TYPES } from "../../../shared/jobs";
import { createdAt, idColumn, inList, updatedAt } from "./helpers";

/**
 * Where jobs come from: one row per feed (Remotive today; others later). Like `global_contacts`, it belongs to no tenant: every
 * organization sees the same jobs.
 */
export const jobSources = pgTable(
  "job_sources",
  {
    id: idColumn(),
    name: text("name").notNull(),
    /** How the jobs are obtained: see JOB_SOURCE_TYPES in shared/jobs.ts. */
    sourceType: text("source_type", { enum: JOB_SOURCE_TYPES }).notNull(),
    apiEndpoint: text("api_endpoint").notNull().default(""),
    /** An inactive source is not synchronized and its jobs are not listed. */
    isActive: boolean("is_active").notNull().default(true),
    /** UTC milliseconds of the last successful synchronization; null before the first. */
    lastSyncedAt: bigint("last_synced_at", { mode: "number" }),
    /** UTC milliseconds of the last try, successful or not. The scheduled sync waits from here, so a failing source is not hit every minute. */
    lastAttemptAt: bigint("last_attempt_at", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("job_sources_name_uq").on(sql`lower(${t.name})`),
    check("job_sources_type_chk", inList("source_type", JOB_SOURCE_TYPES)),
  ],
);

/**
 * A job from any source. `(job_source_id, external_job_id)` is the job's identity at its source, so a synchronization can run as
 * often as it likes and never creates a second row for the same job: it updates the existing one.
 */
export const globalJobs = pgTable(
  "global_jobs",
  {
    id: idColumn(),
    jobSourceId: text("job_source_id")
      .notNull()
      .references(() => jobSources.id, { onDelete: "restrict" }),
    /** The job's id at the source (Remotive's numeric id, as text). */
    externalJobId: text("external_job_id").notNull(),

    jobTitle: text("job_title").notNull(),
    companyName: text("company_name").notNull().default(""),
    companyLogo: text("company_logo").notNull().default(""),
    category: text("category").notNull().default(""),
    /** As people read it: "Full-time", "Part-time", "Contract", "Freelance"... */
    employmentType: text("employment_type").notNull().default(""),
    /** Where the person may work from (Remotive's "candidate required location"): "Worldwide", "USA, Canada"... */
    location: text("location").notNull().default(""),
    /** As written by the employer ("$14/hour"); empty when not given. */
    salary: text("salary").notNull().default(""),
    /** Skills / keywords: a JSON array of strings. */
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** The source's HTML. Stored for completeness; it is never rendered in the app (it is not ours to trust as markup). */
    description: text("description").notNull().default(""),
    /** The job's page at the source: where "Apply" goes, and the link back the source requires. */
    jobUrl: text("job_url").notNull().default(""),
    /** When the source published it (UTC ms). */
    publishedAt: bigint("published_at", { mode: "number" }),
    /** False once the source stops listing it. Inactive jobs are kept but not shown. */
    isActive: boolean("is_active").notNull().default(true),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("global_jobs_source_external_uq").on(t.jobSourceId, t.externalJobId),
    index("global_jobs_active_published_idx").on(t.isActive, t.publishedAt),
    index("global_jobs_category_idx").on(t.category),
    index("global_jobs_company_idx").on(t.companyName),
    check("global_jobs_tags_chk", sql`jsonb_typeof("tags") = 'array'`),
  ],
);

export type JobSourceRow = typeof jobSources.$inferSelect;
export type GlobalJobRow = typeof globalJobs.$inferSelect;
export type NewGlobalJobRow = typeof globalJobs.$inferInsert;
