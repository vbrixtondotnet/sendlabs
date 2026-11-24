/**
 * Creates the three development accounts in the LOCAL database, one per role.
 *
 *   npm run db:seed:account:local
 *
 *   superadmin@sendrix.app   SuperAdmin  (Email Templates and User Accounts)
 *   jobseeker@sendrix.app    JobSeeker   (everything except Campaigns)
 *   agency@jobseeker.app     Agency      (everything except Jobs)
 *
 * All three use the password Password@123 (or SEED_PASSWORD if set). That password is a DEVELOPMENT credential and is committed on
 * purpose: this script refuses any database that is not on this machine. It goes through the same `createAccount` service every other
 * way of making an account uses, so the password is hashed (PBKDF2). Safe to run twice.
 */
import { openDb } from "./lib/db";
import { ApiError } from "../src/server/lib/errors";
import { createAccount } from "../src/server/services/account";
import type { Role } from "../src/shared/types";

const PASSWORD = process.env["SEED_PASSWORD"] ?? "Password@123";
const ACCOUNTS: { email: string; role: Role; displayName: string; company: string }[] = [
  { email: "superadmin@sendrix.app", role: "SuperAdmin", displayName: "Super Admin", company: "Sendrix" },
  { email: "jobseeker@sendrix.app", role: "JobSeeker", displayName: "Job Seeker", company: "" },
  { email: "agency@jobseeker.app", role: "Agency", displayName: "Agency", company: "Sabertooth Software Labs" },
];

// The local PostgreSQL database (DATABASE_URL in .dev.vars). Refuses anything that is not on this machine.
const { db, close } = openDb({ requireLocal: true });
try {
  for (const a of ACCOUNTS) {
    try {
      await createAccount(db, { email: a.email, displayName: a.displayName, password: PASSWORD, role: a.role, company: { name: a.company } });
      console.log(`Created ${a.role}: ${a.email}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_EXISTS") console.log(`${a.email} already exists. Nothing to do.`);
      else throw err;
    }
  }
} catch (err) {
  console.error(err instanceof ApiError ? `Could not seed: ${err.message}` : err);
  process.exitCode = 1;
} finally {
  await close();
}
