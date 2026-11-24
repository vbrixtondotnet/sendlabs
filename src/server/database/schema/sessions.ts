import { bigint, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, idColumn } from "./helpers";
import { users } from "./users";

/**
 * A signed-in browser. The cookie holds a random secret; only its SHA-256 hash is stored here, so reading this
 * table cannot sign anyone in. Created when someone signs in.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** SHA-256 (base64url) of the cookie's secret. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
