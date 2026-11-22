/**
 * Creates the FIRST organization and its Administrator in an empty PostgreSQL database (a new live deployment).
 *
 * Runs the app's own `provisionTenant` (the same validation, password hashing and tenant-plus-admin creation the sign-up flow
 * uses) directly against the target database, so run it AFTER `npm run db:migrate` has created the tables:
 *
 *   npx vite-node scripts/provision-production.ts -- --url "postgres://..." --name "Sabertooth Software Labs" --email you@yourcompany.com \
 *     [--display-name "Your Name"] [--first-name F --last-name L] [--website example.com] [--password "..."]
 *
 * `--url` may be left out to use DATABASE_URL from .dev.vars. A strong temporary password is generated and printed ONCE here;
 * only its hash is stored, and the account is flagged "must change password": change it from My Settings after the first
 * sign-in. Running it twice for the same address fails on the unique email, changing nothing.
 */
import { sql } from "drizzle-orm";
import { provisionTenant } from "../src/server/services/tenants";
import { arg } from "./lib/env";
import { openDb } from "./lib/db";

const name = arg("name");
const email = arg("email");
const firstName = arg("first-name") ?? "";
const lastName = arg("last-name") ?? "";
const displayName = arg("display-name") ?? [firstName, lastName].filter(Boolean).join(" ");
const website = arg("website") ?? "";
const givenPassword = arg("password");
if (!name || !email) {
  console.error('Usage: provision-production.ts [--url postgres://...] --name "Organization" --email admin@example.com [--display-name "Name"]');
  process.exit(1);
}

/** 20 random characters with upper, lower, digit and symbol, so it passes the password rules. */
function temporaryPassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%*-_=+"];
  const all = sets.join("");
  const pick = (chars: string) => chars[crypto.getRandomValues(new Uint32Array(1))[0]! % chars.length]!;
  const chars = [...sets.map(pick), ...Array.from({ length: 16 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

const { db, close } = openDb();
try {
  const password = givenPassword ?? temporaryPassword();
  const { tenantId, userId } = await provisionTenant(db, { name, admin: { email, displayName, password, mustChangePassword: true } });
  if (website) await db.execute(sql`UPDATE tenants SET website = ${website} WHERE id = ${tenantId}`);
  if (firstName || lastName) await db.execute(sql`UPDATE users SET first_name = ${firstName}, last_name = ${lastName} WHERE id = ${userId}`);

  console.log(`\nOrganization: ${name}`);
  console.log(`Administrator: ${email}`);
  if (!givenPassword) console.log(`\nTEMPORARY PASSWORD (shown once, not saved anywhere): ${password}\n`);
} finally {
  await close();
}
