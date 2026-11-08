import { and, eq, lt, sql } from "drizzle-orm";
import { nowMs } from "../../lib/id";
import type { Database } from "../client";
import { access, sessions, tenants, users } from "../schema";

/** Looking up and ending sessions. Not tenant-scoped: the session itself says which tenant it belongs to. */
export function sessionsRepo(db: Database) {
  return {
    /** The user, tenant and access level behind a live (unexpired) session, or null. Statuses are returned for the caller to check. */
    async find(tokenHash: string) {
      const [row] = await db
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
        .from(sessions)
        .innerJoin(users, and(eq(sessions.userId, users.id), eq(sessions.tenantId, users.tenantId)))
        .innerJoin(tenants, eq(users.tenantId, tenants.id))
        .innerJoin(access, eq(users.accessId, access.id))
        .where(and(eq(sessions.tokenHash, tokenHash), sql`${sessions.expiresAt} > ${nowMs()}`, eq(users.isDeleted, false)))
        .limit(1);
      return row ?? null;
    },

    /** Ends one session (sign out). Quietly does nothing if it is already gone. */
    async end(tokenHash: string): Promise<void> {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },

    /** Housekeeping: removes sessions that expired more than a day ago. */
    async purgeExpired(): Promise<void> {
      await db.delete(sessions).where(lt(sessions.expiresAt, nowMs() - 24 * 60 * 60 * 1000));
    },
  };
}
