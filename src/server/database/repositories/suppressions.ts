import { count, desc, eq } from "drizzle-orm";
import type { Page, SuppressionDto } from "../../../shared/api";
import { iso, offsetOf, pageOf } from "../../lib/http";
import type { Database } from "../client";
import { suppressions } from "../schema";

/** Scoped to `tenantId`: another tenant's suppression list does not exist as far as this repository is concerned. */
export function suppressionsRepo(db: Database, tenantId: string) {
  const mine = eq(suppressions.tenantId, tenantId);
  return {
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
