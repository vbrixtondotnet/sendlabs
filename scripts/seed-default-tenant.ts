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
 * "must change password" and this script only ever talks to the simulated local database.
 * It never touches a Cloudflare database. Real tenants are created by sign-up, with their own passwords.
 *
 * It goes through the same `provisionTenant` service sign-up will use, so the password is hashed
 * (PBKDF2) and the tenant and its admin are created together or not at all. Safe to run twice.
 */
import { getPlatformProxy } from "wrangler";
import { createDb } from "../src/server/database/client";
import { ApiError } from "../src/server/lib/errors";
import { findTenantBySlug, provisionTenant, slugify } from "../src/server/services/tenants";

const TENANT_NAME = "Sabertooth Software Labs";
const ADMIN_EMAIL = "admin@sabertoothsoftwarelabs.net";
const ADMIN_PASSWORD = process.env["SEED_ADMIN_PASSWORD"] ?? "Password@123";

// Opens the same simulated D1 that `wrangler dev` and `wrangler d1 ... --local` use (.wrangler/state).
const proxy = await getPlatformProxy<Env>();
try {
  if (proxy.env.ENVIRONMENT !== "local") {
    console.error(`Refusing to seed: ENVIRONMENT is "${proxy.env.ENVIRONMENT}", not "local".`);
    process.exit(1);
  }
  const db = createDb(proxy.env.DB);

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
  await proxy.dispose();
}
