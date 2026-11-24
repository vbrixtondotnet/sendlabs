import type { TestSendResultDto } from "../../shared/api";
import { normalizeEmail } from "../../shared/email";
import { SAMPLE_CONTACT } from "../../shared/merge";
import { buildCampaignEmail } from "./campaign-email";
import type { Database } from "../database/client";
import { campaignsRepo } from "../database/repositories/campaigns";
import { testRecipientsRepo } from "../database/repositories/test-recipients";
import { ApiError } from "../lib/errors";
import { createUnsubscribeToken, unsubscribeLinks } from "../lib/unsubscribe";
import { EmailSendError, type EmailProvider } from "./email-provider";

export interface TestSendDeps {
  db: Database;
  /** Whatever delivers the mail (Gmail today). This code knows nothing about which. */
  email: EmailProvider;
  /** For the unsubscribe links in the message. Null when the server is not set up for them. */
  unsubscribe: { encryptionKey: string; appBaseUrl: string } | null;
}

/** Marks the message as a test, so nobody mistakes it for the real campaign. */
export const TEST_SUBJECT_PREFIX = "[TEST] ";

/**
 * Mails the campaign to EVERY address on the account's test-send allowlist, and to nobody else: the recipients come
 * from the allowlist only, never from the request. It goes through the account's connected Gmail, and never
 * touches the campaign's real recipients or its status. The sender name recipients see is the full name of the user who sends it.
 */
/**
 * The name recipients see as the sender: the full name of the user who sends. A user with no name falls back to the
 * company's, so the From line is never just a bare address.
 */
export const senderNameOf = (t: { senderName: string; companyName: string }): string => t.senderName.trim() || t.companyName;

/** What a test send needs to know about the account: who it is, and the company details its emails carry. */
export interface TestSendAccount {
  userId: string;
  companyName: string;
  /** The full name of the signed-in user who sends the test: the name recipients see on the email. */
  senderName: string;
  postalAddress: string;
}

/**
 * `only` narrows a test to some of the allowlisted addresses (the editor lets you pick). Each must be on the allowlist: an
 * address that is not is refused, never mailed. Without it a test goes to the whole allowlist.
 */
export async function sendTestEmail(deps: TestSendDeps, account: TestSendAccount, campaignId: string, only?: string[]): Promise<TestSendResultDto> {
  const { db, email, unsubscribe } = deps;
  const { userId } = account;
  const campaign = await campaignsRepo(db, userId).get(campaignId); // 404 for a campaign of another account
  const allowed = await testRecipientsRepo(db, userId).emails();
  if (allowed.length === 0) {
    throw new ApiError(409, "NO_TEST_RECIPIENTS", "Add at least one address to the test-send allowlist in Settings first");
  }
  let to = allowed;
  if (only) {
    const wanted = new Set(only.map(normalizeEmail));
    const notAllowed = [...wanted].filter((a) => !allowed.some((x) => normalizeEmail(x) === a));
    if (notAllowed.length > 0) {
      throw new ApiError(400, "NOT_ON_ALLOWLIST", `Not on the test-send allowlist: ${notAllowed.join(", ")}`, [{ path: "to", message: "Only addresses on the test-send allowlist can be mailed" }]);
    }
    to = allowed.filter((x) => wanted.has(normalizeEmail(x)));
  }

  const sent: string[] = [];
  const failed = (e: unknown) => {
    if (e instanceof EmailSendError && (e.kind === "auth" || e.kind === "rate_limit")) {
      return new ApiError(e.kind === "auth" ? 409 : 429, e.kind === "auth" ? "SENDER_RECONNECT" : "GMAIL_RATE_LIMITED", e.userMessage, e.kind === "auth" ? undefined : { sent });
    }
    console.error(JSON.stringify({ level: "error", event: "test_send_failed", userId, provider: email.id, kind: e instanceof EmailSendError ? e.kind : "other", sent: sent.length }));
    return new ApiError(502, "TEST_SEND_FAILED", sent.length ? `The test was sent to ${sent.length} of ${to.length} addresses, then sending failed. Please try again` : "The test email could not be sent. Please try again", { sent });
  };

  // Opening throws an actionable ApiError (not set up, no sender, reconnect), or an EmailSendError if the provider is down.
  const channel = await email.open(userId).catch((e: unknown) => { throw e instanceof EmailSendError ? failed(e) : e; });
  if (!unsubscribe) throw new ApiError(503, "GMAIL_NOT_CONFIGURED", "Email sending is not set up on this server yet");

  try {
    for (const address of to) {
      // Every recipient gets their own unsubscribe link, and so one message each. In a test it is a "test" link: it opens
      // the real page but unsubscribes nobody (the address is on the allowlist, not a contact).
      const token = await createUnsubscribeToken(unsubscribe.encryptionKey, { userId, email: normalizeEmail(address), campaignId: campaign.id, test: true });
      const links = unsubscribeLinks(unsubscribe.appBaseUrl, token);
      // The very email a recipient gets (filled in with a made-up contact, exactly as the editor's preview does, so the tags can
      // be seen working), built by the same function a real send uses.
      await channel.send(
        buildCampaignEmail({
          campaign,
          company: { name: account.companyName, postalAddress: account.postalAddress },
          contact: SAMPLE_CONTACT,
          to: address,
          // The sender's own name first (what Gmail itself shows for the mailbox), then the sending user's, then the company's.
          fromName: channel.fromName || senderNameOf(account),
          unsubscribe: links,
          subjectPrefix: TEST_SUBJECT_PREFIX,
        }),
      );
      sent.push(address);
    }
  } catch (e) {
    throw failed(e);
  }
  return { sent };
}
