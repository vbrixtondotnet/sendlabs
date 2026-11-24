import { asc, eq } from "drizzle-orm";
import type { AvailableTemplateDto, AvailableTemplateFullDto } from "../../../shared/api";
import { iso } from "../../lib/http";
import type { Database } from "../client";
import { systemTemplates, type SystemTemplateRow } from "../schema";

const toSummary = (r: SystemTemplateRow): AvailableTemplateDto => ({ id: r.id, name: r.name, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) });
const toDto = (r: SystemTemplateRow): AvailableTemplateFullDto => ({ ...toSummary(r), htmlBody: r.htmlBody });

/**
 * The Available Templates: shared by every account, so nothing here is scoped to one, and READ-ONLY: there is no way through the app
 * to create, change or delete one (a migration does that).
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
  };
}
