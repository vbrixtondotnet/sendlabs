import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { CONSENT_STATUSES } from "../../../shared/types";
import { createdAt, idColumn, inList, nonNegativeOrNull, normalizedEmailRule, updatedAt } from "./helpers";
import { tenants } from "./tenants";

/**
 * A tenant's contacts: one row per normalized email address within the tenant, across all of its
 * imports (decision D-06). Two tenants can each hold the same address, as separate rows, and neither
 * can see the other's. Columns follow template.csv. Suppression is a separate table (added later) so an
 * opt-out outlives any edit or re-import of the contact.
 */
export const contacts = sqliteTable(
  "contacts",
  {
    id: idColumn(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    /** As entered (trimmed). Kept for display and audit. */
    email: text("email").notNull(),
    /** trim + lower-case only. No Gmail-dot or plus-tag rewriting. */
    normalizedEmail: text("normalized_email").notNull(),

    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    title: text("title").notNull().default(""),
    companyName: text("company_name").notNull().default(""),
    /** Null when blank or non-numeric in the CSV. */
    employees: integer("employees"),
    industry: text("industry").notNull().default(""),
    linkedinUrl: text("linkedin_url").notNull().default(""),
    website: text("website").notNull().default(""),
    city: text("city").notNull().default(""),
    state: text("state").notNull().default(""),
    country: text("country").notNull().default(""),
    /** Whole US dollars. SQLite integers are 64-bit, so large revenues are safe. */
    annualRevenue: integer("annual_revenue"),

    /** The CSV has no consent column, so imports start as Unknown. */
    consentStatus: text("consent_status", { enum: CONSENT_STATUSES }).notNull().default("Unknown"),
    consentSource: text("consent_source"),

    /** The import that created this contact. A soft reference (see imports.ts): the API checks the tenant. */
    sourceImportId: text("source_import_id"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The tenant-scoped replacement for "one row per email": the same address may exist once per tenant.
    uniqueIndex("contacts_tenant_email_uq").on(t.tenantId, t.normalizedEmail),
    // Lets recipients and import rows reference "a contact of the SAME tenant" with a composite foreign key.
    uniqueIndex("contacts_tenant_id_uq").on(t.tenantId, t.id),
    index("contacts_tenant_industry_idx").on(t.tenantId, t.industry),
    index("contacts_tenant_source_import_idx").on(t.tenantId, t.sourceImportId),
    index("contacts_tenant_created_at_idx").on(t.tenantId, t.createdAt),
    check("contacts_consent_chk", inList("consent_status", CONSENT_STATUSES)),
    check("contacts_normalized_email_chk", normalizedEmailRule("normalized_email")),
    check("contacts_employees_chk", nonNegativeOrNull("employees")),
    check("contacts_revenue_chk", nonNegativeOrNull("annual_revenue")),
  ],
);

export type ContactRow = typeof contacts.$inferSelect;
export type NewContactRow = typeof contacts.$inferInsert;
