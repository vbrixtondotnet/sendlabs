/**
 * Deletes ALL account data from the LOCAL database: every account, session, contact, campaign, import, template copy and the
 * rest. Kept: the tables, the migration history, the starter (system) templates and the shared global contacts.
 *
 *   npm run db:clear:local        (afterwards: npm run db:seed:account:local recreates the three development accounts)
 *   npm run db:reset:local        (clear, then seed the development accounts)
 *
 * Refuses any database that is not on this machine.
 */
import { sql } from "drizzle-orm";
import { openDb } from "./lib/db";

const { db, url, close } = openDb({ requireLocal: true });
try {
  // Every account-owned table points at `users`, so truncating it with CASCADE clears them all in one go; the sign-in
  // throttling counters belong to no account and are cleared explicitly.
  await db.execute(sql`TRUNCATE TABLE users, login_attempts CASCADE`);
  console.log(`Cleared all account data from ${url.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:****@")}.`);
} finally {
  await close();
}
