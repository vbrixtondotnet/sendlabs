import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, idColumn, updatedAt } from "./helpers";

/**
 * The Available Templates: starter email templates made by the system, shared by every account and owned by none (so no
 * `user_id`), and READ-ONLY: nothing in the app creates, edits or deletes them (they change only by a migration). An account
 * can copy one into its own "My Templates" (`email_templates`), and the copy is independent.
 * The first nine are seeded by a migration from the files in "Email Templates/" (their ids are stable slugs).
 */
export const systemTemplates = pgTable(
  "system_templates",
  {
    id: idColumn(),
    name: text("name").notNull(),
    /** The message body, as HTML. Just the message: the signature, footer and postal address are added when the email is built. */
    htmlBody: text("html_body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("system_templates_name_uq").on(sql`lower(${t.name})`),
    check("system_templates_name_chk", sql.raw(`length(trim("name")) > 0 AND length("name") <= 100`)),
    check("system_templates_body_chk", sql.raw(`length(trim("html_body")) > 0`)),
  ],
);

export type SystemTemplateRow = typeof systemTemplates.$inferSelect;
