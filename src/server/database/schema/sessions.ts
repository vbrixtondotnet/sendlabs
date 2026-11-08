import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, idColumn } from "./helpers";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * A signed-in browser. The cookie holds a random secret; only its SHA-256 hash is stored here, so reading this
 * table cannot sign anyone in. Created when someone accepts an invitation. (There is no login page yet.)
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: idColumn(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    /** SHA-256 (base64url) of the cookie's secret. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: "sessions_user_fk" }),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
