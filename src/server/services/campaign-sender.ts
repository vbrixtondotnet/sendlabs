import { normalizeEmail } from "../../shared/email";
import { dayStartMs, minutesLeftInDay, minutesLeftInWindow, pacedBudget, sameLocalDay } from "../../shared/schedule";
import type { Database } from "../database/client";
import { campaignSendingRepo } from "../database/repositories/campaign-sending";
import { suppressionsRepo } from "../database/repositories/suppressions";
import type { CampaignRow } from "../database/schema";
import { ApiError } from "../lib/errors";
import { createUnsubscribeToken, unsubscribeLinks } from "../lib/unsubscribe";
import { buildCampaignEmail } from "./campaign-email";
import { EmailSendError, type EmailChannel, type EmailProvider } from "./email-provider";

/** How a tick is bounded. A Worker invocation has a limit on outbound requests, and a gentle pace suits mail providers. */
export const MAX_CAMPAIGNS_PER_TICK = 5;
export const MAX_SENDS_PER_CAMPAIGN_PER_TICK = 8;
/** A claimed recipient is Processing for at most this long before it is returned to the pool (the Worker died mid-send). */
const LEASE_MS = 2 * 60_000;
/** A recipient is tried this many times for temporary failures before it is marked Failed. */
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_BACKOFF_MS = 15 * 60_000;
const TRANSIENT_BACKOFF_MS = 2 * 60_000;

export interface TickDeps {
  db: Database;
  email: EmailProvider;
  /** For each recipient's own unsubscribe link. Null when the server is not set up for them: nothing is sent then. */
  unsubscribe: { encryptionKey: string; appBaseUrl: string } | null;
}

export interface TickResult {
  campaigns: number;
  accepted: number;
  skipped: number;
  failed: number;
}

const log = (event: string, fields: Record<string, unknown>) => console.log(JSON.stringify({ level: "info", event, ...fields }));

/**
 * One pass of the sender: serves every campaign that is Sending and due. Safe to run twice at once (every claim is one
 * conditional statement) and safe to miss (the next pass sends the normal amount, never a catch-up burst).
 *
 * For each campaign:
 *  - nothing is sent outside its daily send window, in its timezone, EXCEPT on the day it was launched: "Launch Campaign Now"
 *    starts sending immediately, whatever the time, and that day's allowance is spread over the rest of the local day. The
 *    window applies from the following day on;
 *  - today's remaining allowance (daily limit minus what was accepted today) is spread over what is left of the window, a few
 *    per pass, so mail goes out steadily instead of in one burst;
 *  - each recipient is claimed, checked against the suppression list one more time, sent their own message with their own
 *    unsubscribe link, and recorded as Accepted, Failed or Skipped;
 *  - the campaign is Completed (or CompletedWithErrors) when no recipient is left to send.
 */
export async function runCampaignTick(deps: TickDeps, now: number = Date.now()): Promise<TickResult> {
  const sending = campaignSendingRepo(deps.db);
  const result: TickResult = { campaigns: 0, accepted: 0, skipped: 0, failed: 0 };
  if (!deps.unsubscribe) {
    console.error(JSON.stringify({ level: "error", event: "tick_not_configured" }));
    return result;
  }

  for (const campaign of await sending.due(now, MAX_CAMPAIGNS_PER_TICK)) {
    result.campaigns++;
    try {
      await serveCampaign(deps, deps.unsubscribe, campaign, now, result);
    } catch (e) {
      // One campaign's trouble must not stop the others.
      console.error(JSON.stringify({ level: "error", event: "campaign_tick_failed", campaignId: campaign.id, kind: e instanceof Error ? e.name : "unknown" }));
    }
  }
  return result;
}

async function serveCampaign(deps: TickDeps, unsubscribe: { encryptionKey: string; appBaseUrl: string }, campaign: CampaignRow, now: number, result: TickResult): Promise<void> {
  const sending = campaignSendingRepo(deps.db);
  const { id: campaignId, tenantId } = campaign;

  await sending.reclaimExpired(campaignId, now);

  // Finished? (Everything was already sent, skipped or failed.)
  const before = await sending.progress(campaignId);
  if (before.open === 0) {
    await sending.finish(campaignId, before.failed > 0 ? "CompletedWithErrors" : "Completed", now);
    log("campaign_completed", { campaignId, failed: before.failed });
    return;
  }

  // Outside the send window, or today's allowance is used up: wait for the next pass. The launch day is exempt from the window.
  const launchDay = campaign.launchedAt != null && sameLocalDay(now, campaign.launchedAt, campaign.timezone);
  const minutesLeft = launchDay
    ? minutesLeftInDay(now, campaign.timezone)
    : minutesLeftInWindow(now, campaign.timezone, campaign.sendWindowStart, campaign.sendWindowEnd);
  const sentToday = await sending.acceptedSince(campaignId, dayStartMs(now, campaign.timezone));
  const budget = pacedBudget(campaign.dailyLimit - sentToday, minutesLeft, MAX_SENDS_PER_CAMPAIGN_PER_TICK);
  if (budget <= 0) return;

  const tenant = await sending.tenant(tenantId);
  if (!tenant) return;
  const fromFallback = (await sending.creatorName(tenantId, campaign.createdBy)) || tenant.name;

  let channel: EmailChannel;
  try {
    channel = await deps.email.open(tenantId);
  } catch (e) {
    if (e instanceof EmailSendError) {
      await sending.backoff(campaignId, now + TRANSIENT_BACKOFF_MS, now); // the provider is down: try again shortly
      return;
    }
    if (e instanceof ApiError) {
      // The connection is gone or broken (not set up, disconnected, revoked): stop, and say so on the campaign. Resume restarts it.
      await sending.finish(campaignId, "Failed", now);
      log("campaign_sender_unavailable", { campaignId, code: e.code });
      return;
    }
    throw e;
  }

  await sending.promote(tenantId, campaignId, budget, now);
  const claimed = await sending.claim(tenantId, campaignId, budget, now, LEASE_MS);
  const suppressions = suppressionsRepo(deps.db, tenantId);
  let stop = false;

  for (const r of claimed) {
    if (stop) {
      await sending.retryLater(r.id, "Waiting for the next pass", now); // claimed but not tried: back to the pool, attempt not lost
      continue;
    }
    // The suppression list is checked again right before sending: someone who unsubscribed after launch is skipped.
    if (await suppressions.has(normalizeEmail(r.email))) {
      await sending.skipped(r.id, "Suppressed", now);
      result.skipped++;
      continue;
    }
    try {
      const token = await createUnsubscribeToken(unsubscribe.encryptionKey, { tenantId, email: normalizeEmail(r.email), campaignId, test: false });
      await channel.send(
        buildCampaignEmail({
          campaign,
          tenant,
          contact: r.contact,
          to: r.email,
          fromName: channel.fromName || fromFallback,
          unsubscribe: unsubscribeLinks(unsubscribe.appBaseUrl, token),
        }),
      );
      await sending.accepted(r.id, now);
      result.accepted++;
    } catch (e) {
      const t = now; // the pass has one clock, so what it records and what it counts agree
      if (e instanceof EmailSendError && e.kind === "auth") {
        await sending.retryLater(r.id, "The email connection was rejected", t);
        await sending.finish(campaignId, "Failed", t); // fix the connection, then resume
        log("campaign_sender_rejected", { campaignId });
        stop = true;
      } else if (e instanceof EmailSendError && e.kind === "rate_limit") {
        await sending.retryLater(r.id, "The provider is limiting sending", t);
        await sending.backoff(campaignId, t + RATE_LIMIT_BACKOFF_MS, t);
        stop = true;
      } else if (e instanceof EmailSendError && e.kind === "transient") {
        if (r.attempts >= MAX_ATTEMPTS) {
          await sending.failed(r.id, "The provider kept failing temporarily", t);
          result.failed++;
        } else {
          await sending.retryLater(r.id, "A temporary failure", t);
        }
        await sending.backoff(campaignId, t + TRANSIENT_BACKOFF_MS, t);
        stop = true;
      } else if (e instanceof EmailSendError) {
        await sending.failed(r.id, e.userMessage, t); // refused for this one message: it will not work on retry
        result.failed++;
      } else if (e instanceof Error && /invalid .* address/i.test(e.message)) {
        await sending.skipped(r.id, "InvalidEmail", t);
        result.skipped++;
      } else {
        await sending.failed(r.id, "The message could not be built", t);
        result.failed++;
      }
    }
  }

  const after = await sending.progress(campaignId);
  if (after.open === 0) {
    await sending.finish(campaignId, after.failed > 0 ? "CompletedWithErrors" : "Completed", now);
    log("campaign_completed", { campaignId, failed: after.failed });
  } else {
    await sending.touched(campaignId, now);
  }
}
