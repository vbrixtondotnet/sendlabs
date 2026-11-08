import { and, count, eq, inArray } from "drizzle-orm";
import type { Page, UserDto } from "../../../shared/api";
import { toUserDto } from "../../lib/dto";
import { offsetOf, pageOf } from "../../lib/http";
import { nowMs } from "../../lib/id";
import { chunk } from "../batch";
import type { Database } from "../client";
import { access, users } from "../schema";

/** Scoped to `tenantId`: another tenant's users do not exist as far as this repository is concerned. */
export function usersRepo(db: Database, tenantId: string) {
  const mine = eq(users.tenantId, tenantId);
  /** Removed users are not shown anywhere in the app. */
  const live = and(mine, eq(users.isDeleted, false));

  return {
    /** Maps user ids of THIS tenant to their email, so API responses show who created something. */
    async emails(ids: readonly string[]): Promise<Map<string, string>> {
      const map = new Map<string, string>();
      for (const group of chunk([...new Set(ids)], 90)) {
        const rows = await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(and(mine, inArray(users.id, group)));
        for (const r of rows) map.set(r.id, r.email);
      }
      return map;
    },

    /** One live (not removed) user of this tenant, or null. */
    async get(id: string) {
      const [row] = await db.select({ id: users.id, accessId: users.accessId }).from(users).where(and(live, eq(users.id, id))).limit(1);
      return row ?? null;
    },

    /**
     * Soft-deletes a user: marks them removed and ends all their sessions, in one atomic batch. Nothing is erased.
     * Refuses (returns "last_administrator") when it would leave the tenant with no active Administrator; that rule is
     * part of the UPDATE itself, so two Administrators removing each other at once cannot both succeed.
     */
    async remove(id: string): Promise<"removed" | "not_found" | "last_administrator"> {
      const now = nowMs();
      const d1 = db.$client;
      const [update] = await d1.batch([
        d1
          .prepare(
            `UPDATE users SET is_deleted = 1, deleted_at = ?1, updated_at = ?1
             WHERE id = ?2 AND tenant_id = ?3 AND is_deleted = 0
               AND (access_id <> 'administrator'
                    OR EXISTS (SELECT 1 FROM users o WHERE o.tenant_id = ?3 AND o.id <> ?2 AND o.is_deleted = 0
                               AND o.status = 'Active' AND o.access_id = 'administrator'))
             RETURNING id`,
          )
          .bind(now, id, tenantId),
        d1.prepare(`DELETE FROM sessions WHERE user_id = ?1 AND tenant_id = ?2 AND EXISTS (SELECT 1 FROM users WHERE id = ?1 AND is_deleted = 1)`).bind(id, tenantId),
      ]);
      if ((update?.results?.length ?? 0) === 1) return "removed";
      return (await this.get(id)) ? "last_administrator" : "not_found";
    },

    /** The tenant's users, Administrators first, then oldest first. Never reads the password hash. */
    async list(page: number, pageSize: number): Promise<Page<UserDto>> {
      const [rows, totalRows] = await Promise.all([
        db
          .select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            displayName: users.displayName,
            accessId: users.accessId,
            accessName: access.name,
            status: users.status,
            mustChangePassword: users.mustChangePassword,
            lastLoginAt: users.lastLoginAt,
            createdAt: users.createdAt,
          })
          .from(users)
          .innerJoin(access, eq(users.accessId, access.id))
          .where(live)
          .orderBy(access.sortOrder, users.createdAt, users.id)
          .limit(pageSize)
          .offset(offsetOf(page, pageSize)),
        db.select({ n: count() }).from(users).where(live),
      ]);
      return pageOf(
        rows.map((r) => toUserDto({ ...r, accessId: r.accessId as UserDto["accessId"], accessName: r.accessName as UserDto["access"] })),
        totalRows[0]?.n ?? 0,
        page,
        pageSize,
      );
    },
  };
}
