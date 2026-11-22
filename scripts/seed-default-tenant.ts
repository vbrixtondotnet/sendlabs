/**
 * Creates the default tenant and its first Administrator in the LOCAL database.
 *
 *   npm run db:seed:tenant:local
 *
 *   Tenant : Sabertooth Software Labs
 *   Login  : admin@sabertoothsoftwarelabs.net  (Administrator)
 *   Password: Password@123, or whatever SEED_ADMIN_PASSWORD is set to
 *
 * That password is a DEVELOPMENT credential and is committed on purpose: the account is flagged
 * "must change password" and this script refuses any database that is not on this machine.
 * It refuses any database that is not on this machine. Real tenants are created by sign-up, with their own passwords.
 *
 * It goes through the same `provisionTenant` service sign-up will use, so the password is hashed
 * (PBKDF2) and the tenant and its admin are created together or not at all. Safe to run twice.
 */
import { openDb } from "./lib/db";
import { ApiError } from "../src/server/lib/errors";
import { findTenantBySlug, provisionTenant, slugify } from "../src/server/services/tenants";

const TENANT_NAME = "Sabertooth Software Labs";
const ADMIN_EMAIL = "admin@sabertoothsoftwarelabs.net";
const ADMIN_PASSWORD = process.env["SEED_ADMIN_PASSWORD"] ?? "Password@123";

// The local PostgreSQL database (DATABASE_URL in .dev.vars). Refuses anything that is not on this machine.
const { db, close } = openDb({ requireLocal: true });
try {

  const existing = await findTenantBySlug(db, slugify(TENANT_NAME));
  if (existing) {
    console.log(`Tenant "${existing.name}" already exists (${existing.id}). Nothing to do.`);
  } else {
    const created = await provisionTenant(db, {
      name: TENANT_NAME,
      admin: { email: ADMIN_EMAIL, displayName: "Administrator", password: ADMIN_PASSWORD, mustChangePassword: true },
    });
    console.log(`Created tenant "${TENANT_NAME}" (${created.tenantId}) with Administrator ${ADMIN_EMAIL}.`);
    console.log("The account is flagged must-change-password. This is a development credential.");
  }
} catch (err) {
  console.error(err instanceof ApiError ? `Could not seed: ${err.message}` : err);
  process.exitCode = 1;
} finally {
  await close();
}
