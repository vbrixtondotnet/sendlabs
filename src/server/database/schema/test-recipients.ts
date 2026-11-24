import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, idColumn, normalizedEmailRule } from "./helpers";
import { users } from "./users";

/**
 * The test-send allowlist: the only addresses a campaign's "Send test email" ever mails. It is per account, so nobody
 * can aim a test at an outside address.
 */
export const testRecipients = pgTable(
  "test_recipients",
  {
    id: idColumn(),
    /** The account that owns this row. Every query filters by it; the composite keys below stop a row pointing at another account's data. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** As typed (trimmed). */
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("test_recipients_user_email_uq").on(t.userId, t.normalizedEmail),
    check("test_recipients_email_chk", normalizedEmailRule("normalized_email")),
    check("test_recipients_len_chk", sql.raw(`length("email") <= 320`)),
  ],
);

export type TestRecipientRow = typeof testRecipients.$inferSelect;
