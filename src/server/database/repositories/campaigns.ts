import { and, count, desc, eq, exists, getTableColumns, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { CampaignDto, CampaignSummaryDto, Page, RecipientDto, RecipientTotals } from "../../../shared/api";
import type {
  CampaignCreate,
  CampaignListQuery,
  CampaignPatch,
  RecipientListQuery,
} from "../../../shared/schemas";
import { windowIsValid } from "../../../shared/schemas";
import {
  CAMPAIGN_ACTIONS,
  canTransitionCampaign,
  isCampaignEditable,
  isCampaignInFlight,
  stampsCompletedAt,
  UNSENT_RECIPIENT_STATUSES,
  type CampaignAction,
} from "../../../shared/status";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { emptyTotals, toCampaignDto, toCampaignSummaryDto, toRecipientDto } from "../../lib/dto";
import { likeContains, offsetOf, pageOf } from "../../lib/http";
import { nowMs } from "../../lib/id";
import type { Database } from "../client";
import { campaignRecipients, campaigns } from "../schema";
import { importsRepo } from "./imports";

/** Everything except the (potentially large) bodies. */
const { htmlBody: _html, textBody: _text, ...summaryColumns } = getTableColumns(campaigns);

export function campaignsRepo(db: Database) {
  const rowById = async (id: string) => {
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    return row ?? null;
  };

  /** Recipient counts by status for the given campaigns. D1 allows at most 100 bound parameters per statement. */
  async function totalsFor(ids: string[]): Promise<Map<string, RecipientTotals>> {
    const out = new Map<string, RecipientTotals>(ids.map((id) => [id, emptyTotals()]));
    if (ids.length === 0) return out;
    const rows = await db
      .select({ campaignId: campaignRecipients.campaignId, status: campaignRecipients.status, n: count() })
      .from(campaignRecipients)
      .where(inArray(campaignRecipients.campaignId, ids))
      .groupBy(campaignRecipients.campaignId, campaignRecipients.status);
    for (const r of rows) {
      const t = out.get(r.campaignId);
      if (t) t[r.status] = r.n;
    }
    return out;
  }

  const full = async (id: string): Promise<CampaignDto> => {
    const row = await rowById(id);
    if (!row) throw notFound("Campaign");
    const totals = (await totalsFor([id])).get(id) ?? emptyTotals();
    return toCampaignDto(row, totals);
  };

  return {
    async list(q: CampaignListQuery): Promise<Page<CampaignSummaryDto>> {
      const conditions: (SQL | undefined)[] = [];
      if (q.status) conditions.push(eq(campaigns.status, q.status));
      if (q.archived === "exclude") conditions.push(isNull(campaigns.archivedAt));
      if (q.archived === "only") conditions.push(isNotNull(campaigns.archivedAt));
      if (q.q) {
        const pat = likeContains(q.q.toLowerCase());
        conditions.push(
          or(
            sql`lower(${campaigns.name}) LIKE ${pat} ESCAPE '\\'`,
            sql`lower(${campaigns.subject}) LIKE ${pat} ESCAPE '\\'`,
          ),
        );
      }
      const where = and(...conditions);

      const [rows, totalRows] = await Promise.all([
        db
          .select(summaryColumns)
          .from(campaigns)
          .where(where)
          .orderBy(desc(campaigns.createdAt), desc(campaigns.id))
          .limit(q.pageSize)
          .offset(offsetOf(q.page, q.pageSize)),
        db.select({ n: count() }).from(campaigns).where(where),
      ]);
      const totals = await totalsFor(rows.map((r) => r.id));
      return pageOf(
        rows.map((r) => toCampaignSummaryDto(r, totals.get(r.id) ?? emptyTotals())),
        totalRows[0]?.n ?? 0,
        q.page,
        q.pageSize,
      );
    },

    get: full,

    async create(input: CampaignCreate, createdBy: string): Promise<CampaignDto> {
      if (input.recipientImportId) await importsRepo(db).assertUsable(input.recipientImportId);
      const [row] = await db.insert(campaigns).values({ ...input, createdBy }).returning();
      if (!row) throw new Error("Insert returned no row");
      return toCampaignDto(row, emptyTotals());
    },

    /** Only drafts are editable. Status never changes here. */
    async updateDraft(id: string, patch: CampaignPatch): Promise<CampaignDto> {
      const current = await rowById(id);
      if (!current) throw notFound("Campaign");
      if (!isCampaignEditable(current.status)) {
        throw conflict("Only draft campaigns can be edited", "CAMPAIGN_LOCKED", { status: current.status });
      }
      if (patch.recipientImportId) await importsRepo(db).assertUsable(patch.recipientImportId);
      const start = patch.sendWindowStart ?? current.sendWindowStart;
      const end = patch.sendWindowEnd ?? current.sendWindowEnd;
      if (!windowIsValid(start, end)) {
        throw badRequest("The send window must end after it starts", [{ path: "sendWindowEnd", message: "Must be after the start" }], "VALIDATION_ERROR");
      }
      // The status guard in WHERE closes the race with a concurrent launch.
      const [row] = await db
        .update(campaigns)
        .set(patch)
        .where(and(eq(campaigns.id, id), eq(campaigns.status, "Draft")))
        .returning({ id: campaigns.id });
      if (!row) throw conflict("Only draft campaigns can be edited", "CAMPAIGN_LOCKED");
      return full(id);
    },

    /** A new Draft with the same content and schedule and no recipients. */
    async duplicate(id: string, createdBy: string): Promise<CampaignDto> {
      const src = await rowById(id);
      if (!src) throw notFound("Campaign");
      const [row] = await db
        .insert(campaigns)
        .values({
          name: `Copy of ${src.name}`.slice(0, 200),
          subject: src.subject,
          htmlBody: src.htmlBody,
          textBody: src.textBody,
          senderAccountId: src.senderAccountId,
          recipientImportId: src.recipientImportId,
          dailyLimit: src.dailyLimit,
          sendWindowStart: src.sendWindowStart,
          sendWindowEnd: src.sendWindowEnd,
          timezone: src.timezone,
          createdBy,
        })
        .returning();
      if (!row) throw new Error("Insert returned no row");
      return toCampaignDto(row, emptyTotals());
    },

    async setArchived(id: string, archived: boolean): Promise<CampaignDto> {
      const row = await rowById(id);
      if (!row) throw notFound("Campaign");
      if (archived && isCampaignInFlight(row.status)) {
        throw conflict("Pause or cancel the campaign before archiving it", "CAMPAIGN_IN_FLIGHT", { status: row.status });
      }
      await db
        .update(campaigns)
        .set({ archivedAt: archived ? (row.archivedAt ?? nowMs()) : null })
        .where(eq(campaigns.id, id));
      return full(id);
    },

    /** Drafts only. A launched campaign is history: archive it instead. Recipients cascade. */
    async deleteDraft(id: string): Promise<void> {
      const rows = await db
        .delete(campaigns)
        .where(and(eq(campaigns.id, id), eq(campaigns.status, "Draft")))
        .returning({ id: campaigns.id });
      if (rows.length > 0) return;
      if (!(await rowById(id))) throw notFound("Campaign");
      throw conflict("Only draft campaigns can be deleted. Archive it instead.", "CAMPAIGN_LOCKED");
    },

    /**
     * Pause, resume or cancel. The state machine decides legality, and the UPDATE is guarded by the
     * status that was read, so two concurrent actions cannot both succeed.
     * Cancelling also cancels recipients that have not been sent, in the same atomic batch.
     * Recipients already Processing are left to the consumer, which must re-check the campaign status.
     */
    async applyAction(id: string, action: CampaignAction): Promise<CampaignDto> {
      const def = CAMPAIGN_ACTIONS[action];
      const row = await rowById(id);
      if (!row) throw notFound("Campaign");
      const allowed = (def.from as readonly string[]).includes(row.status) && canTransitionCampaign(row.status, def.to);
      if (!allowed) {
        throw conflict(`Cannot ${action} a campaign that is ${row.status}`, "INVALID_TRANSITION", {
          status: row.status,
          action,
        });
      }

      const now = nowMs();
      const set = {
        status: def.to,
        // Pause and cancel stop the daily tick. Resume makes the campaign due at the next tick.
        nextRunAt: action === "resume" ? now : null,
        ...(stampsCompletedAt(def.to) ? { completedAt: now } : {}),
      };

      const campaignUpdate = db
        .update(campaigns)
        .set(set)
        .where(and(eq(campaigns.id, id), eq(campaigns.status, row.status)))
        .returning({ id: campaigns.id });

      if (action === "cancel") {
        const cancelRecipients = db
          .update(campaignRecipients)
          .set({ status: "Cancelled", leaseExpiresAt: null })
          .where(
            and(
              eq(campaignRecipients.campaignId, id),
              inArray(campaignRecipients.status, [...UNSENT_RECIPIENT_STATUSES]),
              // Only if the first statement in this batch really cancelled the campaign.
              exists(db.select({ one: sql`1` }).from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.status, "Cancelled")))),
            ),
          );
        const [updated] = await db.batch([campaignUpdate, cancelRecipients]);
        if (updated.length === 0) throw conflict("The campaign changed while you were acting on it. Reload and retry.", "CONFLICT");
      } else {
        const updated = await campaignUpdate;
        if (updated.length === 0) throw conflict("The campaign changed while you were acting on it. Reload and retry.", "CONFLICT");
      }
      return full(id);
    },

    async listRecipients(campaignId: string, q: RecipientListQuery): Promise<Page<RecipientDto>> {
      if (!(await rowById(campaignId))) throw notFound("Campaign");
      const conditions: (SQL | undefined)[] = [eq(campaignRecipients.campaignId, campaignId)];
      if (q.status) conditions.push(eq(campaignRecipients.status, q.status));
      if (q.q) conditions.push(sql`lower(${campaignRecipients.emailSnapshot}) LIKE ${likeContains(q.q.toLowerCase())} ESCAPE '\\'`);
      const where = and(...conditions);

      const [rows, totalRows] = await Promise.all([
        db
          .select()
          .from(campaignRecipients)
          .where(where)
          .orderBy(campaignRecipients.sequence)
          .limit(q.pageSize)
          .offset(offsetOf(q.page, q.pageSize)),
        db.select({ n: count() }).from(campaignRecipients).where(where),
      ]);
      return pageOf(rows.map(toRecipientDto), totalRows[0]?.n ?? 0, q.page, q.pageSize);
    },
  };
}
