import { and, eq, sql } from "drizzle-orm";
import type { AddContactResultDto } from "../../shared/api";
import { PERSON_REVEAL_COST } from "../../shared/credits";
import { normalizeEmail } from "../../shared/email";
import type { Database } from "../database/client";
import { toPersonDto } from "../database/repositories/global-contacts";
import { contacts, creditTransactions, globalContacts, users } from "../database/schema";
import { ApiError, conflict, notFound } from "../lib/errors";
import { nowMs } from "../lib/id";

const REASON = "people_reveal";

/**
 * "Add Contact" on the People page: reveals a global contact's email address by making them one of the caller's tenant's
 * contacts, and spends PERSON_REVEAL_COST credits from the caller's balance.
 *
 * All in one transaction, so there is never a charge without a contact or a contact without a charge:
 *   1. the contact is inserted, doing nothing if the tenant already has that address;
 *   2. only when a contact was really created, the credits are taken with one conditional UPDATE (`credits >= cost`), so
 *      two clicks at once cannot spend the same credit twice or take the balance below zero;
 *   3. a ledger row records it.
 * A person who is already a contact (added earlier, by anyone in the tenant, or imported from a CSV) is not charged again. Out
 * of credits answers 402 and the transaction rolls back, so no contact is created.
 */
export async function addPersonAsContact(db: Database, who: { userId: string; tenantId: string }, personId: string): Promise<AddContactResultDto> {
  return db.transaction(async (tx) => {
    const [person] = await tx.select().from(globalContacts).where(eq(globalContacts.id, personId)).limit(1);
    if (!person) throw notFound("Person");
    const email = person.email.trim();
    if (!email) throw conflict("There is no email address on file for this person, so there is nothing to reveal", "NO_EMAIL");
    const normalizedEmail = normalizeEmail(email);

    const [created] = await tx
      .insert(contacts)
      .values({
        tenantId: who.tenantId,
        email,
        normalizedEmail,
        firstName: person.firstName,
        lastName: person.lastName,
        title: person.title,
        companyName: person.company,
        employees: person.employeeCount,
        industry: person.industry,
        website: person.website,
        city: person.city,
        state: person.state,
        country: person.country,
        consentSource: "People search",
      })
      .onConflictDoNothing({ target: [contacts.tenantId, contacts.normalizedEmail] })
      .returning({ id: contacts.id });

    if (!created) {
      // Already one of this tenant's contacts: nothing to charge.
      const [existing] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.tenantId, who.tenantId), eq(contacts.normalizedEmail, normalizedEmail)))
        .limit(1);
      const [me] = await tx.select({ credits: users.credits }).from(users).where(eq(users.id, who.userId)).limit(1);
      return { person: toPersonDto(person, true), contactId: existing?.id ?? "", charged: false, credits: me?.credits ?? 0 };
    }

    const [paid] = await tx
      .update(users)
      .set({ credits: sql`${users.credits} - ${PERSON_REVEAL_COST}`, updatedAt: nowMs() })
      .where(and(eq(users.id, who.userId), eq(users.tenantId, who.tenantId), sql`${users.credits} >= ${PERSON_REVEAL_COST}`))
      .returning({ credits: users.credits });
    if (!paid) throw new ApiError(402, "INSUFFICIENT_CREDITS", "You are out of credits. Credits are needed to add people to your contacts.");

    await tx.insert(creditTransactions).values({
      tenantId: who.tenantId,
      userId: who.userId,
      delta: -PERSON_REVEAL_COST,
      balanceAfter: paid.credits,
      reason: REASON,
      globalContactId: person.id,
      contactId: created.id,
    });
    return { person: toPersonDto(person, true), contactId: created.id, charged: true, credits: paid.credits };
  });
}
