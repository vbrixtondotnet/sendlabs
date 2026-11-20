import type { CampaignDto, LaunchResultDto } from "../../shared/api";
import { EMAIL_FOOTER_ENABLED, isBlankHtml, unknownTags } from "../../shared/merge";
import { isCampaignEditable } from "../../shared/status";
import type { Database } from "../database/client";
import { campaignLaunchRepo } from "../database/repositories/campaign-launch";
import { campaignsRepo } from "../database/repositories/campaigns";
import { senderRepo } from "../database/repositories/sender";
import { ApiError, badRequest, conflict, notFound } from "../lib/errors";
import { EmailSendError, type EmailProvider } from "./email-provider";

/** The most people one campaign can have. Far above what the daily drip sends in a sensible time. */
export const MAX_CAMPAIGN_RECIPIENTS = 20_000;

/**
 * Launches a Draft campaign. Everything is checked first, so a launch that is refused changes nothing:
 *  - it is a Draft, with a subject and a message, and no merge field that does not exist;
 *  - the company's postal address is set (it is in the footer of every email, and the law asks for it);
 *  - the email connection works right now (the provider is opened, which refreshes the Gmail token);
 *  - there is someone to send to, once suppressed and withdrawn contacts are left out.
 * Then one recipient row per person is written (Pending, in send order, with their details frozen as they are now), and the
 * campaign becomes Sending, due immediately. The launch sends nothing itself: the scheduled sender does, a little at a time,
 * inside the campaign's daily window and limit. So the request is fast and cannot half-send.
 */
export async function launchCampaign(deps: { db: Database; email: EmailProvider }, tenantId: string, campaignId: string): Promise<LaunchResultDto> {
  const repo = campaignLaunchRepo(deps.db, tenantId);
  const campaign = await repo.campaign(campaignId);
  if (!campaign) throw notFound("Campaign");
  if (!isCampaignEditable(campaign.status)) throw conflict(`Only a draft can be launched, and this campaign is ${campaign.status}`, "CAMPAIGN_NOT_DRAFT", { status: campaign.status });

  const problems: { path: string; message: string }[] = [];
  if (!campaign.subject.trim()) problems.push({ path: "subject", message: "Subject is required" });
  if (isBlankHtml(campaign.htmlBody)) problems.push({ path: "htmlBody", message: "The message is empty" });
  for (const [path, text] of [["subject", campaign.subject], ["htmlBody", campaign.htmlBody], ["signature", campaign.signature]] as const) {
    const unknown = unknownTags(text);
    if (unknown.length > 0) problems.push({ path, message: `Unknown merge field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}` });
  }
  if (problems.length > 0) throw badRequest("The campaign is not ready to launch", problems, "VALIDATION_ERROR");

  // The postal address is only used in the footer, so it is only required while the footer is on.
  if (EMAIL_FOOTER_ENABLED && !(await repo.postalAddress()).trim()) {
    throw conflict("Add your company's postal address in Settings before launching: it goes in the footer of every email", "POSTAL_ADDRESS_REQUIRED");
  }

  try {
    await deps.email.open(tenantId); // throws a clear ApiError when the sender is not set up, disconnected or rejected
  } catch (e) {
    if (e instanceof EmailSendError) throw new ApiError(502, "SENDER_UNAVAILABLE", "The email provider could not be reached. Try again in a moment");
    throw e;
  }

  const audience = await repo.audience(campaign);
  if (audience.recipients.length === 0) {
    throw conflict(audience.excluded > 0 ? "Everyone in this audience is suppressed or has withdrawn consent, so there is no one to send to" : "There is no one to send to: choose contacts, an import or industries", "NO_RECIPIENTS");
  }
  if (audience.recipients.length > MAX_CAMPAIGN_RECIPIENTS) {
    throw conflict(`A campaign can have at most ${MAX_CAMPAIGN_RECIPIENTS.toLocaleString("en-US")} recipients. Choose a smaller audience`, "TOO_MANY_RECIPIENTS");
  }

  await repo.writeRecipients(campaignId, audience.recipients);
  const sender = deps.email.id === "gmail" ? await senderRepo(deps.db, tenantId).get() : null;
  if (!(await repo.start(campaignId, sender?.id ?? null))) {
    throw conflict("This campaign was launched or changed by someone else", "CAMPAIGN_NOT_DRAFT");
  }
  console.log(JSON.stringify({ level: "info", event: "campaign_launched", tenantId, campaignId, recipients: audience.recipients.length, excluded: audience.excluded }));
  const dto: CampaignDto = await campaignsRepo(deps.db, tenantId).get(campaignId);
  return { campaign: dto, recipients: audience.recipients.length, excluded: audience.excluded };
}

/**
 * Sends the recipients that Failed another try. They go back to Pending with their attempts reset, and a campaign that had
 * finished with errors starts sending again. Nothing is sent now; the scheduled sender picks them up in its daily window.
 */
export async function retryFailedRecipients(deps: { db: Database }, tenantId: string, campaignId: string): Promise<CampaignDto> {
  const repo = campaignLaunchRepo(deps.db, tenantId);
  const campaign = await repo.campaign(campaignId);
  if (!campaign) throw notFound("Campaign");
  if (!["CompletedWithErrors", "Sending", "Paused", "Failed"].includes(campaign.status)) {
    throw conflict(`Cannot retry failed emails of a campaign that is ${campaign.status}`, "INVALID_TRANSITION", { status: campaign.status });
  }
  const requeued = await repo.requeueFailed(campaignId);
  if (requeued === 0) throw conflict("No emails failed, so there is nothing to retry", "NOTHING_TO_RETRY");
  if (campaign.status === "CompletedWithErrors") await repo.reopen(campaignId);
  console.log(JSON.stringify({ level: "info", event: "campaign_retry_failed", tenantId, campaignId, requeued }));
  return campaignsRepo(deps.db, tenantId).get(campaignId);
}
