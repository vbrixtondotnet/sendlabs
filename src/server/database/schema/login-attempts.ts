import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Failed sign-in counters, the memory behind throttling. One row per KEY: `email:<normalized address>` or
 * `ip:<address>`. Keyed by what was typed, whether or not such a user exists, so throttling reveals nothing about
 * which addresses have accounts. A row holds no password and nothing secret.
 */
export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    key: text("key").primaryKey(),
    failures: integer("failures").notNull().default(0),
    /** When the current counting window began (Unix ms). */
    windowStart: integer("window_start").notNull(),
    /** Sign-in is refused until this moment (Unix ms), or null when not locked. */
    lockedUntil: integer("locked_until"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("login_attempts_updated_idx").on(t.updatedAt)],
);
