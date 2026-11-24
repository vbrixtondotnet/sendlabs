import { bigint, check, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { CONSENT_STATUSES } from "../../../shared/types";
import { users } from "./users";
import { createdAt, idColumn, inList, nonNegativeOrNull, normalizedEmailRule, updatedAt } from "./helpers";

/**
 * An account's contacts: one row per normalized email address within the account, across all of its
 * imports (decision D-06). Two accounts can each hold the same address, as separate rows, and neither
 * can see the other's. Columns follow template.csv. Suppression is a separate table (added later) so an
 * opt-out outlives any edit or re-import of the contact.
 */
export const contacts = pgTable(
  "contacts",
  {
    id: idColumn(),
    /** The account that owns this row. Every query filters by it; the composite keys below stop a row pointing at another account's data. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    /** As entered (trimmed). Kept for display and audit. */
    email: text("email").notNull(),
    /** trim + lower-case only. No Gmail-dot or plus-tag rewriting. */
    normalizedEmail: text("normalized_email").notNull(),

    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    title: text("title").notNull().default(""),
    companyName: text("company_name").notNull().default(""),
    /** Null when blank or non-numeric in the CSV. */
    employees: bigint("employees", { mode: "number" }),
    industry: text("industry").notNull().default(""),
    linkedinUrl: text("linkedin_url").notNull().default(""),
    website: text("website").notNull().default(""),
    city: text("city").notNull().default(""),
    state: text("state").notNull().default(""),
    country: text("country").notNull().default(""),
    /** Whole US dollars. A 64-bit column, so large revenues are safe. */
    annualRevenue: bigint("annual_revenue", { mode: "number" }),

    /** The CSV has no consent column, so imports start as Unknown. */
    consentStatus: text("consent_status", { enum: CONSENT_STATUSES }).notNull().default("Unknown"),
    consentSource: text("consent_source"),

    /** The import that created this contact. A soft reference (see imports.ts): the API checks the account. */
    sourceImportId: text("source_import_id"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The account-scoped "one row per email": the same address may exist once per account.
    uniqueIndex("contacts_user_email_uq").on(t.userId, t.normalizedEmail),
    // Lets recipients and import rows reference "a contact of the SAME account" with a composite foreign key.
    uniqueIndex("contacts_user_id_uq").on(t.userId, t.id),
    index("contacts_user_industry_idx").on(t.userId, t.industry),
    index("contacts_user_source_import_idx").on(t.userId, t.sourceImportId),
    index("contacts_user_created_at_idx").on(t.userId, t.createdAt),
    check("contacts_consent_chk", inList("consent_status", CONSENT_STATUSES)),
    check("contacts_normalized_email_chk", normalizedEmailRule("normalized_email")),
    check("contacts_employees_chk", nonNegativeOrNull("employees")),
    check("contacts_revenue_chk", nonNegativeOrNull("annual_revenue")),
  ],
);

export type ContactRow = typeof contacts.$inferSelect;
export type NewContactRow = typeof contacts.$inferInsert;
