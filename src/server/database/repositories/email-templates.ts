import { and, asc, count, eq } from "drizzle-orm";
import type { EmailTemplateDto, EmailTemplateSummaryDto } from "../../../shared/api";
import { iso } from "../../lib/http";
import type { Database } from "../client";
import { emailTemplates, type EmailTemplateRow } from "../schema";

const toSummary = (r: EmailTemplateRow): EmailTemplateSummaryDto => ({ id: r.id, name: r.name, systemKey: r.builtinKey, createdAt: iso(r.createdAt) });
const toDto = (r: EmailTemplateRow): EmailTemplateDto => ({ ...toSummary(r), htmlBody: r.htmlBody });

/** Scoped to `tenantId`: another organization's templates do not exist as far as this repository is concerned. */
export function emailTemplatesRepo(db: Database, tenantId: string) {
  const mine = eq(emailTemplates.tenantId, tenantId);

  return {
    /** The organization's My Templates, by name. Bodies are left out. */
    async list(): Promise<EmailTemplateSummaryDto[]> {
      const rows = await db.select().from(emailTemplates).where(mine).orderBy(asc(emailTemplates.name));
      return rows.map(toSummary);
    },

    async get(id: string): Promise<EmailTemplateDto | null> {
      const [row] = await db.select().from(emailTemplates).where(and(mine, eq(emailTemplates.id, id))).limit(1);
      return row ? toDto(row) : null;
    },

    /** The copy of a system template, if this organization already added it. */
    async getBySystemKey(key: string): Promise<EmailTemplateDto | null> {
      const [row] = await db.select().from(emailTemplates).where(and(mine, eq(emailTemplates.builtinKey, key))).limit(1);
      return row ? toDto(row) : null;
    },

    async count(): Promise<number> {
      const [row] = await db.select({ n: count() }).from(emailTemplates).where(mine);
      return row?.n ?? 0;
    },

    /**
     * Adds a template. `systemKey` marks a copy of a system template. Returns the new template, or null if the
     * organization already has one with that name (or already has that system template).
     */
    async create(input: { name: string; htmlBody: string; createdBy: string; systemKey?: string }): Promise<EmailTemplateDto | null> {
      const { systemKey, ...rest } = input;
      const [row] = await db.insert(emailTemplates).values({ tenantId, ...rest, builtinKey: systemKey ?? null }).onConflictDoNothing().returning();
      return row ? toDto(row) : null;
    },

    /** Returns false if there is no such template in this organization. */
    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(emailTemplates).where(and(mine, eq(emailTemplates.id, id))).returning({ id: emailTemplates.id });
      return rows.length > 0;
    },
  };
}
