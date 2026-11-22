import { and, count, desc, eq, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { ContactDto, Page } from "../../../shared/api";
import { normalizeEmail } from "../../../shared/email";
import type { ValidContact } from "../../../shared/csv";
import type { ContactCreate, ContactListQuery, ContactPatch } from "../../../shared/schemas";
import { conflict, isUniqueViolation, notFound } from "../../lib/errors";
import { toContactDto } from "../../lib/dto";
import { likeContains, offsetOf, pageOf } from "../../lib/http";
import { newId, nowMs } from "../../lib/id";
import { BULK_ROWS, LOOKUP_CHUNK, chunk } from "../batch";
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
      const created = new Set<string>();
      for (const group of chunk(rows, BULK_ROWS)) {
        const inserted = await db
          .insert(contacts)
          .values(
            group.map((c) => ({
              id: newId(),
              tenantId,
              email: c.rawEmail,
              normalizedEmail: c.email,
              firstName: c.firstName,
              lastName: c.lastName,
              title: c.title,
              companyName: c.companyName,
              employees: c.employees,
              industry: c.industry,
              linkedinUrl: c.linkedinUrl,
              website: c.website,
              city: c.city,
              state: c.state,
              country: c.country,
              annualRevenue: c.annualRevenue,
              sourceImportId,
              createdAt: now,
              updatedAt: now,
            })),
          )
          // The unique index decides: an address this tenant already has is skipped, never overwritten.
          .onConflictDoNothing({ target: [contacts.tenantId, contacts.normalizedEmail] })
          .returning({ email: contacts.normalizedEmail });
        for (const r of inserted) created.add(r.email);
      }
      return created;
    },

    /** Maps normalized emails to this tenant's contact ids (for linking import rows). */
    async idsByEmail(emails: readonly string[]): Promise<Map<string, string>> {
      const map = new Map<string, string>();
      for (const group of chunk(emails, LOOKUP_CHUNK)) {
        const found = await db
          .select({ id: contacts.id, email: contacts.normalizedEmail })
          .from(contacts)
          .where(and(mine, inArray(contacts.normalizedEmail, group)));
        for (const r of found) map.set(r.email, r.id);
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
     * cleared first (one transaction): the composite foreign keys cannot use ON DELETE SET NULL, since that
     * would also null the required tenant_id. A full erasure that scrubs those snapshots is a later feature.
     */
    async delete(id: string): Promise<void> {
      const deleted = await db.transaction(async (tx) => {
        await tx.update(campaignRecipients).set({ contactId: null }).where(and(eq(campaignRecipients.tenantId, tenantId), eq(campaignRecipients.contactId, id)));
        await tx.update(importRows).set({ contactId: null }).where(and(eq(importRows.tenantId, tenantId), eq(importRows.contactId, id)));
        return tx.delete(contacts).where(and(mine, eq(contacts.id, id))).returning({ id: contacts.id });
      });
      if (deleted.length === 0) throw notFound("Contact");
    },
  };
}
