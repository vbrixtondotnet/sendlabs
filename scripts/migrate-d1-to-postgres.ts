/**
 * Copies the data of a Cloudflare D1 (SQLite) Sendrix database into a PostgreSQL database that already has the schema.
 * This is the data half of the cutover; `npm run db:migrate` is the structure half and must be run first.
 *
 * 1. Get the live data out of D1 (read-only, changes nothing there):
 *      npx wrangler d1 export sendrix-db-production --remote --env production --output d1-export.sql
 *    or point --source at a local D1 file (.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite).
 * 2. Create the structure in the target:      npm run db:migrate -- --url "postgresql://..."
 * 3. Rehearse (copies everything, then rolls back):
 *      npx tsx scripts/migrate-d1-to-postgres.ts --source d1-export.sql --url "postgresql://..." --dry-run
 * 4. Do it:                                   the same command without --dry-run.
 *
 * What it does: reads every table both sides have, in foreign-key order, inside ONE transaction (all or nothing), converting
 * 0/1 to true/false and JSON text to jsonb, then compares the row counts of every table with the source. The two reference
 * tables the migrations already fill (access, system_templates) are updated from the source, so edits made in production
 * survive. Any other table must be empty in the target, unless --truncate is passed to clear the data first. Nothing is
 * ever changed in D1.
 *
 * Sender (Gmail) refresh tokens are copied as they are, encrypted. The Worker that uses the new database must have the SAME
 * TOKEN_ENCRYPTION_KEY, or every organization has to reconnect Gmail. Sessions are copied, so people stay signed in.
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";
import { arg, hasFlag, loadDevVars, redact } from "./lib/env";

loadDevVars();
const source = arg("source");
const url = arg("url") ?? process.env.DATABASE_URL;
const dryRun = hasFlag("dry-run");
const truncate = hasFlag("truncate");
if (!source || !url) {
  console.error("Usage: migrate-d1-to-postgres.ts --source <d1-export.sql | d1.sqlite> [--url postgresql://...] [--dry-run] [--truncate]");
  process.exit(1);
}

/** Tables the migrations already fill with reference data: their rows are updated from the source rather than inserted. */
const REFERENCE_TABLES = new Set(["access", "system_templates"]);
const SKIP_SOURCE_TABLES = /^(sqlite_|_cf_|d1_migrations|__drizzle)/;
const CHUNK = 200;

// --- the source -----------------------------------------------------------------------------------------------------------
function openSource(path: string): DatabaseSync {
  if (/\.sql$/i.test(path)) {
    const db = new DatabaseSync(":memory:");
    // A `wrangler d1 export` dump is plain SQL (CREATE TABLE + INSERT), wrapped in a PRAGMA/transaction we do not need.
    db.exec(readFileSync(path, "utf8").replace(/PRAGMA\s+defer_foreign_keys\s*=\s*\w+;?/gi, ""));
    return db;
  }
  return new DatabaseSync(path, { readOnly: true });
}

// --- the target -----------------------------------------------------------------------------------------------------------
type Column = { name: string; type: string };

const sql = postgres(url, { max: 1, onnotice: () => {}, types: { bigint: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) } } });
const src = openSource(source);

class DryRunDone extends Error {}

try {
  const targetTables = (await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`).map((r) => r.table_name);
  const sourceTables = (src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
    .map((r) => r.name)
    .filter((n) => !SKIP_SOURCE_TABLES.test(n));

  const missingInTarget = sourceTables.filter((t) => !targetTables.includes(t));
  if (missingInTarget.length) throw new Error(`The target has no table for: ${missingInTarget.join(", ")}. Run the migrations on it first.`);
  const tables = targetTables.filter((t) => sourceTables.includes(t));

  // Parents before children, from the target's foreign keys (a self-reference is ignored).
  const fks = await sql<{ child: string; parent: string }[]>`
    SELECT cl.relname AS child, pl.relname AS parent
      FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class pl ON pl.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
     WHERE c.contype = 'f' AND n.nspname = 'public' AND cl.relname <> pl.relname`;
  const ordered: string[] = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining].filter((t) => fks.every((f) => f.child !== t || !remaining.has(f.parent)));
    if (!ready.length) throw new Error(`Foreign keys form a cycle among: ${[...remaining].join(", ")}`);
    for (const t of ready.sort()) { ordered.push(t); remaining.delete(t); }
  }

  const columnsOf = async (q: postgres.Sql, table: string): Promise<Column[]> =>
    (await q<{ name: string; type: string }[]>`
      SELECT column_name AS name, CASE WHEN data_type = 'USER-DEFINED' THEN udt_name ELSE data_type END AS type
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`);

  const primaryKey = async (q: postgres.Sql, table: string): Promise<string[]> =>
    (await q<{ attname: string }[]>`
      SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = ${`public.${table}`}::regclass AND i.indisprimary`).map((r) => r.attname);

  console.log(`Source: ${source}\nTarget: ${redact(url)}${dryRun ? "   (dry run: everything is rolled back)" : ""}\n`);

  try {
    await sql.begin(async (txn) => {
      const tx = txn as unknown as postgres.Sql; // one connection: everything inside must go through it
      if (truncate) {
        const list = ordered.filter((t) => !REFERENCE_TABLES.has(t)).map((t) => `"${t}"`).join(", ");
        if (list) await tx.unsafe(`TRUNCATE ${list} CASCADE`);
        console.log("Cleared the target's existing data (--truncate).");
      } else {
        const notEmpty: string[] = [];
        for (const t of ordered.filter((t) => !REFERENCE_TABLES.has(t))) {
          const [r] = await tx.unsafe(`SELECT count(*)::int AS n FROM "${t}"`);
          if (Number(r!.n) > 0) notEmpty.push(`${t} (${r!.n})`);
        }
        if (notEmpty.length) throw new Error(`The target already has data: ${notEmpty.join(", ")}. Use an empty database, or pass --truncate to replace it.`);
      }

      const copied = new Map<string, number>();
      for (const table of ordered) {
        const targetCols = await columnsOf(tx, table);
        const sourceCols = new Set((src.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name));
        const cols = targetCols.filter((c) => sourceCols.has(c.name));
        const lost = [...sourceCols].filter((c) => !targetCols.some((t) => t.name === c));
        if (lost.length) throw new Error(`${table}: the source has columns the target does not: ${lost.join(", ")}`);

        const rows = src.prepare(`SELECT ${cols.map((c) => `"${c.name}"`).join(", ")} FROM "${table}"`).all() as Record<string, unknown>[];
        const convert = (c: Column, v: unknown): unknown => {
          if (v === null || v === undefined) return null;
          if (c.type === "boolean") return v === true || v === 1 || v === 1n || v === "1";
          if (c.type === "jsonb" || c.type === "json") return typeof v === "string" ? v : JSON.stringify(v);
          if (typeof v === "bigint") return v.toString();
          return v;
        };
        const cast = (c: Column, i: number) => `$${i}::${c.type === "character varying" ? "text" : c.type}`;

        const pk = await primaryKey(tx, table);
        const conflict = REFERENCE_TABLES.has(table) && pk.length
          ? ` ON CONFLICT (${pk.map((p) => `"${p}"`).join(", ")}) DO UPDATE SET ${cols.filter((c) => !pk.includes(c.name)).map((c) => `"${c.name}" = EXCLUDED."${c.name}"`).join(", ")}`
          : "";

        for (let i = 0; i < rows.length; i += CHUNK) {
          const part = rows.slice(i, i + CHUNK);
          const params: unknown[] = [];
          const tuples = part.map((row) => `(${cols.map((c) => { params.push(convert(c, row[c.name])); return cast(c, params.length); }).join(", ")})`);
          await tx.unsafe(`INSERT INTO "${table}" (${cols.map((c) => `"${c.name}"`).join(", ")}) VALUES ${tuples.join(", ")}${conflict}`, params as never[]);
        }
        copied.set(table, rows.length);
        console.log(`  ${table.padEnd(28)} ${String(rows.length).padStart(8)} row(s)`);
      }

      // Verify: every table has exactly what the source had.
      const problems: string[] = [];
      for (const table of ordered) {
        const [r] = await tx.unsafe(`SELECT count(*)::int AS n FROM "${table}"`);
        const expected = (src.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number | bigint }).n;
        // A reference table may hold rows the source lacks (added by a newer migration), never fewer.
        const ok = REFERENCE_TABLES.has(table) ? Number(r!.n) >= Number(expected) : Number(r!.n) === Number(expected);
        if (!ok) problems.push(`${table}: source ${expected}, target ${r!.n}`);
      }
      if (problems.length) throw new Error(`Row counts differ after copying: ${problems.join("; ")}`);
      console.log("\nVerified: every table's row count matches the source.");

      if (dryRun) throw new DryRunDone();
    });
    console.log("Committed.");
  } catch (e) {
    if (e instanceof DryRunDone) console.log("Dry run finished: rolled back, the target is unchanged.");
    else throw e;
  }
} catch (e) {
  console.error(`\nMigration failed (nothing was changed): ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  src.close();
  await sql.end({ timeout: 5 });
}
