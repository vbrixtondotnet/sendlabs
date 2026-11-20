import { and, count, eq } from "drizzle-orm";
import type { ContactFields } from "../../../shared/types";
import { newId, nowMs } from "../../lib/id";
import { BULK_ROWS, chunk, runBulk } from "../batch";
import type { Database } from "../client";
import { campaignRecipients, campaigns, tenants, type CampaignRow } from "../schema";

/** A contact as it is frozen into a recipient at launch. */
export interface RecipientSnapshot {
  contactId: string;
  email: string;
  fields: Partial<ContactFields>;
}

/** The people a campaign's audience resolves to, and how many were left out. */
export interface Audience {
  recipients: RecipientSnapshot[];
  /** In the audience but not eligible: on the suppression list, or having withdrawn consent. */
  excluded: number;
}

/** Everything about launching one campaign, scoped to one tenant. */
export function campaignLaunchRepo(db: Database, tenantId: string) {
  const all = async <T,>(text: string, ...params: unknown[]) => ((await db.$client.prepare(text).bind(...params).all()).results ?? []) as T[];

  return {
    async campaign(id: string): Promise<CampaignRow | null> {
      const [row] = await db.select().from(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, id))).limit(1);
      return row ?? null;
    },

    async postalAddress(): Promise<string> {
      const [row] = await db.select({ a: tenants.postalAddress }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      return row?.a ?? "";
    },

    /**
     * Resolves the audience: every contact of the organization, or the people in the chosen import, or those in the chosen
     * industries. Anyone on the suppression list, and anyone who withdrew consent, is left out (and counted).
     */
    async audience(c: Pick<CampaignRow, "recipientImportId" | "recipientIndustries">): Promise<Audience> {
      // The audience filter, as a SQL condition on `contacts` with its bound values (industries go in as one JSON array, so
      // a long list cannot run into D1's limit on bound parameters).
      let filter = "";
      const params: unknown[] = [tenantId];
      if (c.recipientImportId) {
        filter = "AND id IN (SELECT contact_id FROM import_rows WHERE tenant_id = ?1 AND import_id = ?2 AND contact_id IS NOT NULL)";
        params.push(c.recipientImportId);
      } else if (c.recipientIndustries.length > 0) {
        filter = "AND industry IN (SELECT value FROM json_each(?2))";
        params.push(JSON.stringify(c.recipientIndustries));
      }
      const rows = await all<Record<string, unknown>>(
        `SELECT id, normalized_email, first_name, last_name, title, company_name, employees, industry, linkedin_url, website, city, state, country, annual_revenue,
                (consent_status = 'Withdrawn' OR EXISTS (SELECT 1 FROM suppressions s WHERE s.tenant_id = contacts.tenant_id AND s.normalized_email = contacts.normalized_email)) AS excluded
           FROM contacts WHERE tenant_id = ?1 ${filter} ORDER BY created_at, id`,
        ...params,
      );
      const recipients: RecipientSnapshot[] = [];
      let excluded = 0;
      for (const r of rows) {
        if (r.excluded) {
          excluded++;
          continue;
        }
        recipients.push({
          contactId: r.id as string,
          email: r.normalized_email as string,
          fields: {
            email: r.normalized_email as string,
            firstName: r.first_name as string,
            lastName: r.last_name as string,
            title: r.title as string,
            companyName: r.company_name as string,
            employees: (r.employees as number | null) ?? null,
            industry: r.industry as string,
            linkedinUrl: r.linkedin_url as string,
            website: r.website as string,
            city: r.city as string,
            state: r.state as string,
            country: r.country as string,
            annualRevenue: (r.annual_revenue as number | null) ?? null,
          },
        });
      }
      return { recipients, excluded };
    },

    /**
     * Writes one recipient row per person, Pending, in send order. A previous launch that was interrupted may have left
     * rows behind, so they are cleared first: a Draft never has real ones. Chunked, so it is safe for thousands.
     */
    async writeRecipients(campaignId: string, recipients: readonly RecipientSnapshot[]): Promise<void> {
      await db.$client.prepare("DELETE FROM campaign_recipients WHERE tenant_id = ?1 AND campaign_id = ?2").bind(tenantId, campaignId).run();
      const now = nowMs();
      const insert = `INSERT INTO campaign_recipients
          (id, tenant_id, campaign_id, contact_id, email_snapshot, personalization_snapshot, sequence, status, attempt_count, created_at, updated_at)
        SELECT json_extract(value,'$[0]'), ?2, ?3, json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]'), json_extract(value,'$[4]'), 'Pending', 0, ?4, ?4
        FROM json_each(?1) WHERE true`;
      let sequence = 0;
      const statements = chunk(recipients, BULK_ROWS).map((group) =>
        db.$client.prepare(insert).bind(
          JSON.stringify(group.map((r) => [newId(), r.contactId, r.email, JSON.stringify(r.fields), ++sequence])),
          tenantId,
          campaignId,
          now,
        ),
      );
      await runBulk(db, statements);
    },

    /** Draft -> Sending, once. Returns false when someone else got there first (or the campaign is no longer a Draft). */
    async start(campaignId: string, senderAccountId: string | null): Promise<boolean> {
      const now = nowMs();
      const rows = await db
        .update(campaigns)
        .set({ status: "Sending", launchedAt: now, nextRunAt: now, completedAt: null, ...(senderAccountId ? { senderAccountId } : {}) })
        .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignId), eq(campaigns.status, "Draft")))
        .returning({ id: campaigns.id });
      return rows.length > 0;
    },

    async recipientCount(campaignId: string): Promise<number> {
      const [row] = await db.select({ n: count() }).from(campaignRecipients).where(and(eq(campaignRecipients.tenantId, tenantId), eq(campaignRecipients.campaignId, campaignId)));
      return row?.n ?? 0;
    },

    /** Failed -> Pending for every failed recipient, so they are sent again. Returns how many. */
    async requeueFailed(campaignId: string): Promise<number> {
      const rows = await db
        .update(campaignRecipients)
        .set({ status: "Pending", attemptCount: 0, lastError: null, leaseExpiresAt: null, updatedAt: nowMs() })
        .where(and(eq(campaignRecipients.tenantId, tenantId), eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "Failed")))
        .returning({ id: campaignRecipients.id });
      return rows.length;
    },

    /** CompletedWithErrors -> Sending, due now, so the retried recipients go out. */
    async reopen(campaignId: string): Promise<boolean> {
      const now = nowMs();
      const rows = await db
        .update(campaigns)
        .set({ status: "Sending", nextRunAt: now, completedAt: null })
        .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, campaignId), eq(campaigns.status, "CompletedWithErrors")))
        .returning({ id: campaigns.id });
      return rows.length > 0;
    },
  };
}
