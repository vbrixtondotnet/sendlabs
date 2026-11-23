import { and, asc, count, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { PeopleSearchDto, PersonDto } from "../../../shared/api";
import { PEOPLE_COUNTRY_ALIASES } from "../../../shared/people";
import type { PeopleSearchQuery } from "../../../shared/schemas";
import { offsetOf, pageOf } from "../../lib/http";
import type { Database } from "../client";
import { contacts, globalContacts, type GlobalContactRow } from "../schema";

/** `%`, `_` and `\` typed by a person must match themselves in a LIKE pattern, not act as wildcards. */
const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** `revealed` is true when the person is one of the caller's own contacts: only then does the email address leave the server. */
export const toPersonDto = (r: GlobalContactRow, revealed: boolean): PersonDto => ({
  id: r.id,
  firstName: r.firstName,
  lastName: r.lastName,
  title: r.title,
  companyName: r.company,
  employees: r.employeeCount,
  industry: r.industry,
  website: r.website,
  city: r.city,
  state: r.state,
  country: r.country,
  email: revealed && r.email.trim() !== "" ? r.email.trim() : null,
  hasEmail: r.email.trim() !== "",
});

/**
 * The shared directory. Not scoped to a tenant: every organization searches the same rows. The tenant is only needed to tell
 * which people are already its contacts, because those (and only those) show their email address.
 */
export function globalContactsRepo(db: Database, tenantId: string) {
  return {
    /**
     * One page of people matching every filter that was given (a filter left empty is not applied). Paging happens in the
     * database: only `pageSize` rows are read, plus one count of all the matches. Order is fixed (company, then id) so a
     * row never moves between pages.
     */
    async search(q: PeopleSearchQuery): Promise<PeopleSearchDto> {
      const where: SQL[] = [];

      if (q.countries.length > 0) {
        // The chosen names plus their other spellings, compared without regard to case.
        const names = q.countries.flatMap((c) => [c, ...(PEOPLE_COUNTRY_ALIASES[c] ?? [])]).map((c) => c.toLowerCase());
        where.push(inArray(sql`lower(${globalContacts.country})`, names));
      }
      if (q.industries.length > 0) where.push(inArray(globalContacts.industry, q.industries));
      if (q.companySize) {
        const [min, max] = q.companySize.split(",");
        where.push(gte(globalContacts.employeeCount, Number(min)));
        if (max) where.push(lte(globalContacts.employeeCount, Number(max)));
      }
      if (q.titles.length > 0) {
        const any = or(...q.titles.map((t) => ilike(globalContacts.title, `%${likeEscape(t)}%`)));
        if (any) where.push(any);
      }

      const condition = where.length > 0 ? and(...where) : undefined;
      const [rows, totals] = await Promise.all([
        db
          .select({ person: globalContacts, contactId: contacts.id })
          .from(globalContacts)
          // A person is "added" when this tenant holds a contact with the same address (the unique index makes this a point lookup).
          .leftJoin(contacts, and(eq(contacts.tenantId, tenantId), sql`${globalContacts.email} <> ''`, eq(contacts.normalizedEmail, sql`lower(trim(${globalContacts.email}))`)))
          .where(condition)
          .orderBy(asc(globalContacts.company), asc(globalContacts.id))
          .limit(q.pageSize)
          .offset(offsetOf(q.page, q.pageSize)),
        db.select({ n: count() }).from(globalContacts).where(condition),
      ]);
      return pageOf(rows.map((r) => toPersonDto(r.person, r.contactId !== null)), totals[0]?.n ?? 0, q.page, q.pageSize);
    },

    /** Every industry in the directory, alphabetical: the choices of the Industry filter. */
    async industries(): Promise<string[]> {
      const rows = await db.selectDistinct({ industry: globalContacts.industry }).from(globalContacts).where(sql`${globalContacts.industry} <> ''`).orderBy(asc(globalContacts.industry));
      return rows.map((r) => r.industry);
    },
  };
}
