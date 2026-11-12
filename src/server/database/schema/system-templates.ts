import { sql } from "drizzle-orm";
import { check, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, idColumn, updatedAt } from "./helpers";

/**
 * The Available Templates: email templates made by the system, shared by every tenant and owned by none (so no
 * `tenant_id`). Only a SuperAdministrator manages them. A tenant's Administrator can copy one into the tenant's own
 * "My Templates" (`email_templates`), and the copy is independent: later edits or deletion here do not change it.
 * The first nine are seeded by a migration from the files in "Email Templates/" (their ids are stable slugs).
 */
export const systemTemplates = sqliteTable(
  "system_templates",
  {
    id: idColumn(),
    name: text("name").notNull(),
    /** The message body, as HTML. Just the message: the signature, footer and postal address are added when the email is built. */
    htmlBody: text("html_body").notNull(),
    /** The SuperAdministrator who made it. Null for the ones seeded by the migration. */
    createdBy: text("created_by"),
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
