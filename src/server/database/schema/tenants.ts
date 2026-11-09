import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { TENANT_STATUSES } from "../../../shared/types";
import { createdAt, idColumn, inList, updatedAt } from "./helpers";

/**
 * A tenant is one customer organization. The database is shared by all tenants (one schema, one
 * database), so isolation rests on every tenant-owned row carrying a `tenant_id`, on every query filtering
 * by it, and on composite foreign keys that stop a row pointing at another tenant's data.
 */
export const tenants = sqliteTable(
  "tenants",
  {
    id: idColumn(),
    name: text("name").notNull(),
    /** URL-safe identifier: lower-case letters, digits and hyphens. Reserved for sign-in and subdomains. */
    slug: text("slug").notNull(),
    /** The organization's postal address, printed in the footer of its emails (a legal requirement for marketing email). Free text, may be several lines; empty until set. */
    postalAddress: text("postal_address").notNull().default(""),
    /** The organization's website (a domain or URL, as entered), shown in the email signature. Empty until set. */
    website: text("website").notNull().default(""),
    /** Compliance: every campaign must contain an unsubscribe link (`{{unsubscribeUrl}}`). On by default. */
    requireUnsubscribeLink: integer("require_unsubscribe_link", { mode: "boolean" }).notNull().default(true),
    /** Compliance: add the one-click `List-Unsubscribe` headers to every email. On by default. */
    oneClickUnsubscribe: integer("one_click_unsubscribe", { mode: "boolean" }).notNull().default(true),
    status: text("status", { enum: TENANT_STATUSES }).notNull().default("Active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("tenants_slug_uq").on(t.slug),
    // Two tenants cannot share a name, ignoring letter case.
    uniqueIndex("tenants_name_uq").on(sql`lower(${t.name})`),
    check("tenants_status_chk", inList("status", TENANT_STATUSES)),
    check("tenants_name_chk", sql.raw(`length(trim("name")) > 0`)),
    check("tenants_slug_chk", sql.raw(`"slug" <> '' AND "slug" NOT GLOB '*[^a-z0-9-]*'`)),
  ],
);

export type TenantRow = typeof tenants.$inferSelect;
