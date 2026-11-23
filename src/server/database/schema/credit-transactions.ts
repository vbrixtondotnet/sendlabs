import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, idColumn } from "./helpers";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * The credit ledger: one row each time a user's balance changes (today only People reveals spend credits; buying credits
 * will add positive rows). `balance_after` makes the history auditable without replaying it. Rows are only ever added.
 */
export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: idColumn(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Negative when credits are spent, positive when added. */
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    /** What caused it, e.g. "people_reveal". */
    reason: text("reason").notNull(),
    /** The global contact that was revealed, when that is the reason. A soft reference: the directory belongs to no tenant. */
    globalContactId: text("global_contact_id"),
    /** The contact it became in the tenant's list. */
    contactId: text("contact_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("credit_transactions_user_created_idx").on(t.userId, t.createdAt),
    check("credit_transactions_delta_chk", sql.raw(`"delta" <> 0`)),
    check("credit_transactions_balance_chk", sql.raw(`"balance_after" >= 0`)),
  ],
);

export type CreditTransactionRow = typeof creditTransactions.$inferSelect;
