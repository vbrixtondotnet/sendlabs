import { bigint, index, jsonb, pgTable, text, uniqueIndex, check } from "drizzle-orm/pg-core";
import type { JobDescriptionBlock, JobDto } from "../../../shared/api";
import { SHARE_NETWORKS } from "../../../shared/shares";
import { createdAt, idColumn, inList } from "./helpers";
import { users } from "./users";

/**
 * A job one person shared on a social network. `id` is what the public link carries (/share/<id>); `snapshot` is a copy of the job and its
 * description taken when the share started, so the public page keeps working after the job leaves its source's list. One row per person, job
 * and network: that is what makes the credit once-only. `rewarded_at` is set in the same transaction that adds the credit.
 */
export const jobShares = pgTable(
  "job_shares",
  {
    id: idColumn(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    jobId: text("job_id").notNull(),
    network: text("network").notNull(),
    snapshot: jsonb("snapshot").$type<{ job: JobDto; blocks: JobDescriptionBlock[] }>().notNull(),
    /** When the share window was last opened (the confirm delay counts from here). */
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    rewardedAt: bigint("rewarded_at", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("job_shares_user_job_network_uq").on(t.userId, t.jobId, t.network),
    index("job_shares_user_rewarded_idx").on(t.userId, t.rewardedAt),
    check("job_shares_network_chk", inList("network", SHARE_NETWORKS)),
  ],
);

export type JobShareRow = typeof jobShares.$inferSelect;
