import { and, asc, count, eq } from "drizzle-orm";
import type { TestRecipientDto } from "../../../shared/api";
import type { Database } from "../client";
import { testRecipients } from "../schema";
import { usersRepo } from "./users";

/** Scoped to `tenantId`: another tenant's allowlist does not exist as far as this repository is concerned. */
export function testRecipientsRepo(db: Database, tenantId: string) {
  const mine = eq(testRecipients.tenantId, tenantId);

  return {
    async list(): Promise<TestRecipientDto[]> {
      const rows = await db.select().from(testRecipients).where(mine).orderBy(asc(testRecipients.createdAt), asc(testRecipients.id));
      const who = await usersRepo(db, tenantId).emails(rows.map((r) => r.createdBy));
      return rows.map((r) => ({ id: r.id, email: r.email, addedBy: who.get(r.createdBy) ?? "", createdAt: new Date(r.createdAt).toISOString() }));
    },

    /** Just the addresses, in the order they were added. This is what a test send mails. */
    async emails(): Promise<string[]> {
      const rows = await db.select({ email: testRecipients.email }).from(testRecipients).where(mine).orderBy(asc(testRecipients.createdAt), asc(testRecipients.id));
      return rows.map((r) => r.email);
    },

    async count(): Promise<number> {
      const [row] = await db.select({ n: count() }).from(testRecipients).where(mine);
      return row?.n ?? 0;
    },

    /** Returns the new row, or null if that address is already on the list. */
    async add(input: { email: string; normalizedEmail: string; createdBy: string }) {
      const [row] = await db.insert(testRecipients).values({ tenantId, ...input }).onConflictDoNothing().returning();
      return row ?? null;
    },

    /** Returns whether something was removed. */
    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(testRecipients).where(and(mine, eq(testRecipients.id, id))).returning({ id: testRecipients.id });
      return rows.length > 0;
    },
  };
}
