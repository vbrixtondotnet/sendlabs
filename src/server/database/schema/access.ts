import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt } from "./helpers";

/**
 * The access levels a user can hold: Administrator, Campaign Manager, Viewer.
 * This is reference data shared by every tenant, seeded by a migration with stable ids
 * (see ACCESS_LEVELS in src/shared/types.ts). It is not per tenant and has no API to change it.
 */
export const access = sqliteTable(
  "access",
  {
    /** A stable slug such as "administrator". Not generated, so seeds and code can refer to it. */
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("access_name_uq").on(t.name)],
);

export type AccessRow = typeof access.$inferSelect;
