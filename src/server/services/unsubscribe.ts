import { and, eq } from "drizzle-orm";
import type { UnsubscribeInfoDto, UnsubscribeResultDto } from "../../shared/api";
import type { Database } from "../database/client";
import { contacts, suppressions, users } from "../database/schema";
import { ApiError } from "../lib/errors";
import { readUnsubscribeToken, type UnsubscribePayload } from "../lib/unsubscribe";

const INVALID = () => new ApiError(404, "UNSUBSCRIBE_INVALID", "This unsubscribe link is not valid");

/** `ada@example.com` becomes `a***@example.com`: enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** The genuine payload and the company it is for, or the one generic 404. An account that no longer exists cannot be unsubscribed from. */
async function open(db: Database, key: string, token: string): Promise<{ who: UnsubscribePayload; companyName: string }> {
  const who = await readUnsubscribeToken(key, token);
  if (!who) throw INVALID();
  const [account] = await db.select({ name: users.companyName, displayName: users.displayName }).from(users).where(eq(users.id, who.userId)).limit(1);
  if (!account) throw INVALID();
  return { who, companyName: account.name || account.displayName };
}

/** What the page shows before the person confirms. Changes nothing (a mail scanner opening the link unsubscribes nobody). */
export async function describeUnsubscribe(db: Database, key: string, token: string): Promise<UnsubscribeInfoDto> {
  const { who, companyName } = await open(db, key, token);
  const [existing] = who.test
    ? []
    : await db.select({ id: suppressions.id }).from(suppressions).where(and(eq(suppressions.userId, who.userId), eq(suppressions.normalizedEmail, who.email))).limit(1);
  return { companyName, email: maskEmail(who.email), alreadyUnsubscribed: !!existing, test: who.test };
}

/**
 * Unsubscribes the address from this company: it goes on the suppression list (so it is never emailed again) and the
 * contact, if there is one, is marked as having withdrawn consent. Idempotent: doing it twice is the same as once.
 * One transaction. A test link does nothing at all.
 */
export async function performUnsubscribe(db: Database, key: string, token: string): Promise<UnsubscribeResultDto> {
  const { who, companyName } = await open(db, key, token);
  if (who.test) return { unsubscribed: false, test: true, companyName };
  await db.transaction(async (tx) => {
    await tx
      .insert(suppressions)
      .values({ userId: who.userId, email: who.email, normalizedEmail: who.email, reason: "Unsubscribed", campaignId: who.campaignId })
      .onConflictDoNothing();
    await tx
      .update(contacts)
      .set({ consentStatus: "Withdrawn", consentSource: "Unsubscribe link" })
      .where(and(eq(contacts.userId, who.userId), eq(contacts.normalizedEmail, who.email)));
  });
  console.log(JSON.stringify({ level: "info", event: "unsubscribed", userId: who.userId }));
  return { unsubscribed: true, test: false, companyName };
}
