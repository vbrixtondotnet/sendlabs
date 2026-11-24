import { and, eq, lt, sql } from "drizzle-orm";
import { nowMs } from "../../lib/id";
import type { Database } from "../client";
import { sessions, users } from "../schema";

/** Looking up and ending sessions. Not account-scoped: the session itself says which account it belongs to. */
export function sessionsRepo(db: Database) {
  return {
    /** The account behind a live (unexpired) session, or null. Its status is returned for the caller to check. */
    async find(tokenHash: string) {
      const [row] = await db
        .select({
          sessionId: sessions.id,
          expiresAt: sessions.expiresAt,
          userId: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          position: users.position,
          displayName: users.displayName,
          userStatus: users.status,
          mustChangePassword: users.mustChangePassword,
          companyName: users.companyName,
          postalAddress: users.postalAddress,
          website: users.website,
          requireUnsubscribeLink: users.requireUnsubscribeLink,
          oneClickUnsubscribe: users.oneClickUnsubscribe,
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(eq(sessions.tokenHash, tokenHash), sql`${sessions.expiresAt} > ${nowMs()}`))
        .limit(1);
      return row ?? null;
    },

    /**
     * Pushes a still-valid session's expiry out to `expiresAt`. Never revives an expired session and never shortens one
     * (the conditions are in the UPDATE, so a racing request cannot undo another's renewal).
     */
    async renew(sessionId: string, expiresAt: number): Promise<boolean> {
      const now = nowMs();
      const rows = await db
        .update(sessions)
        .set({ expiresAt })
        .where(and(eq(sessions.id, sessionId), sql`${sessions.expiresAt} > ${now}`, sql`${sessions.expiresAt} < ${expiresAt}`))
        .returning({ id: sessions.id });
      return rows.length === 1;
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
