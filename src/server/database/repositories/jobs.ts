import { and, asc, count, eq, ilike, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { JobCompanyDto, JobDto, Page } from "../../../shared/api";
import type { JobSourceType } from "../../../shared/jobs";
import type { JobListQuery } from "../../../shared/schemas";
import { BULK_ROWS, chunk } from "../batch";
import { isoOrNull, offsetOf, pageOf } from "../../lib/http";
import { nowMs } from "../../lib/id";
import type { Database } from "../client";
import { globalJobs, jobSources, type GlobalJobRow, type JobSourceRow, type NewGlobalJobRow } from "../schema";

/** `%`, `_` and `\` typed by a person must match themselves in a LIKE pattern, not act as wildcards. */
const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

const toDto = (j: GlobalJobRow, source: string): JobDto => ({
  id: j.id,
  title: j.jobTitle,
  companyName: j.companyName,
  companyLogo: j.companyLogo,
  category: j.category,
  employmentType: j.employmentType,
  location: j.location,
  salary: j.salary,
  skills: j.tags,
  url: j.jobUrl,
  source,
  publishedAt: isoOrNull(j.publishedAt),
});

/** A job as the sources deliver it, ready to store. */
export type JobInput = Omit<NewGlobalJobRow, "id" | "jobSourceId" | "createdAt" | "updatedAt" | "isActive">;

/** Jobs from every active source. Not scoped to a tenant: the jobs belong to the platform, like global_contacts. */
export function jobsRepo(db: Database) {
  /** Only jobs that are still listed by a source that is switched on. */
  const visible = and(eq(globalJobs.isActive, true), eq(jobSources.isActive, true));

  return {
    /** One page of the jobs matching every filter that was given, newest first. Paging happens in the database. */
    async search(q: JobListQuery): Promise<Page<JobDto>> {
      const where: SQL[] = [visible!];
      if (q.keyword) {
        const like = `%${likeEscape(q.keyword)}%`;
        const any = or(ilike(globalJobs.jobTitle, like), ilike(globalJobs.companyName, like), sql`${globalJobs.tags}::text ILIKE ${like}`);
        if (any) where.push(any);
      }
      if (q.categories.length > 0) where.push(inArray(globalJobs.category, q.categories));
      if (q.locations.length > 0) where.push(inArray(globalJobs.location, q.locations));
      const condition = and(...where);

      const [rows, totals] = await Promise.all([
        db
          .select({ job: globalJobs, source: jobSources.name })
          .from(globalJobs)
          .innerJoin(jobSources, eq(jobSources.id, globalJobs.jobSourceId))
          .where(condition)
          .orderBy(sql`${globalJobs.publishedAt} DESC NULLS LAST`, asc(globalJobs.id))
          .limit(q.pageSize)
          .offset(offsetOf(q.page, q.pageSize)),
        db.select({ n: count() }).from(globalJobs).innerJoin(jobSources, eq(jobSources.id, globalJobs.jobSourceId)).where(condition),
      ]);
      return pageOf(rows.map((r) => toDto(r.job, r.source)), totals[0]?.n ?? 0, q.page, q.pageSize);
    },

    /** The choices of the Category filter. */
    async categories(): Promise<string[]> {
      const rows = await db
        .selectDistinct({ v: globalJobs.category })
        .from(globalJobs)
        .innerJoin(jobSources, eq(jobSources.id, globalJobs.jobSourceId))
        .where(and(visible, sql`${globalJobs.category} <> ''`))
        .orderBy(asc(globalJobs.category));
      return rows.map((r) => r.v);
    },

    /** The choices of the Location filter. */
    async locations(): Promise<string[]> {
      const rows = await db
        .selectDistinct({ v: globalJobs.location })
        .from(globalJobs)
        .innerJoin(jobSources, eq(jobSources.id, globalJobs.jobSourceId))
        .where(and(visible, sql`${globalJobs.location} <> ''`))
        .orderBy(asc(globalJobs.location));
      return rows.map((r) => r.v);
    },

    /** The companies with the most jobs listed, for the Hiring Companies panel. */
    async companies(limit = 20): Promise<JobCompanyDto[]> {
      const rows = (await db.execute(sql`
        SELECT j.company_name AS name,
               (array_agg(j.company_logo ORDER BY j.published_at DESC NULLS LAST) FILTER (WHERE j.company_logo <> ''))[1] AS logo,
               mode() WITHIN GROUP (ORDER BY j.category) AS category,
               count(*)::int AS open_positions
          FROM global_jobs j JOIN job_sources s ON s.id = j.job_source_id
         WHERE j.is_active AND s.is_active AND j.company_name <> ''
         GROUP BY j.company_name
         ORDER BY open_positions DESC, j.company_name
         LIMIT ${limit}`)) as unknown as { name: string; logo: string | null; category: string; open_positions: number }[];
      return rows.map((r) => ({ name: r.name, logo: r.logo ?? "", category: r.category, openPositions: r.open_positions }));
    },

    /* ---------------------------- used by the synchronization ---------------------------- */

    /** The source row, created on first use. The name is the identity (compared ignoring case). */
    async ensureSource(name: string, sourceType: JobSourceType, apiEndpoint: string): Promise<JobSourceRow> {
      const [created] = await db.insert(jobSources).values({ name, sourceType, apiEndpoint }).onConflictDoNothing().returning();
      if (created) return created;
      const [existing] = await db.select().from(jobSources).where(sql`lower(${jobSources.name}) = lower(${name})`).limit(1);
      if (!existing) throw new Error(`Job source "${name}" could not be created`);
      return existing;
    },

    /** Records that a synchronization was tried now (it counts for the schedule even if it fails). */
    async markAttempt(sourceId: string, at = nowMs()): Promise<void> {
      await db.update(jobSources).set({ lastAttemptAt: at }).where(eq(jobSources.id, sourceId));
    },

    /** Records a successful synchronization. */
    async markSynced(sourceId: string, at = nowMs()): Promise<void> {
      await db.update(jobSources).set({ lastSyncedAt: at, lastAttemptAt: at }).where(eq(jobSources.id, sourceId));
    },

    /**
     * Stores the jobs: new ones are inserted, ones already stored (same source and external id) are updated, never duplicated.
     * Anything the source returned is (again) active. Returns how many rows were created and how many updated.
     */
    async upsertMany(sourceId: string, jobs: JobInput[]): Promise<{ created: number; updated: number }> {
      let created = 0;
      let updated = 0;
      for (const part of chunk(jobs, BULK_ROWS)) {
        const now = nowMs();
        const rows = await db
          .insert(globalJobs)
          .values(part.map((j) => ({ ...j, jobSourceId: sourceId, isActive: true, createdAt: now, updatedAt: now })))
          .onConflictDoUpdate({
            target: [globalJobs.jobSourceId, globalJobs.externalJobId],
            set: {
              jobTitle: sql`excluded.job_title`, companyName: sql`excluded.company_name`, companyLogo: sql`excluded.company_logo`,
              category: sql`excluded.category`, employmentType: sql`excluded.employment_type`, location: sql`excluded.location`,
              salary: sql`excluded.salary`, tags: sql`excluded.tags`, description: sql`excluded.description`, jobUrl: sql`excluded.job_url`,
              publishedAt: sql`excluded.published_at`, isActive: true, updatedAt: now,
            },
          })
          // xmax is 0 for a row that was just inserted, and non-zero for one that was updated
          .returning({ inserted: sql<boolean>`(xmax = 0)` });
        for (const r of rows) r.inserted ? created++ : updated++;
      }
      return { created, updated };
    },

    /** Marks as inactive the source's jobs that are not in `seenExternalIds` any more. Returns how many it closed. */
    async deactivateMissing(sourceId: string, seenExternalIds: string[]): Promise<number> {
      const closed = await db
        .update(globalJobs)
        .set({ isActive: false, updatedAt: nowMs() })
        .where(and(eq(globalJobs.jobSourceId, sourceId), eq(globalJobs.isActive, true), seenExternalIds.length > 0 ? notInArray(globalJobs.externalJobId, seenExternalIds) : undefined))
        .returning({ id: globalJobs.id });
      return closed.length;
    },
  };
}
