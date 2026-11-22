/**
 * Applies the PostgreSQL migrations in ./migrations to the database in DATABASE_URL (or --url), in order, once each.
 *
 *   npm run db:migrate                         # local development database (DATABASE_URL from .dev.vars)
 *   npm run db:migrate -- --url "postgresql://user:pass@host:5432/db"     # any other database, e.g. production
 *
 * Which migrations have run is recorded in the database itself (schema "drizzle", table "__drizzle_migrations"), so running
 * this again applies only what is new. Each migration runs in a transaction: a failure leaves the database as it was.
 */
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { arg, loadDevVars, redact } from "./lib/env";

loadDevVars();
const url = arg("url") ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No database address: set DATABASE_URL in .dev.vars, or pass --url.");
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: join(process.cwd(), "migrations") });
  const [row] = await client<{ n: string }[]>`SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`;
  console.log(`Migrations applied to ${redact(url)}. ${row?.n ?? "0"} migration(s) recorded.`);
} catch (e) {
  console.error(`Migration failed on ${redact(url)}:`, e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
