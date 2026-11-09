import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import type { EmailTemplateDto, EmailTemplateSummaryDto } from "../../../shared/api";
import { BUILTIN_EMAIL_TEMPLATES } from "../../../shared/builtin-templates";
import { iso } from "../../lib/http";
import type { Database } from "../client";
import { emailTemplates, type EmailTemplateRow } from "../schema";

const toSummary = (r: EmailTemplateRow): EmailTemplateSummaryDto => ({ id: r.id, name: r.name, builtin: r.builtinKey !== null, selected: r.selected, createdAt: iso(r.createdAt) });
const toDto = (r: EmailTemplateRow): EmailTemplateDto => ({ ...toSummary(r), htmlBody: r.htmlBody });

/** Scoped to `tenantId`: another organization's templates do not exist as far as this repository is concerned. */
export function emailTemplatesRepo(db: Database, tenantId: string) {
  const mine = eq(emailTemplates.tenantId, tenantId);

  return {
    /**
     * Makes sure this organization has a copy of every built-in template. Cheap when it does (one count). Each missing one is
     * inserted with "do nothing on conflict", so two requests opening the library at once cannot make duplicates, and a
     * custom template that already uses a built-in's name just keeps it.
     */
    async ensureBuiltins(): Promise<void> {
      const [row] = await db.select({ n: count() }).from(emailTemplates).where(and(mine, isNotNull(emailTemplates.builtinKey)));
      if ((row?.n ?? 0) >= BUILTIN_EMAIL_TEMPLATES.length) return;
      // One statement for all of them: 9 rows is well inside D1's limit on bound parameters.
      await db
        .insert(emailTemplates)
        .values(BUILTIN_EMAIL_TEMPLATES.map((t) => ({ tenantId, name: t.name, builtinKey: t.key, htmlBody: t.htmlBody, selected: false })))
        .onConflictDoNothing();
    },

    /** Built-ins first, then the organization's own, each by name. Bodies are left out. */
    async list(): Promise<EmailTemplateSummaryDto[]> {
      const rows = await db.select().from(emailTemplates).where(mine).orderBy(asc(emailTemplates.name));
      return rows.map(toSummary).sort((a, b) => Number(b.builtin) - Number(a.builtin));
    },

    async get(id: string): Promise<EmailTemplateDto | null> {
      const [row] = await db.select().from(emailTemplates).where(and(mine, eq(emailTemplates.id, id))).limit(1);
      return row ? toDto(row) : null;
    },

    async count(): Promise<number> {
      const [row] = await db.select({ n: count() }).from(emailTemplates).where(mine);
      return row?.n ?? 0;
    },

    /** Returns the new template, or null if the organization already has one with that name. */
    async create(input: { name: string; htmlBody: string; createdBy: string }): Promise<EmailTemplateDto | null> {
      const [row] = await db.insert(emailTemplates).values({ tenantId, ...input, selected: false }).onConflictDoNothing().returning();
      return row ? toDto(row) : null;
    },

    /** Returns the template as it is now, or null if there is no such template. */
    async setSelected(id: string, selected: boolean): Promise<EmailTemplateSummaryDto | null> {
      const [row] = await db.update(emailTemplates).set({ selected }).where(and(mine, eq(emailTemplates.id, id))).returning();
      return row ? toSummary(row) : null;
    },
  };
}
