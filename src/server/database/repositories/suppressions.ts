import { and, count, desc, eq } from "drizzle-orm";
import type { Page, SuppressionDto } from "../../../shared/api";
import { iso, offsetOf, pageOf } from "../../lib/http";
import type { Database } from "../client";
import { suppressions } from "../schema";

/** Scoped to `userId`: another account's suppression list does not exist as far as this repository is concerned. */
export function suppressionsRepo(db: Database, userId: string) {
  const mine = eq(suppressions.userId, userId);
  return {
    /** Whether this address (already normalized) asked not to be emailed, or was added to the list. */
    async has(normalizedEmail: string): Promise<boolean> {
      const [row] = await db.select({ id: suppressions.id }).from(suppressions).where(and(mine, eq(suppressions.normalizedEmail, normalizedEmail))).limit(1);
      return !!row;
    },

    /** Newest first. */
    async list(page: number, pageSize: number): Promise<Page<SuppressionDto>> {
      const [rows, totals] = await Promise.all([
        db.select().from(suppressions).where(mine).orderBy(desc(suppressions.createdAt), desc(suppressions.id)).limit(pageSize).offset(offsetOf(page, pageSize)),
        db.select({ n: count() }).from(suppressions).where(mine),
      ]);
      return pageOf(
        rows.map((r) => ({ id: r.id, email: r.email, reason: r.reason, createdAt: iso(r.createdAt) })),
        totals[0]?.n ?? 0,
        page,
        pageSize,
      );
    },
  };
}
