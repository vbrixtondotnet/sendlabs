/**
 * Creates the platform's SuperAdministrator in the LOCAL database.
 *
 *   npm run db:seed:superadmin:local
 *
 *   Login   : superadmin@sabertoothsoftwarelabs.net  (SuperAdministrator)
 *   Name    : Super Administrator
 *   Password: Password@123, or whatever SEED_SUPERADMIN_PASSWORD is set to
 *
 * A SuperAdministrator is a global user of the platform, not one of any customer's staff. Every login row must belong
 * to a tenant (making `users.tenant_id` optional would mean rebuilding the table everything references, which cannot be
 * done safely on a live database), so the account is kept in a reserved platform tenant, "Sendrix Platform". That tenant
 * owns no contacts, campaigns or templates, and nothing treats the SuperAdministrator as its member: the role, not the
 * tenant, is what matters.
 *
 * That password is a DEVELOPMENT credential and is committed on purpose; this script only ever talks to the simulated
 * local database and refuses to run anywhere else. Never seed this account into staging or production. Safe to run twice.
 */
import { eq } from "drizzle-orm";
import { getPlatformProxy } from "wrangler";
import { SUPER_ADMINISTRATOR } from "../src/shared/types";
import { createDb } from "../src/server/database/client";
import { tenants, users } from "../src/server/database/schema";
import { ApiError } from "../src/server/lib/errors";
import { newId } from "../src/server/lib/id";
import { hashPassword, passwordProblem } from "../src/server/lib/password";
import { findTenantBySlug } from "../src/server/services/tenants";

const PLATFORM_TENANT_NAME = "Sendrix Platform";
const PLATFORM_TENANT_SLUG = "sendrix-platform";
const EMAIL = "superadmin@sabertoothsoftwarelabs.net";
const FIRST_NAME = "Super";
const LAST_NAME = "Administrator";
const PASSWORD = process.env["SEED_SUPERADMIN_PASSWORD"] ?? "Password@123";

const proxy = await getPlatformProxy<Env>();
try {
  if (proxy.env.ENVIRONMENT !== "local") {
    console.error(`Refusing to seed: ENVIRONMENT is "${proxy.env.ENVIRONMENT}", not "local".`);
    process.exit(1);
  }
  const db = createDb(proxy.env.DB);
  const problem = passwordProblem(PASSWORD);
  if (problem) throw new ApiError(400, "VALIDATION_ERROR", `The password is not allowed: ${problem}`);

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.normalizedEmail, EMAIL)).limit(1);
  if (existing) {
    console.log(`${EMAIL} already exists (${existing.id}). Nothing to do.`);
  } else {
    const platform = await findTenantBySlug(db, PLATFORM_TENANT_SLUG);
    const tenantId = platform?.id ?? newId();
    const userId = newId();
    const passwordHash = await hashPassword(PASSWORD);
    // The platform tenant is created once; running this again after a failed attempt just reuses it.
    if (!platform) await db.insert(tenants).values({ id: tenantId, name: PLATFORM_TENANT_NAME, slug: PLATFORM_TENANT_SLUG });
    await db.insert(users).values({
      id: userId,
      tenantId,
      email: EMAIL,
      normalizedEmail: EMAIL,
      firstName: FIRST_NAME,
      lastName: LAST_NAME,
      displayName: `${FIRST_NAME} ${LAST_NAME}`,
      passwordHash,
      mustChangePassword: true,
      accessId: SUPER_ADMINISTRATOR.id,
    });
    console.log(`Created ${SUPER_ADMINISTRATOR.name} ${EMAIL} (${userId}) in the platform tenant "${PLATFORM_TENANT_NAME}".`);
    console.log("The account is flagged must-change-password. This is a development credential.");
  }
} catch (err) {
  console.error(err instanceof ApiError ? `Could not seed: ${err.message}` : err);
  process.exitCode = 1;
} finally {
  await proxy.dispose();
}
