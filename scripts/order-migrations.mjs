// Reorders the statements of every generated migration so each one can run on PostgreSQL.
//
// drizzle-kit writes: CREATE TABLE ..., then ALTER TABLE ... ADD FOREIGN KEY ..., then CREATE INDEX .... PostgreSQL only accepts a
// foreign key that points at columns already covered by a unique index (every composite key here, such as (tenant_id, id)
// on users), so the indexes must exist first. This keeps the generated statements and only moves them: tables, then indexes,
// then foreign keys. It is idempotent, so it is safe to run again, and `npm run db:generate` runs it after drizzle-kit.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "migrations");
const BREAK = "--> statement-breakpoint";

const rank = (statement) => {
  const s = statement.trimStart().toUpperCase();
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/.test(s)) return 1;
  if (/^ALTER\s+TABLE\b[\s\S]*\bADD\s+CONSTRAINT\b[\s\S]*\bFOREIGN\s+KEY\b/.test(s)) return 2;
  return 0; // everything else keeps its place relative to the others of its rank
};

let changed = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  const path = join(dir, file);
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  // Statements are separated by the breakpoint marker; a statement may also end with it on the same line.
  const statements = text
    .split(BREAK)
    .map((s) => s.trim())
    .filter(Boolean);
  const ordered = statements
    .map((s, i) => ({ s, i, r: rank(s) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.s);
  const next = ordered.join(`\n${BREAK}\n`) + "\n";
  if (next !== text.replace(/\n*$/, "\n")) {
    writeFileSync(path, next, "utf8");
    changed++;
    console.log(`reordered ${file}`);
  }
}
console.log(changed === 0 ? "migrations already in a valid order" : `${changed} migration file(s) reordered`);
