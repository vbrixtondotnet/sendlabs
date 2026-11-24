/**
 * Creates the default account in the LOCAL database.
 *
 *   npm run db:seed:account:local
 *
 *   Login   : admin@sabertoothsoftwarelabs.net
 *   Company : Sabertooth Software Labs
 *   Password: Password@123, or whatever SEED_ADMIN_PASSWORD is set to
 *
 * That password is a DEVELOPMENT credential and is committed on purpose: the account is flagged "must change password" and this
 * script refuses any database that is not on this machine. It goes through the same `createAccount` service every other way of
 * making an account uses, so the password is hashed (PBKDF2). Safe to run twice.
 */
import { openDb } from "./lib/db";
import { ApiError } from "../src/server/lib/errors";
import { createAccount } from "../src/server/services/account";

const EMAIL = "admin@sabertoothsoftwarelabs.net";
const PASSWORD = process.env["SEED_ADMIN_PASSWORD"] ?? "Password@123";

// The local PostgreSQL database (DATABASE_URL in .dev.vars). Refuses anything that is not on this machine.
const { db, close } = openDb({ requireLocal: true });
try {
  await createAccount(db, { email: EMAIL, displayName: "Administrator", password: PASSWORD, mustChangePassword: true, company: { name: "Sabertooth Software Labs" } });
  console.log(`Created the account ${EMAIL}.`);
  console.log("It is flagged must-change-password. This is a development credential.");
} catch (err) {
  if (err instanceof ApiError && err.code === "EMAIL_EXISTS") console.log(`The account ${EMAIL} already exists. Nothing to do.`);
  else {
    console.error(err instanceof ApiError ? `Could not seed: ${err.message}` : err);
    process.exitCode = 1;
  }
} finally {
  await close();
}
