import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, idColumn } from "./helpers";
import { users } from "./users";

/**
 * The credit ledger: one row each time a user's balance changes (today only People reveals spend credits; buying credits
 * will add positive rows). `balance_after` makes the history auditable without replaying it. Rows are only ever added.
 */
export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Negative when credits are spent, positive when added. */
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    /** What caused it, e.g. "people_reveal". */
    reason: text("reason").notNull(),
    /** The global contact that was revealed, when that is the reason. A soft reference: the directory belongs to no account. */
    globalContactId: text("global_contact_id"),
    /** The contact it became in the account's list. */
    contactId: text("contact_id"),
    /** A short free-text detail: for a contact-email lookup, the company that was searched (lower-cased). */
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("credit_transactions_user_created_idx").on(t.userId, t.createdAt),
    index("credit_transactions_user_note_idx").on(t.userId, t.reason, t.note),
    check("credit_transactions_delta_chk", sql.raw(`"delta" <> 0`)),
    check("credit_transactions_balance_chk", sql.raw(`"balance_after" >= 0`)),
  ],
);

export type CreditTransactionRow = typeof creditTransactions.$inferSelect;
