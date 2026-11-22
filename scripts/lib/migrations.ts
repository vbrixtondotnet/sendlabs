import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type postgres from "postgres";

/** The migration files in order, each as its list of single statements (split on drizzle's statement breakpoint). */
export function migrationFiles(dir = join(process.cwd(), "migrations")): { name: string; statements: string[] }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      statements: readFileSync(join(dir, name), "utf8")
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean),
    }));
}

/**
 * Runs every migration on a database, each file in its own transaction. Used by the tests to build their template database;
 * the real tool for a development or production database is `scripts/db-migrate.ts` (Drizzle's migrator, which also records
 * what has run).
 */
export async function applyAllMigrations(sql: postgres.Sql, only?: (name: string) => boolean): Promise<void> {
  for (const file of migrationFiles()) {
    if (only && !only(file.name)) continue;
    await sql.begin(async (tx) => {
      for (const statement of file.statements) await tx.unsafe(statement);
    });
  }
}

/** The same connection string pointed at another database name on the same server. */
export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}
