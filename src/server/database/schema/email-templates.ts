import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, idColumn, updatedAt } from "./helpers";
import { users } from "./users";

/**
 * An account's "My Templates": the message bodies its campaign editor offers. A row is either a copy of a starter template
 * (the Available Templates, `system_templates`) that the account added, or a template it wrote. Removing a template deletes its row.
 */
export const emailTemplates = pgTable(
  "email_templates",
  {
    id: idColumn(),
    /** The account that owns this row. Every query filters by it; the composite keys below stop a row pointing at another account's data. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Set for a copy of a system template: its stable key in builtin-templates.ts. Null for one the account wrote. */
    builtinKey: text("builtin_key"),
    /** The message body, as HTML. Just the message: the signature, footer and postal address are added when the email is built. */
    htmlBody: text("html_body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Two templates of one account cannot share a name, ignoring letter case.
    uniqueIndex("email_templates_user_name_uq").on(t.userId, sql`lower(${t.name})`),
    uniqueIndex("email_templates_user_builtin_uq").on(t.userId, t.builtinKey).where(sql`${t.builtinKey} IS NOT NULL`),
    check("email_templates_name_chk", sql.raw(`length(trim("name")) > 0 AND length("name") <= 100`)),
    check("email_templates_body_chk", sql.raw(`length(trim("html_body")) > 0`)),
  ],
);

export type EmailTemplateRow = typeof emailTemplates.$inferSelect;
