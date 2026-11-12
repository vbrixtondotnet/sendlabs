import { asc, count, eq } from "drizzle-orm";
import type { AvailableTemplateDto, AvailableTemplateFullDto } from "../../../shared/api";
import { isUniqueViolation } from "../../lib/errors";
import { iso } from "../../lib/http";
import type { Database } from "../client";
import { systemTemplates, type SystemTemplateRow } from "../schema";

const toSummary = (r: SystemTemplateRow): AvailableTemplateDto => ({ id: r.id, name: r.name, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) });
const toDto = (r: SystemTemplateRow): AvailableTemplateFullDto => ({ ...toSummary(r), htmlBody: r.htmlBody });

/**
 * The Available Templates: shared by every tenant, so nothing here is scoped to one. Who may change them is decided by the
 * routes (only a SuperAdministrator).
 */
export function systemTemplatesRepo(db: Database) {
  return {
    /** By name. Bodies are left out. */
    async list(): Promise<AvailableTemplateDto[]> {
      const rows = await db.select().from(systemTemplates).orderBy(asc(systemTemplates.name));
      return rows.map(toSummary);
    },

    async get(id: string): Promise<AvailableTemplateFullDto | null> {
      const [row] = await db.select().from(systemTemplates).where(eq(systemTemplates.id, id)).limit(1);
      return row ? toDto(row) : null;
    },

    async count(): Promise<number> {
      const [row] = await db.select({ n: count() }).from(systemTemplates);
      return row?.n ?? 0;
    },

    /** Returns the new template, or null if one with that name already exists (ignoring letter case). */
    async create(input: { name: string; htmlBody: string; createdBy: string }): Promise<AvailableTemplateFullDto | null> {
      const [row] = await db.insert(systemTemplates).values(input).onConflictDoNothing().returning();
      return row ? toDto(row) : null;
    },

    /** Returns the template as it is now, "missing" if there is no such template, or "name-taken". */
    async update(id: string, input: { name: string; htmlBody: string }): Promise<AvailableTemplateFullDto | "missing" | "name-taken"> {
      try {
        const [row] = await db.update(systemTemplates).set(input).where(eq(systemTemplates.id, id)).returning();
        return row ? toDto(row) : "missing";
      } catch (err) {
        if (isUniqueViolation(err)) return "name-taken";
        throw err;
      }
    },

    /** Returns false if there is no such template. Tenants' copies are independent and stay. */
    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(systemTemplates).where(eq(systemTemplates.id, id)).returning({ id: systemTemplates.id });
      return rows.length > 0;
    },
  };
}
