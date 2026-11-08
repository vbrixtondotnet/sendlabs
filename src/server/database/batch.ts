import type { Database } from "./client";

/**
 * D1 limits to respect when writing many rows:
 *  - at most 100 bound parameters per SQL statement, so a bulk insert is split into statements of a few rows;
 *  - statements are sent in batches (atomic per batch, one round trip each) of a bounded size.
 * Both numbers are kept conservative on purpose.
 */
export const MAX_STATEMENT_PARAMS = 100;
export const BATCH_SIZE = 50;

/** Rows per INSERT statement for a table with `columns` bound columns, with headroom under the limit. */
export const rowsPerStatement = (columns: number): number => Math.max(1, Math.floor((MAX_STATEMENT_PARAMS - 10) / columns));

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type BatchArg = Parameters<Database["batch"]>[0];

/**
 * Runs statements in batches and returns every statement's result, in order.
 * Each batch is atomic. Across batches it is not, so callers must be safe to re-run.
 */
export async function runBatched(db: Database, statements: readonly unknown[]): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const group of chunk(statements, BATCH_SIZE)) {
    results.push(...(await db.batch(group as unknown as BatchArg)));
  }
  return results;
}

/**
 * Bulk writes send each chunk of rows as ONE bound JSON array that SQLite expands with `json_each`:
 *   INSERT INTO t (...) SELECT json_extract(value,'$[0]'), ... FROM json_each(?1) WHERE true ...
 * One statement carries hundreds of rows, so there is no 100-parameter ceiling to dodge and far
 * fewer statements to run than with one multi-row INSERT per few rows. Values are bound, never
 * concatenated into SQL.
 */
export const BULK_ROWS = 100;
/** Prepared statements per D1 batch for bulk writes. Each carries tens of KB of JSON, so keep batches modest. */
export const BULK_BATCH_STATEMENTS = 20;

export async function runBulk(db: Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  const results: D1Result[] = [];
  for (const group of chunk(statements, BULK_BATCH_STATEMENTS)) {
    results.push(...(await db.$client.batch(group)));
  }
  return results;
}
