import { sql } from "drizzle-orm";
import { check, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
