/**
 * Creates an account in a PostgreSQL database (a new live deployment, or any extra account).
 *
 * Runs the app's own `createAccount` (the same validation and password hashing every other way of making an account uses)
 * directly against the target database, so run it AFTER `npm run db:migrate` has created the tables:
 *
 *   npx vite-node scripts/provision-production.ts -- --url "postgres://..." --email you@yourcompany.com  *     [--first-name F --last-name L] [--company "Sabertooth Software Labs"] [--website example.com] [--password "..."]
 *
 * `--url` may be left out to use DATABASE_URL from .dev.vars. A strong temporary password is generated and printed ONCE here;
 * only its hash is stored, and the account is flagged "must change password": change it from My Settings after the first
 * sign-in. Running it twice for the same address fails on the unique email, changing nothing.
 */
import { createAccount } from "../src/server/services/account";
import { arg } from "./lib/env";
import { openDb } from "./lib/db";

const email = arg("email");
const firstName = arg("first-name") ?? "";
const lastName = arg("last-name") ?? "";
const company = arg("company") ?? "";
const website = arg("website") ?? "";
const givenPassword = arg("password");
if (!email) {
  console.error('Usage: provision-production.ts [--url postgres://...] --email you@example.com [--first-name F --last-name L] [--company "Name"] [--website example.com]');
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
  await createAccount(db, { email, firstName, lastName, password, mustChangePassword: true, company: { name: company, website } });

  console.log(`
Account: ${email}`);
  if (company) console.log(`Company: ${company}`);
  if (!givenPassword) console.log(`
TEMPORARY PASSWORD (shown once, not saved anywhere): ${password}
`);
} finally {
  await close();
}
