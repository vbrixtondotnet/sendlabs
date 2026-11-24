import { sql } from "drizzle-orm";
import { bigint, boolean, check, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { STARTING_CREDITS } from "../../../shared/credits";
import { USER_STATUSES } from "../../../shared/types";
import { createdAt, idColumn, inList, normalizedEmailRule, updatedAt } from "./helpers";

/**
 * An account. One account is one person and everything that person owns: their contacts, campaigns, imports, Gmail connection,
 * suppressions, test addresses and templates all carry `user_id` and are invisible to every other account. There are no
 * organizations, no teams, no roles and no invitations. The email is the username, unique across all accounts.
 */
export const users = pgTable(
  "users",
  {
    id: idColumn(),

    /** As entered (trimmed). */
    email: text("email").notNull(),
    /** trim + lower-case. This is what sign-in matches on. */
    normalizedEmail: text("normalized_email").notNull(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    /** Job title, e.g. "Sales Director". Free text, optional (empty = not set). Edited by the user. */
    position: text("position").notNull().default(""),
    /** What the UI shows. */
    displayName: text("display_name").notNull().default(""),

    /** `pbkdf2-sha256$<iterations>$<salt>$<hash>`. Never the password, never reversible. See lib/password.ts. */
    passwordHash: text("password_hash").notNull(),
    /** True for accounts created with a temporary password: the user must choose a new one at first sign-in. */
    mustChangePassword: boolean("must_change_password").notNull().default(false),

    /** Disabled accounts cannot sign in but stay in the table, so what they created keeps its owner. */
    status: text("status", { enum: USER_STATUSES }).notNull().default("Active"),
    lastLoginAt: bigint("last_login_at", { mode: "number" }),
    /** Credits left. Spent by adding a global contact from the People page (see services/people-credits.ts); never below zero. */
    credits: integer("credits").notNull().default(STARTING_CREDITS),

    /* --- the account's company details: who its emails say they are from --- */
    /** The sending company's name (printed in the email footer and signature, and `{{senderCompany}}`). Empty until set. */
    companyName: text("company_name").notNull().default(""),
    /** The postal address printed in the footer of its emails (a legal requirement for marketing email). Free text, may be several lines; empty until set. */
    postalAddress: text("postal_address").notNull().default(""),
    /** The website (a domain or URL, as entered), shown in the email signature. Empty until set. */
    website: text("website").notNull().default(""),
    /** Compliance: every campaign must contain an unsubscribe link (`{{unsubscribeUrl}}`). On by default. */
    requireUnsubscribeLink: boolean("require_unsubscribe_link").notNull().default(true),
    /** Compliance: add the one-click `List-Unsubscribe` headers to every email. On by default. */
    oneClickUnsubscribe: boolean("one_click_unsubscribe").notNull().default(true),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_normalized_email_uq").on(t.normalizedEmail),
    check("users_status_chk", inList("status", USER_STATUSES)),
    check("users_normalized_email_chk", normalizedEmailRule("normalized_email")),
    check("users_password_hash_chk", sql.raw(`"password_hash" <> ''`)),
    check("users_credits_chk", sql.raw(`"credits" >= 0`)),
  ],
);

export type UserRow = typeof users.$inferSelect;
