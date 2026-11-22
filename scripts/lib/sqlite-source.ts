import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * An in-memory SQLite database with every original (D1) migration applied: the structure the PostgreSQL schema must reproduce,
 * exactly as the live D1 database has it. Used to copy the seeded reference data into the PostgreSQL migration and to prove the
 * two structures match (scripts/compare-schemas.ts).
 */
export function openSqliteFromMigrations(dir = join(process.cwd(), "migrations-d1")): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(dir, file), "utf8").replace(/--> statement-breakpoint/g, ""));
  }
  return db;
}
