import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { USER_STATUSES } from "../../../shared/types";
import { access } from "./access";
import { createdAt, idColumn, inList, normalizedEmailRule, updatedAt } from "./helpers";
import { tenants } from "./tenants";

/**
 * A login. Every user belongs to exactly one tenant, and the email is the username.
 * The email is unique across ALL tenants so that signing in needs no tenant picker. The cost is that
 * one person cannot hold logins in two tenants with the same address.
 */
export const users = sqliteTable(
  "users",
  {
    id: idColumn(),
    /** RESTRICT: a tenant that still has users cannot be deleted by accident. */
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    /** As entered (trimmed). */
    email: text("email").notNull(),
    /** trim + lower-case. This is what sign-in matches on. */
    normalizedEmail: text("normalized_email").notNull(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    /** What the UI shows. Kept as "first last" for people created by invitation. */
    displayName: text("display_name").notNull().default(""),

    /** `pbkdf2-sha256$<iterations>$<salt>$<hash>`. Never the password, never reversible. See lib/password.ts. */
    passwordHash: text("password_hash").notNull(),
    /** True for accounts created with a temporary password: the user must choose a new one at first sign-in. */
    mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),

    accessId: text("access_id")
      .notNull()
      .references(() => access.id, { onDelete: "restrict" }),
    /** Disabled users cannot sign in but stay in the table, so what they created keeps its owner. */
    status: text("status", { enum: USER_STATUSES }).notNull().default("Active"),
    lastLoginAt: integer("last_login_at"),
    /**
     * Soft delete. A removed user keeps their row (and so what they created keeps its owner and the email stays
     * reserved), but cannot sign in and is not listed. Accepting a new invitation clears it again.
     */
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    deletedAt: integer("deleted_at"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_normalized_email_uq").on(t.normalizedEmail),
    // Lets other tenant-owned tables point at "a user of the SAME tenant" with a composite foreign key.
    uniqueIndex("users_tenant_id_uq").on(t.tenantId, t.id),
    index("users_access_idx").on(t.accessId),
    check("users_status_chk", inList("status", USER_STATUSES)),
    check("users_normalized_email_chk", normalizedEmailRule("normalized_email")),
    check("users_password_hash_chk", sql.raw(`"password_hash" <> ''`)),
  ],
);

export type UserRow = typeof users.$inferSelect;
