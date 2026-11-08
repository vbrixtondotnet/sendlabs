import { sql } from "drizzle-orm";
import { check, foreignKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, idColumn, normalizedEmailRule } from "./helpers";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * The test-send allowlist: the only addresses a campaign's "Send test email" ever mails. It is per tenant and managed
 * by Administrators, so nobody can aim a test at an outside address.
 */
export const testRecipients = sqliteTable(
  "test_recipients",
  {
    id: idColumn(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    /** As typed by the Administrator (trimmed). */
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    /** The Administrator who added it. The composite key guarantees they belong to the same tenant. */
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("test_recipients_tenant_email_uq").on(t.tenantId, t.normalizedEmail),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [users.tenantId, users.id], name: "test_recipients_creator_fk" }),
    check("test_recipients_email_chk", normalizedEmailRule("normalized_email")),
    check("test_recipients_len_chk", sql.raw(`length("email") <= 320`)),
  ],
);

export type TestRecipientRow = typeof testRecipients.$inferSelect;
