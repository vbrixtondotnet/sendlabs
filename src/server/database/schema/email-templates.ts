import { sql } from "drizzle-orm";
import { check, foreignKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, idColumn, updatedAt } from "./helpers";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * An organization's "My Templates": the message bodies its campaign editor offers. A row is either a copy of a system
 * template (the Available Templates, kept in builtin-templates.ts until a global SuperAdministrator can manage them) that
 * an Administrator added, or a template the Administrator wrote. Removing a template deletes its row.
 */
export const emailTemplates = sqliteTable(
  "email_templates",
  {
    id: idColumn(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Set for a copy of a system template: its stable key in builtin-templates.ts. Null for one an Administrator wrote. */
    builtinKey: text("builtin_key"),
    /** The message body, as HTML. Just the message: the signature, footer and postal address are added when the email is built. */
    htmlBody: text("html_body").notNull(),
    /** The Administrator who added it. Null for a built-in. The composite key guarantees they belong to the same tenant. */
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Two templates of one organization cannot share a name, ignoring letter case.
    uniqueIndex("email_templates_tenant_name_uq").on(t.tenantId, sql`lower(${t.name})`),
    uniqueIndex("email_templates_tenant_builtin_uq").on(t.tenantId, t.builtinKey).where(sql`${t.builtinKey} IS NOT NULL`),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [users.tenantId, users.id], name: "email_templates_creator_fk" }),
    check("email_templates_name_chk", sql.raw(`length(trim("name")) > 0 AND length("name") <= 100`)),
    check("email_templates_body_chk", sql.raw(`length(trim("html_body")) > 0`)),
  ],
);

export type EmailTemplateRow = typeof emailTemplates.$inferSelect;
