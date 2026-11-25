import { and, eq, sql } from "drizzle-orm";
import type { CompanyContactDto } from "../../shared/api";
import { COMPANY_CONTACT_COST } from "../../shared/credits";
import { normalizeEmail } from "../../shared/email";
import type { Database } from "../database/client";
import { contacts, creditTransactions, users } from "../database/schema";
import { ApiError } from "../lib/errors";
import { nowMs } from "../lib/id";
import type { HunterService } from "./hunter";
import { lookupCompanyContact } from "./contact-email";

const REASON = "company_contact_add";

/** "Jullie Willis" -> first "Jullie", last "Willis"; one word is a first name. */
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

/**
 * "Add to Contacts" on a Hiring Companies card: finds the company's contact person with Hunter.io (same lookup and cache as Get Email
 * Address), makes them one of the caller's contacts, and spends COMPANY_CONTACT_COST credits, only when a contact is found AND added.
 *
 *  - No key -> 503; nothing found -> 404 NO_EMAIL; neither charges anything.
 *  - One transaction, like "Add Contact" on the People page: the contact is inserted (doing nothing if the account already has that
 *    address, which is not charged again), then only for a really new contact a conditional UPDATE takes the credits (`credits >= cost`,
 *    so two clicks cannot overspend) and a ledger row is written. Out of credits -> 402 and the contact is not created.
 */
export async function addCompanyContact(db: Database, hunter: HunterService | null, who: { userId: string }, companyName: string, now: () => number = nowMs): Promise<CompanyContactDto> {
  const found = await lookupCompanyContact(db, hunter, companyName, now);
  if (!found) throw new ApiError(404, "NO_EMAIL", `No contact was found for ${companyName.trim()}`);
  const email = found.email.trim();
  const normalizedEmail = normalizeEmail(email);
  const { firstName, lastName } = splitName(found.name);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(contacts)
      .values({ userId: who.userId, email, normalizedEmail, firstName, lastName, title: found.position, companyName: companyName.trim(), consentSource: "Hiring companies" })
      .onConflictDoNothing({ target: [contacts.userId, contacts.normalizedEmail] })
      .returning({ id: contacts.id });
    const result = { email, name: found.name, position: found.position };

    if (!created) {
      const [existing] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.userId, who.userId), eq(contacts.normalizedEmail, normalizedEmail))).limit(1);
      const [me] = await tx.select({ credits: users.credits }).from(users).where(eq(users.id, who.userId)).limit(1);
      return { ...result, contactId: existing?.id ?? "", charged: false, credits: me?.credits ?? 0 };
    }

    const [paid] = await tx
      .update(users)
      .set({ credits: sql`${users.credits} - ${COMPANY_CONTACT_COST}`, updatedAt: now() })
      .where(and(eq(users.id, who.userId), sql`${users.credits} >= ${COMPANY_CONTACT_COST}`))
      .returning({ credits: users.credits });
    if (!paid) throw new ApiError(402, "INSUFFICIENT_CREDITS", `You need ${COMPANY_CONTACT_COST} credit to add a contact.`);
    await tx.insert(creditTransactions).values({ userId: who.userId, delta: -COMPANY_CONTACT_COST, balanceAfter: paid.credits, reason: REASON, contactId: created.id, note: found.key, createdAt: now() });
    return { ...result, contactId: created.id, charged: true, credits: paid.credits };
  });
}
