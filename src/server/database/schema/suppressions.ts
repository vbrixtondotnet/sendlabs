import { check, foreignKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { SUPPRESSION_REASONS } from "../../../shared/types";
import { campaigns } from "./campaigns";
import { createdAt, idColumn, inList, normalizedEmailRule } from "./helpers";
import { tenants } from "./tenants";

/**
 * Addresses that must never be emailed again by this tenant: today, people who used an unsubscribe link. One row per
 * address per tenant (unsubscribing twice changes nothing). Rows are only ever added by the unsubscribe endpoint.
 */
export const suppressions = sqliteTable(
  "suppressions",
  {
    id: idColumn(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    /** As the link carried it (already trimmed and lower-cased). */
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    reason: text("reason", { enum: SUPPRESSION_REASONS }).notNull().default("Unsubscribed"),
    /** The campaign whose email carried the link, when known. */
    campaignId: text("campaign_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("suppressions_tenant_email_uq").on(t.tenantId, t.normalizedEmail),
    foreignKey({ columns: [t.tenantId, t.campaignId], foreignColumns: [campaigns.tenantId, campaigns.id], name: "suppressions_campaign_fk" }),
    check("suppressions_reason_chk", inList("reason", SUPPRESSION_REASONS)),
    check("suppressions_email_chk", normalizedEmailRule("normalized_email")),
  ],
);

export type SuppressionRow = typeof suppressions.$inferSelect;
