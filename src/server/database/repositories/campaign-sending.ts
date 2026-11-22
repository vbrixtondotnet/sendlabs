import { and, count, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { ContactFields, SkipReason } from "../../../shared/types";
import type { Database } from "../client";
import { campaignRecipients, campaigns, tenants, users, type CampaignRow } from "../schema";

/** A recipient claimed for sending. */
export interface ClaimedRecipient {
  id: string;
  email: string;
  contact: Partial<ContactFields>;
  attempts: number;
}

/**
 * The queries the sender runs on a schedule. Unlike the tenant repositories this one is NOT scoped to a tenant, because the
 * tick looks across all of them; every method takes the tenant and campaign it works on, and every write is conditional on
 * the row still being in the state it was read in, so two ticks that overlap cannot send the same recipient twice.
 *
 * Recipient states follow the machine in shared/status.ts: Pending -> Queued (promote) -> Processing (claim) -> Accepted,
 * Failed or Skipped, with Processing -> Queued when a send is retried or a lease expires.
 */
export function campaignSendingRepo(db: Database) {

  return {
    /** Campaigns that are Sending and not backed off, least recently served first. */
    async due(now: number, limit: number): Promise<CampaignRow[]> {
      return db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.status, "Sending"), isNull(campaigns.archivedAt), or(isNull(campaigns.nextRunAt), lte(campaigns.nextRunAt, now))))
        .orderBy(sql`coalesce(${campaigns.lastRunAt}, 0)`)
        .limit(limit);
    },

    async tenant(tenantId: string) {
      const [row] = await db.select({ name: tenants.name, postalAddress: tenants.postalAddress }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      return row ?? null;
    },

    /** The display name of the campaign's creator: the fallback name on the From line. */
    async creatorName(tenantId: string, userId: string): Promise<string> {
      const [row] = await db.select({ name: users.displayName }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, userId))).limit(1);
      return row?.name ?? "";
    },

    /** How many were accepted since `sinceMs` (the start of the campaign's day). Accepted means the provider took it. */
    async acceptedSince(campaignId: string, sinceMs: number): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(campaignRecipients)
        .where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "Accepted"), sql`${campaignRecipients.acceptedAt} >= ${sinceMs}`));
      return row?.n ?? 0;
    },

    /** A send that started but never finished (the Worker died) goes back to the ready pool once its lease has run out. */
    async reclaimExpired(campaignId: string, now: number): Promise<void> {
      await db
        .update(campaignRecipients)
        .set({ status: "Queued", leaseExpiresAt: null, updatedAt: now })
        .where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "Processing"), sql`${campaignRecipients.leaseExpiresAt} < ${now}`));
    },

    /**
     * Pending -> Queued for the next `n` in send order. One statement, and `FOR UPDATE SKIP LOCKED` means a second tick running
     * at the same moment takes different rows instead of waiting for, or doubling up on, these.
     *
     * The rows are chosen ONCE, in a materialized CTE, and then updated. (`WHERE id IN (SELECT ... LIMIT n FOR UPDATE ...)` looks
     * equivalent but PostgreSQL may run that subquery again for each row it checks, so the LIMIT is not honoured and far more
     * than `n` rows change: a daily limit of 3 sent 5, and a trickle of 1 sent all 30.)
     */
    async promote(tenantId: string, campaignId: string, n: number, now: number): Promise<void> {
      await db.execute(sql`
        WITH picked AS MATERIALIZED (
          SELECT id FROM campaign_recipients
           WHERE tenant_id = ${tenantId} AND campaign_id = ${campaignId} AND status = 'Pending'
           ORDER BY sequence LIMIT ${n} FOR UPDATE SKIP LOCKED)
        UPDATE campaign_recipients r SET status = 'Queued', queued_at = ${now}, updated_at = ${now}
          FROM picked WHERE r.id = picked.id`);
    },

    /**
     * Queued -> Processing for the next `n` in send order, with a lease, counting the attempt. Returns exactly the rows this
     * call claimed: the UPDATE and its RETURNING are one statement, and SKIP LOCKED keeps two ticks from claiming the same row.
     */
    async claim(tenantId: string, campaignId: string, n: number, now: number, leaseMs: number): Promise<ClaimedRecipient[]> {
      const rows = (await db.execute(sql`
        WITH picked AS MATERIALIZED (
          SELECT id FROM campaign_recipients
           WHERE tenant_id = ${tenantId} AND campaign_id = ${campaignId} AND status = 'Queued'
           ORDER BY sequence LIMIT ${n} FOR UPDATE SKIP LOCKED)
        UPDATE campaign_recipients r SET status = 'Processing', lease_expires_at = ${now + leaseMs}, attempt_count = r.attempt_count + 1, updated_at = ${now}
          FROM picked WHERE r.id = picked.id
        RETURNING r.id, r.email_snapshot, r.personalization_snapshot, r.attempt_count, r.sequence`)) as unknown as {
        id: string;
        email_snapshot: string;
        personalization_snapshot: Partial<ContactFields> | string;
        attempt_count: number;
        sequence: number;
      }[];
      return [...rows]
        .sort((a, b) => a.sequence - b.sequence)
        .map((r) => ({
          id: r.id,
          email: r.email_snapshot,
          // jsonb comes back already parsed
          contact: (typeof r.personalization_snapshot === "string" ? JSON.parse(r.personalization_snapshot) : r.personalization_snapshot) as Partial<ContactFields>,
          attempts: r.attempt_count,
        }));
    },

    // Outcomes. Each is conditional on the recipient still being Processing, so a late write cannot overwrite a newer state.
    async accepted(id: string, now: number): Promise<void> {
      await db.update(campaignRecipients).set({ status: "Accepted", acceptedAt: now, leaseExpiresAt: null, lastError: null, updatedAt: now }).where(and(eq(campaignRecipients.id, id), eq(campaignRecipients.status, "Processing")));
    },
    async failed(id: string, error: string, now: number): Promise<void> {
      await db.update(campaignRecipients).set({ status: "Failed", leaseExpiresAt: null, lastError: error.slice(0, 300), updatedAt: now }).where(and(eq(campaignRecipients.id, id), eq(campaignRecipients.status, "Processing")));
    },
    async retryLater(id: string, error: string, now: number): Promise<void> {
      await db.update(campaignRecipients).set({ status: "Queued", leaseExpiresAt: null, lastError: error.slice(0, 300), updatedAt: now }).where(and(eq(campaignRecipients.id, id), eq(campaignRecipients.status, "Processing")));
    },
    async skipped(id: string, reason: SkipReason, now: number): Promise<void> {
      await db.update(campaignRecipients).set({ status: "Skipped", skipReason: reason, leaseExpiresAt: null, updatedAt: now }).where(and(eq(campaignRecipients.id, id), eq(campaignRecipients.status, "Processing")));
    },

    /** Recipients still to be sent (Pending, Queued or Processing), and how many have Failed. */
    async progress(campaignId: string): Promise<{ open: number; failed: number }> {
      const rows = await db
        .select({ status: campaignRecipients.status, n: count() })
        .from(campaignRecipients)
        .where(and(eq(campaignRecipients.campaignId, campaignId), inArray(campaignRecipients.status, ["Pending", "Queued", "Processing", "Failed"])))
        .groupBy(campaignRecipients.status);
      const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
      return { open: n("Pending") + n("Queued") + n("Processing"), failed: n("Failed") };
    },

    // Campaign state. Conditional on it still being Sending, so a pause or cancel in between is never overwritten.
    async finish(campaignId: string, status: "Completed" | "CompletedWithErrors" | "Failed", now: number): Promise<void> {
      await db.update(campaigns).set({ status, completedAt: now, nextRunAt: null, lastRunAt: now }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "Sending")));
    },
    async backoff(campaignId: string, untilMs: number, now: number): Promise<void> {
      await db.update(campaigns).set({ nextRunAt: untilMs, lastRunAt: now }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "Sending")));
    },
    async touched(campaignId: string, now: number): Promise<void> {
      await db.update(campaigns).set({ lastRunAt: now }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "Sending")));
    },
  };
}
