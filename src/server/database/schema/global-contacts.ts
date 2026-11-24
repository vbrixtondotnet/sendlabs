import { bigint, check, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, idColumn, nonNegativeOrNull, updatedAt } from "./helpers";

/**
 * The platform's shared directory of people (what the Search People page will read once Apollo data is stored). It belongs to
 * NO account: unlike `contacts`, there is no user_id, and everyone searches the same rows. An account's own
 * `contacts` are a separate table, so adding someone here never changes anyone's contact list.
 *
 * The columns are the ones asked for (FirstName, LastName, Title, Company, Email, EmployeeCount, Industry, Website, City, State,
 * Country), named in snake_case like the rest of the schema.
 */
export const globalContacts = pgTable(
  "global_contacts",
  {
    id: idColumn(),

    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    title: text("title").notNull().default(""),
    company: text("company").notNull().default(""),
    /** As received (trimmed). Duplicates are caught case-insensitively by `global_contacts_email_uq`. */
    email: text("email").notNull().default(""),
    /** Null when unknown. */
    employeeCount: bigint("employee_count", { mode: "number" }),
    industry: text("industry").notNull().default(""),
    website: text("website").notNull().default(""),
    city: text("city").notNull().default(""),
    state: text("state").notNull().default(""),
    country: text("country").notNull().default(""),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One row per address, ignoring case and surrounding spaces. Rows without an email are allowed (and not compared).
    uniqueIndex("global_contacts_email_uq").on(sql`lower(trim(${t.email}))`).where(sql`${t.email} <> ''`),
    // The People search filters.
    index("global_contacts_country_idx").on(t.country),
    index("global_contacts_industry_idx").on(t.industry),
    index("global_contacts_employee_count_idx").on(t.employeeCount),
    check("global_contacts_employee_count_chk", nonNegativeOrNull("employee_count")),
  ],
);

export type GlobalContactRow = typeof globalContacts.$inferSelect;
export type NewGlobalContactRow = typeof globalContacts.$inferInsert;
