/**
 * Deletes ALL tenant data from the LOCAL database: every tenant, user, session, contact, campaign, import, template copy and
 * the rest. Kept: the tables, the migration history, and the reference data seeded by migrations (the access levels and the
 * starter system templates).
 *
 *   npm run db:clear:local        (afterwards: npm run db:seed:tenant:local recreates the default tenant)
 *   npm run db:reset:local        (clear, then seed the default tenant and the SuperAdministrator)
 *
 * Refuses any database that is not on this machine.
 */
import { sql } from "drizzle-orm";
import { openDb } from "./lib/db";

const { db, url, close } = openDb({ requireLocal: true });
try {
  // Every tenant-owned table points at `tenants`, so truncating it with CASCADE clears them all in one go; the sign-in
  // throttling counters belong to no tenant and are cleared explicitly.
  await db.execute(sql`TRUNCATE TABLE tenants, login_attempts CASCADE`);
  console.log(`Cleared all tenant data from ${url.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:****@")}.`);
} finally {
  await close();
}
