import { and, eq } from "drizzle-orm";
import type { UnsubscribeInfoDto, UnsubscribeResultDto } from "../../shared/api";
import type { Database } from "../database/client";
import { contacts, suppressions, tenants } from "../database/schema";
import { ApiError } from "../lib/errors";
import { readUnsubscribeToken, type UnsubscribePayload } from "../lib/unsubscribe";

const INVALID = () => new ApiError(404, "UNSUBSCRIBE_INVALID", "This unsubscribe link is not valid");

/** `ada@example.com` becomes `a***@example.com`: enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** The genuine payload and the company it is for, or the one generic 404. A company that no longer exists cannot be unsubscribed from. */
async function open(db: Database, key: string, token: string): Promise<{ who: UnsubscribePayload; companyName: string }> {
  const who = await readUnsubscribeToken(key, token);
  if (!who) throw INVALID();
  const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, who.tenantId)).limit(1);
  if (!tenant) throw INVALID();
  return { who, companyName: tenant.name };
}

/** What the page shows before the person confirms. Changes nothing (a mail scanner opening the link unsubscribes nobody). */
export async function describeUnsubscribe(db: Database, key: string, token: string): Promise<UnsubscribeInfoDto> {
  const { who, companyName } = await open(db, key, token);
  const [existing] = who.test
    ? []
    : await db.select({ id: suppressions.id }).from(suppressions).where(and(eq(suppressions.tenantId, who.tenantId), eq(suppressions.normalizedEmail, who.email))).limit(1);
  return { companyName, email: maskEmail(who.email), alreadyUnsubscribed: !!existing, test: who.test };
}

/**
 * Unsubscribes the address from this company: it goes on the suppression list (so it is never emailed again) and the
 * contact, if there is one, is marked as having withdrawn consent. Idempotent: doing it twice is the same as once.
 * One atomic batch. A test link does nothing at all.
 */
export async function performUnsubscribe(db: Database, key: string, token: string): Promise<UnsubscribeResultDto> {
  const { who, companyName } = await open(db, key, token);
  if (who.test) return { unsubscribed: false, test: true, companyName };
  await db.batch([
    db
      .insert(suppressions)
      .values({ tenantId: who.tenantId, email: who.email, normalizedEmail: who.email, reason: "Unsubscribed", campaignId: who.campaignId })
      .onConflictDoNothing(),
    db
      .update(contacts)
      .set({ consentStatus: "Withdrawn", consentSource: "Unsubscribe link" })
      .where(and(eq(contacts.tenantId, who.tenantId), eq(contacts.normalizedEmail, who.email))),
  ]);
  console.log(JSON.stringify({ level: "info", event: "unsubscribed", tenantId: who.tenantId }));
  return { unsubscribed: true, test: false, companyName };
}
