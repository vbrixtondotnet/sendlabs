import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import type { GlobalContactDto, Page } from "../../../shared/api";
import type { GlobalContactInput, GlobalContactListQuery } from "../../../shared/schemas";
import { isUniqueViolation } from "../../lib/errors";
import { iso, offsetOf, pageOf } from "../../lib/http";
import type { Database } from "../client";
import { globalContacts, type GlobalContactRow } from "../schema";

const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

const toDto = (r: GlobalContactRow): GlobalContactDto => ({
  id: r.id, firstName: r.firstName, lastName: r.lastName, title: r.title, company: r.company, email: r.email,
  employeeCount: r.employeeCount, industry: r.industry, website: r.website, city: r.city, state: r.state, country: r.country, updatedAt: iso(r.updatedAt),
});

/** Managing the shared people directory. Only a SuperAdmin reaches this (the app gates the path); the directory belongs to no account. */
export function globalContactsAdminRepo(db: Database) {
  return {
    async list(q: GlobalContactListQuery): Promise<Page<GlobalContactDto>> {
      const term = q.q ? `%${likeEscape(q.q)}%` : null;
      const where = term
        ? or(ilike(globalContacts.firstName, term), ilike(globalContacts.lastName, term), ilike(globalContacts.email, term), ilike(globalContacts.company, term), ilike(globalContacts.title, term))
        : undefined;
      const [rows, total] = await Promise.all([
        db.select().from(globalContacts).where(where).orderBy(asc(globalContacts.company), asc(globalContacts.id)).limit(q.pageSize).offset(offsetOf(q.page, q.pageSize)),
        db.select({ n: count() }).from(globalContacts).where(where),
      ]);
      return pageOf(rows.map(toDto), total[0]?.n ?? 0, q.page, q.pageSize);
    },

    /** The new row, or "email-taken" when another row already has that address (ignoring case). */
    async create(input: GlobalContactInput): Promise<GlobalContactDto | "email-taken"> {
      try {
        const [row] = await db.insert(globalContacts).values(input).returning();
        return toDto(row!);
      } catch (err) {
        if (isUniqueViolation(err)) return "email-taken";
        throw err;
      }
    },

    async update(id: string, input: GlobalContactInput): Promise<GlobalContactDto | "missing" | "email-taken"> {
      try {
        const [row] = await db.update(globalContacts).set(input).where(eq(globalContacts.id, id)).returning();
        return row ? toDto(row) : "missing";
      } catch (err) {
        if (isUniqueViolation(err)) return "email-taken";
        throw err;
      }
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(globalContacts).where(and(eq(globalContacts.id, id))).returning({ id: globalContacts.id });
      return rows.length > 0;
    },
  };
}

