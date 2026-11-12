import { and, count, desc, eq, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { ContactDto, Page } from "../../../shared/api";
import { normalizeEmail } from "../../../shared/email";
import type { ValidContact } from "../../../shared/csv";
import type { ContactCreate, ContactListQuery, ContactPatch } from "../../../shared/schemas";
import { conflict, isUniqueViolation, notFound } from "../../lib/errors";
import { toContactDto } from "../../lib/dto";
import { likeContains, offsetOf, pageOf } from "../../lib/http";
import { newId, nowMs } from "../../lib/id";
import { BULK_ROWS, chunk, runBatched, runBulk } from "../batch";
import type { Database } from "../client";
import { campaignRecipients, contacts, importRows } from "../schema";

/** Case-insensitive, literal-match `LIKE`. `pattern` comes from `likeContains`. */
const ci = (column: SQL | AnyColumn, pattern: string) =>
  sql`lower(${column}) LIKE ${pattern} ESCAPE '\\'`;

/**
 * Every query here is scoped to `tenantId`: a contact of another tenant does not exist as far as this
 * repository is concerned (reads find nothing, writes change nothing, and the API answers 404).
 */
export function contactsRepo(db: Database, tenantId: string) {
  const mine = eq(contacts.tenantId, tenantId);

  const byId = async (id: string) => {
    const [row] = await db.select().from(contacts).where(and(mine, eq(contacts.id, id))).limit(1);
    return row ?? null;
  };

  return {
    async list(q: ContactListQuery): Promise<Page<ContactDto>> {
      const conditions: (SQL | undefined)[] = [mine];
      if (q.industry) conditions.push(eq(contacts.industry, q.industry));
      if (q.consent) conditions.push(eq(contacts.consentStatus, q.consent));
      if (q.q) {
        const pat = likeContains(q.q.toLowerCase());
        conditions.push(
          or(
            ci(contacts.normalizedEmail, pat),
            ci(contacts.firstName, pat),
            ci(contacts.lastName, pat),
            ci(contacts.companyName, pat),
            ci(contacts.title, pat),
            ci(sql`${contacts.firstName} || ' ' || ${contacts.lastName}`, pat),
          ),
        );
      }
      const where = and(...conditions);

      const [rows, totalRows] = await Promise.all([
        db
          .select()
          .from(contacts)
          .where(where)
          .orderBy(desc(contacts.createdAt), desc(contacts.id))
          .limit(q.pageSize)
          .offset(offsetOf(q.page, q.pageSize)),
        db.select({ n: count() }).from(contacts).where(where),
      ]);
      return pageOf(rows.map(toContactDto), totalRows[0]?.n ?? 0, q.page, q.pageSize);
    },

    /**
     * Bulk insert for an import. An email that already exists IN THIS TENANT is skipped, never overwritten
     * (decision D-06), and the skip is decided by the unique index, so concurrent imports cannot create
     * duplicates. Another tenant holding the same address is irrelevant: that is a separate row.
     * Returns the normalized emails that were actually created. Safe to re-run.
     */
    async insertMany(rows: readonly ValidContact[], sourceImportId: string): Promise<Set<string>> {
      const now = nowMs();
      const sqlText = `INSERT INTO contacts
        (id, tenant_id, email, normalized_email, first_name, last_name, title, company_name, employees, industry,
         linkedin_url, website, city, state, country, annual_revenue, source_import_id, created_at, updated_at)
        SELECT json_extract(value,'$[0]'), ?4, json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]'),
               json_extract(value,'$[4]'), json_extract(value,'$[5]'), json_extract(value,'$[6]'), json_extract(value,'$[7]'),
               json_extract(value,'$[8]'), json_extract(value,'$[9]'), json_extract(value,'$[10]'), json_extract(value,'$[11]'),
               json_extract(value,'$[12]'), json_extract(value,'$[13]'), json_extract(value,'$[14]'), ?2, ?3, ?3
        FROM json_each(?1) WHERE true
        ON CONFLICT(tenant_id, normalized_email) DO NOTHING
        RETURNING normalized_email`;
      const statements = chunk(rows, BULK_ROWS).map((group) =>
        db.$client.prepare(sqlText).bind(
          JSON.stringify(
            group.map((c) => [newId(), c.rawEmail, c.email, c.firstName, c.lastName, c.title, c.companyName, c.employees, c.industry, c.linkedinUrl, c.website, c.city, c.state, c.country, c.annualRevenue]),
          ),
          sourceImportId,
          now,
          tenantId,
        ),
      );
      const created = new Set<string>();
      for (const result of await runBulk(db, statements)) {
        for (const r of (result.results ?? []) as { normalized_email: string }[]) created.add(r.normalized_email);
      }
      return created;
    },

    /** Maps normalized emails to this tenant's contact ids (for linking import rows). */
    async idsByEmail(emails: readonly string[]): Promise<Map<string, string>> {
      const statements = chunk(emails, 90).map((group) =>
        db
          .select({ id: contacts.id, email: contacts.normalizedEmail })
          .from(contacts)
          .where(and(mine, inArray(contacts.normalizedEmail, group))),
      );
      const map = new Map<string, string>();
      for (const result of await runBatched(db, statements)) {
        for (const r of result as { id: string; email: string }[]) map.set(r.email, r.id);
      }
      return map;
    },

    /** Distinct non-empty industries for the filter dropdown. Capped so a messy import cannot bloat it. */
    async industries(): Promise<string[]> {
      return (await this.industryCounts()).map((r) => r.industry);
    },

    /** Each distinct non-empty industry with how many contacts have it (the audience size when it is chosen). */
    async industryCounts(): Promise<{ industry: string; count: number }[]> {
      const rows = await db
        .select({ industry: contacts.industry, n: count() })
        .from(contacts)
        .where(and(mine, sql`${contacts.industry} <> ''`))
        .groupBy(contacts.industry)
        .orderBy(contacts.industry)
        .limit(200);
      return rows.map((r) => ({ industry: r.industry, count: r.n }));
    },

    async get(id: string): Promise<ContactDto> {
      const row = await byId(id);
      if (!row) throw notFound("Contact");
      return toContactDto(row);
    },

    async create(input: ContactCreate, sourceImportId: string | null = null): Promise<ContactDto> {
      const { email, ...rest } = input;
      const normalizedEmail = normalizeEmail(email);
      try {
        const [row] = await db
          .insert(contacts)
          .values({ ...rest, tenantId, email, normalizedEmail, sourceImportId })
          .returning();
        if (!row) throw new Error("Insert returned no row");
        return toContactDto(row);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const [existing] = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(mine, eq(contacts.normalizedEmail, normalizedEmail)))
          .limit(1);
        throw conflict("A contact with this email address already exists", "EMAIL_EXISTS", {
          contactId: existing?.id ?? null,
        });
      }
    },

    async update(id: string, patch: ContactPatch): Promise<ContactDto> {
      const { email, ...rest } = patch;
      const set = {
        ...rest,
        ...(email !== undefined ? { email, normalizedEmail: normalizeEmail(email) } : {}),
      };
      try {
        const [row] = await db.update(contacts).set(set).where(and(mine, eq(contacts.id, id))).returning();
        if (!row) throw notFound("Contact");
        return toContactDto(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw conflict("Another contact already uses this email address", "EMAIL_EXISTS");
        }
        throw err;
      }
    },

    /**
     * Removes the contact. Recipients and import rows keep their snapshots and lose only the link, which is
     * cleared first (one atomic batch): the composite foreign keys cannot use ON DELETE SET NULL, since that
     * would also null the required tenant_id. A full erasure that scrubs those snapshots is a later feature.
     */
    async delete(id: string): Promise<void> {
      const [, , deleted] = await db.batch([
        db.update(campaignRecipients).set({ contactId: null }).where(and(eq(campaignRecipients.tenantId, tenantId), eq(campaignRecipients.contactId, id))),
        db.update(importRows).set({ contactId: null }).where(and(eq(importRows.tenantId, tenantId), eq(importRows.contactId, id))),
        db.delete(contacts).where(and(mine, eq(contacts.id, id))).returning({ id: contacts.id }),
      ]);
      if (deleted.length === 0) throw notFound("Contact");
    },
  };
}
