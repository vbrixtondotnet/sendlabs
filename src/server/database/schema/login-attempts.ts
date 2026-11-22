import { bigint, index, integer, pgTable, text } from "drizzle-orm/pg-core";

/**
 * Failed sign-in counters, the memory behind throttling. One row per KEY: `email:<normalized address>` or
 * `ip:<address>`. Keyed by what was typed, whether or not such a user exists, so throttling reveals nothing about
 * which addresses have accounts. A row holds no password and nothing secret.
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    key: text("key").primaryKey(),
    failures: integer("failures").notNull().default(0),
    /** When the current counting window began (Unix ms). */
    windowStart: bigint("window_start", { mode: "number" }).notNull(),
    /** Sign-in is refused until this moment (Unix ms), or null when not locked. */
    lockedUntil: bigint("locked_until", { mode: "number" }),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("login_attempts_updated_idx").on(t.updatedAt)],
);
