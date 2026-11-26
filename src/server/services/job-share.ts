import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { JobDescriptionBlock, JobDto, ShareConfirmDto, ShareStartDto, SharedJobDto } from "../../shared/api";
import { SHARE_CONFIRM_DELAY_MS, SHARE_DAILY_REWARD_CAP, SHARE_REWARD, type ShareNetwork } from "../../shared/shares";
import type { Database } from "../database/client";
import { creditTransactions, jobShares, users } from "../database/schema";
import { ApiError, notFound } from "../lib/errors";
import { nowMs } from "../lib/id";

const REASON = "social_share";
const DAY_MS = 24 * 3_600_000;

/**
 * The address the public share links start with: `SHARE_BASE_URL` when it is a public https address, else `APP_BASE_URL`. They are separate so
 * the app can run on localhost while the links still point somewhere LinkedIn and Facebook can reach (they cannot open http://localhost).
 */
export function shareBaseUrl(env: { SHARE_BASE_URL?: string | undefined; APP_BASE_URL?: string | undefined }, fallback: string): string {
  const raw = env.SHARE_BASE_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === "https:") return u.origin;
    } catch {
      /* a bad setting falls back to the app address */
    }
  }
  return env.APP_BASE_URL?.trim() || fallback;
}

/** The address people open: <base>/share/<id>. */
export const shareLink = (baseUrl: string, id: string) => `${baseUrl.replace(/\/+$/, "")}/share/${id}`;

/**
 * Starts a share: the person pressed LinkedIn or Facebook on a job. Saves a copy of the job (taken by us from the job sources, never from
 * what the browser sent) so the public link can show it, and remembers when the share window opened. Pressing again for the same job and
 * network reuses the same link; it restarts the delay unless the credit was already given.
 */
export async function startShare(
  db: Database,
  who: { userId: string },
  input: { job: JobDto; blocks: JobDescriptionBlock[]; network: ShareNetwork },
  baseUrl: string,
  now: number = nowMs(),
): Promise<ShareStartDto> {
  const [row] = await db
    .insert(jobShares)
    .values({ userId: who.userId, jobId: input.job.id, network: input.network, snapshot: { job: input.job, blocks: input.blocks }, startedAt: now })
    .onConflictDoUpdate({
      target: [jobShares.userId, jobShares.jobId, jobShares.network],
      set: { snapshot: { job: input.job, blocks: input.blocks }, startedAt: sql`CASE WHEN ${jobShares.rewardedAt} IS NULL THEN ${now} ELSE ${jobShares.startedAt} END` },
    })
    .returning({ id: jobShares.id, rewardedAt: jobShares.rewardedAt });
  return { shareId: row!.id, url: shareLink(baseUrl, row!.id), network: input.network, alreadyRewarded: row!.rewardedAt !== null, confirmAfterMs: SHARE_CONFIRM_DELAY_MS };
}

/**
 * "I've posted it": gives SHARE_REWARD credit, once. All in one transaction: the share row is claimed with a conditional UPDATE (only while
 * `rewarded_at` is empty and the delay has passed), so two clicks at once cannot both pay; the credit and its ledger row follow. Refused when
 * it is too early (409), or the person has had SHARE_DAILY_REWARD_CAP rewards in the last 24 hours (429).
 */
export async function confirmShare(db: Database, who: { userId: string }, shareId: string, now: number = nowMs()): Promise<ShareConfirmDto> {
  return db.transaction(async (tx) => {
    const [share] = await tx.select().from(jobShares).where(and(eq(jobShares.id, shareId), eq(jobShares.userId, who.userId))).limit(1);
    if (!share) throw notFound("Share");
    const balance = async () => (await tx.select({ credits: users.credits }).from(users).where(eq(users.id, who.userId)).limit(1))[0]?.credits ?? 0;
    if (share.rewardedAt !== null) return { rewarded: false, credits: await balance() };

    const waitMs = share.startedAt + SHARE_CONFIRM_DELAY_MS - now;
    if (waitMs > 0) {
      throw new ApiError(409, "SHARE_TOO_EARLY", `Finish posting first. You can confirm in ${Math.ceil(waitMs / 1000)} seconds.`);
    }
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(jobShares)
      .where(and(eq(jobShares.userId, who.userId), isNotNull(jobShares.rewardedAt), gte(jobShares.rewardedAt, now - DAY_MS)));
    if (n >= SHARE_DAILY_REWARD_CAP) {
      throw new ApiError(429, "SHARE_DAILY_LIMIT", `You have earned the most share credits for today (${SHARE_DAILY_REWARD_CAP}). Try again tomorrow.`);
    }

    const [claimed] = await tx
      .update(jobShares)
      .set({ rewardedAt: now })
      .where(and(eq(jobShares.id, shareId), sql`${jobShares.rewardedAt} IS NULL`))
      .returning({ id: jobShares.id });
    if (!claimed) return { rewarded: false, credits: await balance() };

    const [paid] = await tx
      .update(users)
      .set({ credits: sql`${users.credits} + ${SHARE_REWARD}`, updatedAt: now })
      .where(eq(users.id, who.userId))
      .returning({ credits: users.credits });
    await tx.insert(creditTransactions).values({ userId: who.userId, delta: SHARE_REWARD, balanceAfter: paid!.credits, reason: REASON, note: `${share.network}:${share.jobId}` });
    return { rewarded: true, credits: paid!.credits };
  });
}

/** The public page's data: the saved copy of the job. No account details. */
export async function publicShare(db: Database, shareId: string): Promise<SharedJobDto> {
  const [share] = await db.select({ snapshot: jobShares.snapshot }).from(jobShares).where(eq(jobShares.id, shareId)).limit(1);
  if (!share) throw notFound("Shared job");
  return share.snapshot;
}
