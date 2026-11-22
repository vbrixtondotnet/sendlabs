import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, idColumn, normalizedEmailRule } from "./helpers";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * A record of each one-to-one email sent from the "One-to-one email" page: a message a person wrote to one person. Unlike a
 * campaign it has no audience, no schedule and no unsubscribe footer. The table exists so the page can show what went out
 * and so the daily limit can be counted. Only successfully sent messages are stored.
 */
export const personalEmails = pgTable(
  "personal_emails",
  {
    id: idColumn(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    /** The recipient as typed (trimmed) and normalized for comparing with the suppression list. */
    recipient: text("recipient").notNull(),
    normalizedRecipient: text("normalized_recipient").notNull(),
    subject: text("subject").notNull(),
    /** The message exactly as written: plain text. */
    body: text("body").notNull(),
    /** The user who sent it. The composite key guarantees they belong to the same tenant. */
    sentBy: text("sent_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("personal_emails_tenant_created_idx").on(t.tenantId, t.createdAt),
    foreignKey({ columns: [t.tenantId, t.sentBy], foreignColumns: [users.tenantId, users.id], name: "personal_emails_sender_fk" }),
    check("personal_emails_recipient_chk", normalizedEmailRule("normalized_recipient")),
    check("personal_emails_body_chk", sql.raw(`length(trim("body")) > 0 AND length(trim("subject")) > 0`)),
  ],
);

export type PersonalEmailRow = typeof personalEmails.$inferSelect;
