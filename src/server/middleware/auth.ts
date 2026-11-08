import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { normalizeEmail } from "../../shared/email";
import type { Role } from "../../shared/types";
import type { AppEnv } from "../app";
import { access, tenants, users } from "../database/schema";
import { sessionsRepo } from "../database/repositories/sessions";
import { sha256Base64Url } from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { readSessionCookie } from "../lib/session";

/** Who is making the request, and which tenant they belong to. Every repository is scoped by `tenantId`. */
export interface Actor {
  userId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  email: string;
  displayName: string;
  access: Role;
  mustChangePassword: boolean;
  /** True when this request carries a real session, false for the local development placeholder. */
  viaSession: boolean;
}

/**
 * Allows the request only if the signed-in user holds one of `allowed`. Must run after `requireActor`.
 * Answers 403 (not 404): the caller is known, they just are not permitted. First used for user management;
 * the rest of the API does not check access levels yet.
 */
export const requireAccess = (...allowed: Role[]): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (!allowed.includes(c.get("actor").access)) {
    throw new ApiError(403, "FORBIDDEN", "Your access level does not allow this");
  }
  await next();
};

/**
 * Decides who is making the request.
 *
 *  1. A valid session cookie wins. Sessions are created by the login page and by accepting an invitation.
 *  2. Otherwise, locally only, and only if DEV_ACTOR_EMAIL is set in `.dev.vars`, the request runs as that user. This
 *     is an opt-in shortcut for trying the API without signing in; by default it is off, so there is no way in
 *     except signing in.
 *
 * It fails closed: outside the local environment every protected route answers 503, session or not, so deploying
 * this build cannot expose anyone's data until that is deliberately enabled. The tenant always comes from the user's
 * database row, never from anything the client sends, so a request can only ever reach its own tenant's data.
 *
 * A session whose user is disabled, or whose tenant is suspended, is refused outright. It does NOT quietly fall back
 * to the shortcut user. A cookie that is merely unknown or expired is ignored.
 */
export const requireActor: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.ENVIRONMENT !== "local") {
    throw new ApiError(503, "AUTH_NOT_CONFIGURED", "Authentication is not configured for this environment");
  }
  const db = c.get("db");

  let viaSession = false;
  let row = null as Awaited<ReturnType<ReturnType<typeof sessionsRepo>["find"]>>;
  const cookie = readSessionCookie(c);
  if (cookie) {
    row = await sessionsRepo(db).find(await sha256Base64Url(cookie));
    viaSession = row !== null;
  }

  if (!row && c.env.DEV_ACTOR_EMAIL) {
    const email = normalizeEmail(c.env.DEV_ACTOR_EMAIL);
    const [dev] = await db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        userStatus: users.status,
        mustChangePassword: users.mustChangePassword,
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        tenantStatus: tenants.status,
        access: access.name,
      })
      .from(users)
      .innerJoin(tenants, eq(users.tenantId, tenants.id))
      .innerJoin(access, eq(users.accessId, access.id))
      .where(and(eq(users.normalizedEmail, email), eq(users.isDeleted, false)))
      .limit(1);
    row = dev ?? null;
  }

  if (!row) {
    throw new ApiError(401, "NO_ACTIVE_USER", "Not signed in");
  }
  if (row.userStatus !== "Active") throw new ApiError(403, "USER_DISABLED", "This user is disabled");
  if (row.tenantStatus !== "Active") throw new ApiError(403, "TENANT_SUSPENDED", "This tenant is suspended");

  c.set("actor", {
    userId: row.userId,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    tenantSlug: row.tenantSlug,
    email: row.email,
    displayName: row.displayName,
    access: row.access as Role,
    mustChangePassword: row.mustChangePassword,
    viaSession,
  });
  await next();
};
