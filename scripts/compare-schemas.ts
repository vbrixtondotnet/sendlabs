/**
 * Proves the PostgreSQL structure is the same as the original SQLite (D1) one.
 *
 * Builds the original structure by running every migration in ./migrations-d1 on an in-memory SQLite database, reads the real
 * PostgreSQL structure from DATABASE_URL (or --url), and compares:
 *   tables, columns (names, NOT NULL, whether there is a default), indexes (names, unique, partial), foreign keys (columns,
 *   target, ON DELETE) and named CHECK constraints.
 * Column TYPES are compared by family and the intentional differences are listed, not hidden:
 *   SQLite integer used for a millisecond timestamp or large number -> PostgreSQL bigint   (a 32-bit integer cannot hold them)
 *   SQLite integer used as 0/1 -> PostgreSQL boolean;   SQLite text holding JSON -> PostgreSQL jsonb
 * Tables dropped by later PostgreSQL migrations (REMOVED_TABLES) are left out of the original before comparing.
 * Exit code 0 when nothing else differs, 1 otherwise.
 *
 *   npm run db:compare
 */
import postgres from "postgres";
import { arg, loadDevVars, redact } from "./lib/env";
import { openSqliteFromMigrations } from "./lib/sqlite-source";

loadDevVars();
const url = arg("url") ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No database address: set DATABASE_URL in .dev.vars, or pass --url.");
  process.exit(1);
}

type Col = { notNull: boolean; hasDefault: boolean; type: string };
type Table = {
  columns: Map<string, Col>;
  indexes: Map<string, { unique: boolean; partial: boolean }>;
  fks: Set<string>;
  checks: Set<string>;
};
const emptyTable = (): Table => ({ columns: new Map(), indexes: new Map(), fks: new Set(), checks: new Set() });

/** Features deleted since the D1 migrations were written: the PostgreSQL migrations drop these tables. */
const REMOVED_TABLES = new Set(["personal_emails"]);

/* ------------------------------ the original (SQLite) structure ------------------------------ */
function readSqlite(): Map<string, Table> {
  const db = openSqliteFromMigrations();
  const tables = new Map<string, Table>();
  const names = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all() as { name: string; sql: string }[];
  for (const { name, sql } of names) {
    if (REMOVED_TABLES.has(name)) continue;
    const t = emptyTable();
    for (const c of db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[]) {
      t.columns.set(c.name, { notNull: c.notnull === 1 || c.pk > 0, hasDefault: c.dflt_value !== null, type: c.type.toLowerCase() });
    }
    for (const i of db.prepare(`PRAGMA index_list("${name}")`).all() as { name: string; unique: number; origin: string; partial: number }[]) {
      if (i.origin === "pk") continue; // the primary key, not a separate index
      t.indexes.set(i.name, { unique: i.unique === 1, partial: i.partial === 1 });
    }
    const fkRows = db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as { id: number; seq: number; table: string; from: string; to: string; on_delete: string }[];
    const byId = new Map<number, typeof fkRows>();
    for (const r of fkRows) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
    for (const rows of byId.values()) {
      rows.sort((a, b) => a.seq - b.seq);
      t.fks.add(`${rows.map((r) => r.from).join(",")} -> ${rows[0]!.table}(${rows.map((r) => r.to).join(",")}) on delete ${rows[0]!.on_delete.toLowerCase()}`);
    }
    for (const m of sql.matchAll(/CONSTRAINT\s+[`"]([^`"]+)[`"]\s+CHECK/gi)) t.checks.add(m[1]!);
    tables.set(name, t);
  }
  return tables;
}

/* ------------------------------ the PostgreSQL structure ------------------------------ */
async function readPostgres(): Promise<Map<string, Table>> {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  try {
    const tables = new Map<string, Table>();
    const ensure = (n: string) => tables.get(n) ?? (tables.set(n, emptyTable()), tables.get(n)!);
    const cols = await sql<{ t: string; c: string; nn: boolean; d: boolean; ty: string }[]>`
      SELECT table_name AS t, column_name AS c, is_nullable = 'NO' AS nn, column_default IS NOT NULL AS d, data_type AS ty
      FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`;
    for (const r of cols) ensure(r.t).columns.set(r.c, { notNull: r.nn, hasDefault: r.d, type: r.ty });
    const idx = await sql<{ t: string; i: string; u: boolean; p: boolean }[]>`
      SELECT c.relname AS t, i.relname AS i, x.indisunique AS u, x.indpred IS NOT NULL AS p
      FROM pg_index x JOIN pg_class c ON c.oid = x.indrelid JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT x.indisprimary`;
    for (const r of idx) ensure(r.t).indexes.set(r.i, { unique: r.u, partial: r.p });
    const fks = await sql<{ t: string; cols: string; rt: string; rcols: string; del: string }[]>`
      SELECT c.conrelid::regclass::text AS t,
        (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(n, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) AS cols,
        c.confrelid::regclass::text AS rt,
        (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(n, ord) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n) AS rcols,
        CASE c.confdeltype WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null' WHEN 'd' THEN 'set default' END AS del
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.contype = 'f' AND n.nspname = 'public'`;
    for (const r of fks) ensure(r.t.replace(/^"?public"?\./, "").replace(/"/g, "")).fks.add(`${r.cols} -> ${r.rt.replace(/^"?public"?\./, "").replace(/"/g, "")}(${r.rcols}) on delete ${r.del}`);
    const chk = await sql<{ t: string; n: string }[]>`
      SELECT c.conrelid::regclass::text AS t, c.conname AS n FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace
      WHERE c.contype = 'c' AND ns.nspname = 'public'`;
    for (const r of chk) ensure(r.t.replace(/^"?public"?\./, "").replace(/"/g, "")).checks.add(r.n);
    tables.delete("__drizzle_migrations");
    return tables;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/* ------------------------------ compare ------------------------------ */
// The intentional type differences, by column, so any OTHER type change is reported.
const BIGINT = /(_at|window_start|locked_until)$|^(employees|annual_revenue)$/;
const BOOLEAN = new Set(["require_unsubscribe_link", "one_click_unsubscribe", "must_change_password", "is_deleted", "plain_text"]);
const JSONB = new Set(["recipient_industries", "personalization_snapshot", "column_mapping"]);

function expectedPgType(column: string, sqliteType: string): string {
  if (BOOLEAN.has(column)) return "boolean";
  if (JSONB.has(column)) return "jsonb";
  if (sqliteType === "integer") return BIGINT.test(column) ? "bigint" : "integer";
  if (sqliteType === "text") return "text";
  return sqliteType;
}

const problems: string[] = [];
const intentional: string[] = [];
const sqlite = readSqlite();
const pg = await readPostgres();

for (const t of [...sqlite.keys()].filter((x) => !pg.has(x))) problems.push(`table ${t}: missing in PostgreSQL`);
for (const t of [...pg.keys()].filter((x) => !sqlite.has(x))) problems.push(`table ${t}: only in PostgreSQL`);

for (const [name, a] of sqlite) {
  const b = pg.get(name);
  if (!b) continue;
  for (const [c, ca] of a.columns) {
    const cb = b.columns.get(c);
    if (!cb) { problems.push(`${name}.${c}: missing in PostgreSQL`); continue; }
    if (ca.notNull !== cb.notNull) problems.push(`${name}.${c}: NOT NULL differs (sqlite ${ca.notNull}, postgres ${cb.notNull})`);
    if (ca.hasDefault !== cb.hasDefault) problems.push(`${name}.${c}: default differs (sqlite ${ca.hasDefault}, postgres ${cb.hasDefault})`);
    const want = expectedPgType(c, ca.type);
    if (cb.type !== want) problems.push(`${name}.${c}: type ${cb.type}, expected ${want} (sqlite ${ca.type})`);
    else if (want !== ca.type && want !== "text") intentional.push(`${name}.${c}: ${ca.type} -> ${want}`);
    else if (want === "text" && ca.type !== "text") intentional.push(`${name}.${c}: ${ca.type} -> ${want}`);
  }
  for (const c of b.columns.keys()) if (!a.columns.has(c)) problems.push(`${name}.${c}: only in PostgreSQL`);
  for (const [i, ia] of a.indexes) {
    const ib = b.indexes.get(i);
    if (!ib) problems.push(`${name}: index ${i} missing in PostgreSQL`);
    else if (ia.unique !== ib.unique || ia.partial !== ib.partial) problems.push(`${name}: index ${i} differs (unique ${ia.unique}/${ib.unique}, partial ${ia.partial}/${ib.partial})`);
  }
  for (const i of b.indexes.keys()) if (!a.indexes.has(i)) problems.push(`${name}: index ${i} only in PostgreSQL`);
  for (const f of a.fks) if (!b.fks.has(f)) problems.push(`${name}: foreign key "${f}" missing in PostgreSQL`);
  for (const f of b.fks) if (!a.fks.has(f)) problems.push(`${name}: foreign key "${f}" only in PostgreSQL`);
  for (const c of a.checks) if (!b.checks.has(c)) problems.push(`${name}: check ${c} missing in PostgreSQL`);
  for (const c of b.checks) if (!a.checks.has(c)) problems.push(`${name}: check ${c} only in PostgreSQL`);
}

const count = (f: (t: Table) => number) => [...sqlite.values()].reduce((n, t) => n + f(t), 0);
console.log(`Compared the original SQLite structure with ${redact(url)}:`);
console.log(`  ${sqlite.size} tables, ${count((t) => t.columns.size)} columns, ${count((t) => t.indexes.size)} indexes, ${count((t) => t.fks.size)} foreign keys, ${count((t) => t.checks.size)} named checks in the original.`);
console.log(`\nIntentional type changes (${intentional.length}):`);
for (const line of intentional.sort()) console.log(`  ${line}`);
if (problems.length === 0) {
  console.log("\nIDENTICAL: every table, column, nullability, default, index, foreign key and check constraint matches.");
} else {
  console.log(`\nDIFFERENCES (${problems.length}):`);
  for (const p of problems) console.log(`  ${p}`);
  process.exitCode = 1;
}
