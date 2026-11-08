import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { CONSENT_STATUSES } from "../../../shared/types";
import { createdAt, idColumn, inList, nonNegativeOrNull, normalizedEmailRule, updatedAt } from "./helpers";

/**
 * Global contacts: one row per normalized email address across all imports (decision D-06).
 * Columns follow template.csv. Suppression is a separate table (added later) so an opt-out
 * outlives any edit or re-import of the contact.
 */
export const contacts = sqliteTable(
  "contacts",
  {
    id: idColumn(),

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

    /** Becomes a foreign key to `imports.id` when the imports table is added. */
    sourceImportId: text("source_import_id"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("contacts_normalized_email_uq").on(t.normalizedEmail),
    index("contacts_industry_idx").on(t.industry),
    index("contacts_source_import_idx").on(t.sourceImportId),
    index("contacts_created_at_idx").on(t.createdAt),
    check("contacts_consent_chk", inList("consent_status", CONSENT_STATUSES)),
    check("contacts_normalized_email_chk", normalizedEmailRule("normalized_email")),
    check("contacts_employees_chk", nonNegativeOrNull("employees")),
    check("contacts_revenue_chk", nonNegativeOrNull("annual_revenue")),
  ],
);

export type ContactRow = typeof contacts.$inferSelect;
export type NewContactRow = typeof contacts.$inferInsert;
