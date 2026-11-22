/**
 * Writes the SQL that seeds the reference data into PostgreSQL: the access levels and the starter (system) templates.
 *
 * The values are not retyped: they are read from a SQLite database built by running every original migration (migrations-d1),
 * so they are exactly what the live D1 database holds after those migrations. The output goes to the file named by --out
 * (the PostgreSQL migration `migrations/0001_seed_reference_data.sql`). It is already generated and committed; this script
 * is kept so the provenance of that file can be checked and repeated.
 *
 *   npx vite-node scripts/generate-reference-seed.ts -- --out migrations/0001_seed_reference_data.sql
 */
import { writeFileSync } from "node:fs";
import { arg } from "./lib/env";
import { openSqliteFromMigrations } from "./lib/sqlite-source";

const out = arg("out");
if (!out) {
  console.error("Usage: generate-reference-seed.ts --out <file.sql>");
  process.exit(1);
}

const literal = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};

const db = openSqliteFromMigrations();
const lines: string[] = ["-- Reference data, copied exactly from the original (D1) migrations by scripts/generate-reference-seed.ts."];

for (const [table, orderBy] of [["access", "sort_order, id"], ["system_templates", "name"]] as const) {
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all() as Record<string, unknown>[];
  for (const row of rows) {
    const cols = Object.keys(row);
    lines.push(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((c) => literal(row[c])).join(", ")});`);
  }
  console.log(`${table}: ${rows.length} row(s)`);
}

writeFileSync(out, lines.join("\n--> statement-breakpoint\n").replace(/\n--> statement-breakpoint\n(?=-- )/, "\n") + "\n", "utf8");
console.log(`Wrote ${out}`);
