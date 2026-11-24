import { check, foreignKey, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { SUPPRESSION_REASONS } from "../../../shared/types";
import { campaigns } from "./campaigns";
import { createdAt, idColumn, inList, normalizedEmailRule } from "./helpers";
import { users } from "./users";

/**
 * Addresses that must never be emailed again by this account: today, people who used an unsubscribe link. One row per
 * address per account (unsubscribing twice changes nothing). Rows are only ever added by the unsubscribe endpoint.
 */
export const suppressions = pgTable(
  "suppressions",
  {
    id: idColumn(),
    /** The account that owns this row. Every query filters by it; the composite keys below stop a row pointing at another account's data. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** As the link carried it (already trimmed and lower-cased). */
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    reason: text("reason", { enum: SUPPRESSION_REASONS }).notNull().default("Unsubscribed"),
    /** The campaign whose email carried the link, when known. */
    campaignId: text("campaign_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("suppressions_user_email_uq").on(t.userId, t.normalizedEmail),
    foreignKey({ columns: [t.userId, t.campaignId], foreignColumns: [campaigns.userId, campaigns.id], name: "suppressions_campaign_fk" }),
    check("suppressions_reason_chk", inList("reason", SUPPRESSION_REASONS)),
    check("suppressions_email_chk", normalizedEmailRule("normalized_email")),
  ],
);

export type SuppressionRow = typeof suppressions.$inferSelect;
