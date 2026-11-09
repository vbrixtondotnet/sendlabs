import type { TestSendResultDto } from "../../shared/api";
import { normalizeEmail } from "../../shared/email";
import { composeEmailHtml, renderTemplate, SAMPLE_CONTACT } from "../../shared/merge";
import type { Database } from "../database/client";
import { campaignsRepo } from "../database/repositories/campaigns";
import { senderRepo } from "../database/repositories/sender";
import { testRecipientsRepo } from "../database/repositories/test-recipients";
import { decryptSecret } from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { buildMime, toBase64Url } from "../lib/mime";
import { createUnsubscribeToken, unsubscribeLinks } from "../lib/unsubscribe";
import { GmailSendError, GoogleError, type GoogleConfig, type GoogleOAuth } from "./google-oauth";

export interface TestSendDeps {
  db: Database;
  google: GoogleOAuth;
  cfg: GoogleConfig | null;
}

/** Marks the message as a test, so nobody mistakes it for the real campaign. */
export const TEST_SUBJECT_PREFIX = "[TEST] ";

/** Plain text for the text part when the campaign has none: tags dropped, links kept, entities for the few that matter. */
export function textFromHtml(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Mails the campaign to EVERY address on the tenant's test-send allowlist, and to nobody else: the recipients come
 * from the allowlist only, never from the request. It goes through the tenant's connected Gmail account, and never
 * touches the campaign's real recipients or its status. The sender name recipients see is the full name of the user who sends it.
 */
/**
 * The name recipients see as the sender: the full name of the user who sends. A user with no name falls back to the
 * company's, so the From line is never just a bare address.
 */
export const senderNameOf = (t: { senderName: string; tenantName: string }): string => t.senderName.trim() || t.tenantName;

/** What a test send needs to know about the organization: who it is, and its compliance settings. */
export interface TestSendTenant {
  tenantId: string;
  tenantName: string;
  /** The full name of the signed-in user who sends the test: the name recipients see on the email. */
  senderName: string;
  postalAddress: string;
  requireUnsubscribeLink: boolean;
  oneClickUnsubscribe: boolean;
}

export async function sendTestEmail(deps: TestSendDeps, tenant: TestSendTenant, campaignId: string): Promise<TestSendResultDto> {
  const { db, google, cfg } = deps;
  const { tenantId } = tenant;
  const campaign = await campaignsRepo(db, tenantId).get(campaignId); // 404 for a campaign of another tenant
  const to = await testRecipientsRepo(db, tenantId).emails();
  if (to.length === 0) {
    throw new ApiError(409, "NO_TEST_RECIPIENTS", "Add at least one address to the test-send allowlist in Settings first");
  }

  if (!cfg) throw new ApiError(503, "GMAIL_NOT_CONFIGURED", "Gmail connection is not set up on this server yet");
  const senders = senderRepo(db, tenantId);
  const sender = await senders.get();
  if (!sender) throw new ApiError(409, "SENDER_REQUIRED", "Connect a Gmail account in Settings before sending a test");
  if (sender.status !== "Connected") throw new ApiError(409, "SENDER_RECONNECT", "Reconnect your Gmail account in Settings before sending a test");

  const reconnect = async () => {
    await senders.markNeedsReconnect();
    return new ApiError(409, "SENDER_RECONNECT", "Google no longer accepts your Gmail connection. Reconnect it in Settings, then try again");
  };

  let refreshToken: string;
  try {
    refreshToken = await decryptSecret(sender.refreshTokenEncrypted, cfg.encryptionKey, `sender-refresh-token:${tenantId}`);
  } catch {
    throw await reconnect();
  }

  // Filled in with a made-up contact, exactly as the editor's preview does, so the tags can be seen working.
  const subject = `${TEST_SUBJECT_PREFIX}${renderTemplate(campaign.subject, SAMPLE_CONTACT, false)}`;
  const sent: string[] = [];
  try {
    const accessToken = await google.refreshAccessToken(cfg, refreshToken);
    for (const address of to) {
      // Every recipient gets their own unsubscribe link, and so one message each. In a test it is a "test" link: it opens
      // the real page but unsubscribes nobody (the address is on the allowlist, not a contact).
      const token = await createUnsubscribeToken(cfg.encryptionKey, { tenantId, email: normalizeEmail(address), campaignId: campaign.id, test: true });
      const links = unsubscribeLinks(cfg.appBaseUrl, token);
      // Body, signature, the standard footer, then the postal address, filled in. The plain-text part is always made from
      // the HTML, so both say the same.
      const html = composeEmailHtml(
        { body: campaign.htmlBody, signature: campaign.signature, companyName: tenant.tenantName, postalAddress: tenant.postalAddress, unsubscribeFooter: tenant.requireUnsubscribeLink },
        SAMPLE_CONTACT,
        links.page,
      );
      const text = textFromHtml(html);
      await google.sendMessage(
        accessToken,
        toBase64Url(buildMime({ from: sender.email, fromName: senderNameOf(tenant), to: address, subject, text, html, ...(tenant.oneClickUnsubscribe ? { listUnsubscribe: { url: links.oneClick, oneClick: true } } : {}) })),
      );
      sent.push(address);
    }
  } catch (e) {
    if (e instanceof GoogleError && e.googleCode === "invalid_grant") throw await reconnect();
    if (e instanceof GmailSendError && e.kind === "auth") throw await reconnect();
    if (e instanceof GmailSendError && e.kind === "rate_limit") {
      throw new ApiError(429, "GMAIL_RATE_LIMITED", "Gmail is limiting sending from this account right now. Try again later", { sent });
    }
    console.error(JSON.stringify({ level: "error", event: "test_send_failed", tenantId, kind: e instanceof GmailSendError ? e.kind : "other", sent: sent.length }));
    throw new ApiError(502, "TEST_SEND_FAILED", sent.length ? `The test was sent to ${sent.length} of ${to.length} addresses, then Gmail failed. Please try again` : "The test email could not be sent. Please try again", { sent });
  }
  return { sent };
}
