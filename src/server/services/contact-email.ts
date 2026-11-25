import { and, eq, gt, sql } from "drizzle-orm";
import type { ContactEmailDto } from "../../shared/api";
import { CONTACT_LOOKUP_COST } from "../../shared/credits";
import type { Database } from "../database/client";
import { contactLookups, creditTransactions, users } from "../database/schema";
import { ApiError } from "../lib/errors";
import { nowMs } from "../lib/id";
import { pickBest, type HunterService } from "./hunter";

const REASON = "job_contact_lookup";
/** An address is kept this long; "none found" a day, so a company with no result is not searched again at once. */
export const FOUND_TTL_MS = 30 * 24 * 60 * 60_000;
export const NOT_FOUND_TTL_MS = 24 * 60 * 60_000;
/** The same account asking for the same company again within this time is not charged twice. */
export const PAID_WINDOW_MS = FOUND_TTL_MS;

/** The company name as a cache key: lower-case, single spaces. */
export const cacheKeyOf = (company: string): string => company.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * "Get Email Address": finds the contact email of the company behind a job with Hunter.io, and charges CONTACT_LOOKUP_COST credits
 * when (and only when) one is found.
 *
 *  1. No key -> 503 NOT_CONFIGURED, nothing charged.
 *  2. The answer for this company is taken from the cache when it is fresh, else Hunter is asked (and the answer remembered).
 *  3. Nothing found -> 404 NO_EMAIL, nothing charged.
 *  4. Found -> one transaction: the account's lock for this company (so two clicks at once cannot both charge), a check that this account did
 *     not already pay for this company in the last 30 days, then one conditional UPDATE (`credits >= cost`) so the balance can never go
 *     below zero, and a ledger row. Not enough credits -> 402 and nothing changes.
 */
export async function findContactEmail(db: Database, hunter: HunterService | null, who: { userId: string }, companyName: string, now: () => number = nowMs): Promise<ContactEmailDto> {
  if (!hunter) throw new ApiError(503, "NOT_CONFIGURED", "Finding email addresses is not set up on this server yet");
  const key = cacheKeyOf(companyName);
  if (key === "") throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", [{ path: "companyName", message: "A company name is required" }]);

  let [hit] = await db.select().from(contactLookups).where(and(eq(contactLookups.cacheKey, key), gt(contactLookups.expiresAt, now()))).limit(1);
  if (!hit) {
    const best = pickBest(await hunter.search(companyName.trim()));
    const row = {
      cacheKey: key,
      companyName: companyName.trim(),
      email: best?.email ?? null,
      name: best?.name ?? "",
      position: best?.position ?? "",
      confidence: best?.confidence ?? null,
      lookedUpAt: now(),
      expiresAt: now() + (best ? FOUND_TTL_MS : NOT_FOUND_TTL_MS),
    };
    [hit] = await db.insert(contactLookups).values(row).onConflictDoUpdate({ target: contactLookups.cacheKey, set: row }).returning();
  }
  if (!hit?.email) throw new ApiError(404, "NO_EMAIL", `No email address was found for ${companyName.trim()}`);
  const found = hit;
  const email = hit.email;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${who.userId}|${REASON}|${key}`}))`);
    const [paid] = await tx
      .select({ id: creditTransactions.id })
      .from(creditTransactions)
      .where(and(eq(creditTransactions.userId, who.userId), eq(creditTransactions.reason, REASON), eq(creditTransactions.note, key), gt(creditTransactions.createdAt, now() - PAID_WINDOW_MS)))
      .limit(1);
    const result = { email, name: found.name, position: found.position, confidence: found.confidence ?? 0 };
    if (paid) {
      const [me] = await tx.select({ credits: users.credits }).from(users).where(eq(users.id, who.userId)).limit(1);
      return { ...result, charged: false, credits: me?.credits ?? 0 };
    }
    const [updated] = await tx
      .update(users)
      .set({ credits: sql`${users.credits} - ${CONTACT_LOOKUP_COST}`, updatedAt: now() })
      .where(and(eq(users.id, who.userId), sql`${users.credits} >= ${CONTACT_LOOKUP_COST}`))
      .returning({ credits: users.credits });
    if (!updated) throw new ApiError(402, "INSUFFICIENT_CREDITS", `You need ${CONTACT_LOOKUP_COST} credits to get an email address.`);
    await tx.insert(creditTransactions).values({ userId: who.userId, delta: -CONTACT_LOOKUP_COST, balanceAfter: updated.credits, reason: REASON, note: key, createdAt: now() });
    return { ...result, charged: true, credits: updated.credits };
  });
}
