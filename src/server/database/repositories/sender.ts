import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { nowMs } from "../../lib/id";
import type { Database } from "../client";
import { oauthStates, senderAccounts, users } from "../schema";

/** Scoped to `userId`: another account's connected account does not exist as far as this repository is concerned. */
export function senderRepo(db: Database, userId: string) {
  const mine = eq(senderAccounts.userId, userId);

  return {
    async get() {
      const [row] = await db.select().from(senderAccounts).where(mine).limit(1);
      return row ?? null;
    },

    /**
     * Connects (or reconnects) the account's Gmail. One row per account: connecting again replaces it in place,
     * whether it is the same Google account or a different one.
     */
    async upsert(input: { email: string; normalizedEmail: string; refreshTokenEncrypted: string; scopes: string }) {
      const now = nowMs();
      const values = { ...input, status: "Connected" as const, keyVersion: 1, connectedAt: now };
      const [row] = await db
        .insert(senderAccounts)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: senderAccounts.userId, set: values })
        .returning();
      if (!row) throw new Error("Upsert returned no row");
      return row;
    },

    /** Sets the name shown on the From line. Returns the updated account, or null when none is connected. */
    async setSenderName(senderName: string) {
      const [row] = await db.update(senderAccounts).set({ senderName }).where(mine).returning();
      return row ?? null;
    },

    /** Google no longer honours the stored token: flag it, so the UI asks for a reconnect and nothing tries to send. */
    async markNeedsReconnect(): Promise<void> {
      await db.update(senderAccounts).set({ status: "NeedsReconnect" }).where(mine);
    },

    /** Removes the account's Gmail connection and returns what was removed (so its token can be revoked), or null. */
    async remove() {
      const [row] = await db.delete(senderAccounts).where(mine).returning();
      return row ?? null;
    },
  };
}

/** In-flight "Connect Gmail" attempts. Not account-scoped on purpose: the callback does not yet know the account. */
export function oauthStatesRepo(db: Database) {
  return {
    /** Starts an attempt. Only the latest one per account stays valid, and old leftovers are swept away. */
    async start(input: { userId: string; stateHash: string; codeVerifierEncrypted: string; ttlMs: number }) {
      const now = nowMs();
      await db.transaction(async (tx) => {
        await tx.delete(oauthStates).where(and(eq(oauthStates.userId, input.userId), isNull(oauthStates.usedAt)));
        await tx.delete(oauthStates).where(lt(oauthStates.expiresAt, now - 60 * 60 * 1000));
        await tx.insert(oauthStates).values({
          userId: input.userId,
          stateHash: input.stateHash,
          codeVerifierEncrypted: input.codeVerifierEncrypted,
          expiresAt: now + input.ttlMs,
        });
      });
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
        .returning({ userId: oauthStates.userId, codeVerifierEncrypted: oauthStates.codeVerifierEncrypted });
      return row ?? null;
    },

    /** Whether the account behind an attempt is still Active. */
    async isActive(userId: string): Promise<boolean> {
      const [row] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
      return row?.status === "Active";
    },
  };
}
