import { sql } from "drizzle-orm";
import { bigint, check, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, idColumn } from "./helpers";

/**
 * What Hunter.io answered for a company, kept so the same company is not searched (and paid for) twice. It describes a public company, so
 * it belongs to no account and is shared; it is only ever read to answer one lookup (never listed), and each row expires: 30 days for an
 * address, 24 hours for "none found". `cache_key` is the company name, lower-cased with single spaces.
 */
export const contactLookups = pgTable(
  "contact_lookups",
  {
    id: idColumn(),
    cacheKey: text("cache_key").notNull(),
    companyName: text("company_name").notNull(),
    /** The best address Hunter returned, or null when it found none. */
    email: text("email"),
    name: text("name").notNull().default(""),
    position: text("position").notNull().default(""),
    confidence: integer("confidence"),
    lookedUpAt: createdAt(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("contact_lookups_key_uq").on(t.cacheKey),
    check("contact_lookups_confidence_chk", sql.raw(`"confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 100)`)),
  ],
);

export type ContactLookupRow = typeof contactLookups.$inferSelect;
