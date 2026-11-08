import { eq } from "drizzle-orm";
import { isValidEmail, normalizeEmail } from "../../shared/email";
import type { AccessId } from "../../shared/types";
import type { Database } from "../database/client";
import { tenants, users } from "../database/schema";
import { ApiError, badRequest, constraintMessage } from "../lib/errors";
import { newId } from "../lib/id";
import { hashPassword, passwordProblem } from "../lib/password";

export interface ProvisionTenantInput {
  name: string;
  /** Derived from the name when omitted. */
  slug?: string;
  admin: {
    email: string;
    displayName?: string;
    password: string;
    /** True for a temporary password the person must replace at first sign-in. */
    mustChangePassword?: boolean;
  };
}

export interface ProvisionedTenant {
  tenantId: string;
  userId: string;
  slug: string;
}

/** `Sabertooth Software Labs` -> `sabertooth-software-labs`. Letters, digits and single hyphens only. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug || "tenant";
}

/**
 * Creates a tenant together with its first Administrator, atomically: either both exist afterwards or neither
 * does, so a tenant can never be left without anyone able to sign in. The sign-up flow will call this.
 */
export async function provisionTenant(db: Database, input: ProvisionTenantInput): Promise<ProvisionedTenant> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 200) {
    throw badRequest("Validation failed", [{ path: "name", message: "Enter a tenant name of 1 to 200 characters" }], "VALIDATION_ERROR");
  }
  const email = input.admin.email.trim();
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw badRequest("Validation failed", [{ path: "admin.email", message: "Not a valid email address" }], "VALIDATION_ERROR");
  }
  const problem = passwordProblem(input.admin.password);
  if (problem) throw badRequest("Validation failed", [{ path: "admin.password", message: problem }], "VALIDATION_ERROR");

  const slug = (input.slug ?? slugify(name)).trim();
  const tenantId = newId();
  const userId = newId();
  const passwordHash = await hashPassword(input.admin.password);

  try {
    await db.batch([
      db.insert(tenants).values({ id: tenantId, name, slug }),
      db.insert(users).values({
        id: userId,
        tenantId,
        email,
        normalizedEmail,
        displayName: input.admin.displayName?.trim() ?? "",
        passwordHash,
        mustChangePassword: input.admin.mustChangePassword ?? false,
        accessId: "administrator" satisfies AccessId,
      }),
    ]);
  } catch (err) {
    const message = constraintMessage(err);
    if (message.includes("users_normalized_email_uq") || message.includes("users.normalized_email")) {
      throw new ApiError(409, "EMAIL_EXISTS", "A user with this email address already exists");
    }
    if (message.includes("tenants_slug_uq") || message.includes("tenants.slug")) {
      throw new ApiError(409, "TENANT_EXISTS", "A tenant with this identifier already exists");
    }
    if (message.includes("tenants_name_uq")) {
      throw new ApiError(409, "TENANT_EXISTS", "A tenant with this name already exists");
    }
    throw err;
  }
  return { tenantId, userId, slug };
}

/** Looks a tenant up by slug, for idempotent seeding. */
export async function findTenantBySlug(db: Database, slug: string) {
  const [row] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return row ?? null;
}
