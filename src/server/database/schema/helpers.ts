import { bigint, text } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { newId, nowMs } from "../../lib/id";

/** Text primary key, UUIDv7 generated in the application. */
export const idColumn = () => text("id").primaryKey().$defaultFn(newId);

/** UTC Unix milliseconds. */
export const createdAt = () => bigint("created_at", { mode: "number" }).notNull().$defaultFn(nowMs);
export const updatedAt = () =>
  bigint("updated_at", { mode: "number" }).notNull().$defaultFn(nowMs).$onUpdateFn(nowMs);

/** The column must already be trimmed and lower-cased, so the unique index really dedupes. */
export const normalizedEmailRule = (column: string): SQL =>
  sql.raw(`"${column}" <> '' AND "${column}" = lower(trim("${column}"))`);

export const nonNegativeOrNull = (column: string): SQL =>
  sql.raw(`"${column}" IS NULL OR "${column}" >= 0`);

/** `column IN ('a','b',...)` for CHECK constraints: the allowed values live in src/shared/types.ts, not in a database enum. */
export function inList(column: string, values: readonly string[]): SQL {
  const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
  return sql.raw(`"${column}" IN (${list})`);
}
