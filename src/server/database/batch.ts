/**
 * Bulk writes. PostgreSQL takes at most 65,535 bound parameters in one statement, so a bulk insert is split into statements
 * of a few hundred rows: far fewer round trips than one row at a time, and far below the limit even for the widest table
 * (about 20 columns x 500 rows = 10,000 parameters).
 */
export const BULK_ROWS = 500;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Rows per `inArray(...)` lookup, so a long list of addresses stays well inside the parameter limit. */
export const LOOKUP_CHUNK = 1000;
