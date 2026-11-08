import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { nowMs } from "../../lib/id";
import type { Database } from "../client";
import { oauthStates, senderAccounts, tenants, users } from "../schema";

/** Scoped to `tenantId`: another tenant's connected account does not exist as far as this repository is concerned. */
export function senderRepo(db: Database, tenantId: string) {
  const mine = eq(senderAccounts.tenantId, tenantId);

  return {
    async get() {
      const [row] = await db.select().from(senderAccounts).where(mine).limit(1);
      return row ?? null;
    },

    /**
     * Connects (or reconnects) the tenant's account. One row per tenant: connecting again replaces it in place,
     * whether it is the same Google account or a different one.
     */
    async upsert(input: { email: string; normalizedEmail: string; refreshTokenEncrypted: string; scopes: string; connectedBy: string }) {
      const now = nowMs();
      const values = { ...input, status: "Connected" as const, keyVersion: 1, connectedAt: now };
      const [row] = await db
        .insert(senderAccounts)
        .values({ tenantId, ...values })
        .onConflictDoUpdate({ target: senderAccounts.tenantId, set: values })
        .returning();
      if (!row) throw new Error("Upsert returned no row");
      return row;
    },

    /** Google no longer honours the stored token: flag it, so the UI asks for a reconnect and nothing tries to send. */
    async markNeedsReconnect(): Promise<void> {
      await db.update(senderAccounts).set({ status: "NeedsReconnect" }).where(mine);
    },

    /** Removes the tenant's account and returns what was removed (so its token can be revoked), or null. */
    async remove() {
      const [row] = await db.delete(senderAccounts).where(mine).returning();
      return row ?? null;
    },
  };
}

/** In-flight "Connect Gmail" attempts. Not tenant-scoped on purpose: the callback does not yet know the tenant. */
export function oauthStatesRepo(db: Database) {
  return {
    /** Starts an attempt. Only the latest one per tenant stays valid, and old leftovers are swept away. */
    async start(input: { tenantId: string; userId: string; stateHash: string; codeVerifierEncrypted: string; ttlMs: number }) {
      const now = nowMs();
      await db.batch([
        db.delete(oauthStates).where(and(eq(oauthStates.tenantId, input.tenantId), isNull(oauthStates.usedAt))),
        db.delete(oauthStates).where(lt(oauthStates.expiresAt, now - 60 * 60 * 1000)),
        db.insert(oauthStates).values({
          tenantId: input.tenantId,
          userId: input.userId,
          stateHash: input.stateHash,
          codeVerifierEncrypted: input.codeVerifierEncrypted,
          expiresAt: now + input.ttlMs,
        }),
      ]);
    },

    /**
     * Uses an attempt exactly once. One UPDATE both checks (unused, unexpired) and marks it used, so two
     * simultaneous callbacks with the same state cannot both win. Returns null if it is unknown, used or expired.
     */
    async claim(stateHash: string) {
      const now = nowMs();
      const [row] = await db
        .update(oauthStates)
        .set({ usedAt: now })
        .where(and(eq(oauthStates.stateHash, stateHash), isNull(oauthStates.usedAt), sql`${oauthStates.expiresAt} > ${now}`))
        .returning({ tenantId: oauthStates.tenantId, userId: oauthStates.userId, codeVerifierEncrypted: oauthStates.codeVerifierEncrypted });
      return row ?? null;
    },

    /** Whether the user and tenant behind an attempt are both still Active. */
    async isActive(tenantId: string, userId: string): Promise<boolean> {
      const [row] = await db
        .select({ userStatus: users.status, tenantStatus: tenants.status })
        .from(users)
        .innerJoin(tenants, eq(users.tenantId, tenants.id))
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), eq(users.isDeleted, false)))
        .limit(1);
      return row?.userStatus === "Active" && row?.tenantStatus === "Active";
    },
  };
}
