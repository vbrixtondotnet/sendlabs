import type { ContactFields } from "../../shared/types";
import { composeEmailHtml, footerFor, LIST_UNSUBSCRIBE_HEADERS_ENABLED, renderTemplate, textFromHtml } from "../../shared/merge";
import type { OutgoingEmail } from "./email-provider";

/**
 * Builds the one email a campaign sends to one person. A campaign's test send and its real send both call this, so a test
 * email is exactly what a recipient gets (apart from the sample contact and the "[TEST]" subject).
 *
 *   subject    the campaign's subject with merge fields filled in
 *   html/text  body, signature, then (while EMAIL_FOOTER_ENABLED) the standard unsubscribe footer and the postal address, merge fields filled in; the text
 *              part is made from the same message, and a plain-text campaign sends only that
 *   headers    List-Unsubscribe and the one-click marker only while LIST_UNSUBSCRIBE_HEADERS_ENABLED (off: like a one-to-one email)
 */
export function buildCampaignEmail(input: {
  campaign: { subject: string; htmlBody: string; signature: string; plainText: boolean };
  tenant: { name: string; postalAddress: string };
  contact: Partial<ContactFields>;
  to: string;
  fromName: string;
  /** The address a person opens from the link in the email, and the one a mail app POSTs to for one-click unsubscribe. */
  unsubscribe: { page: string; oneClick: string };
  subjectPrefix?: string;
}): OutgoingEmail {
  const { campaign, tenant, contact, unsubscribe } = input;
  const html = composeEmailHtml(
    { body: campaign.htmlBody, signature: campaign.signature, ...footerFor(tenant) },
    contact,
    unsubscribe.page,
  );
  return {
    fromName: input.fromName,
    to: input.to,
    subject: `${input.subjectPrefix ?? ""}${renderTemplate(campaign.subject, contact, false, undefined, tenant.name)}`,
    text: textFromHtml(html),
    ...(campaign.plainText ? {} : { html }),
    ...(LIST_UNSUBSCRIBE_HEADERS_ENABLED ? { listUnsubscribe: { url: unsubscribe.oneClick, oneClick: true } } : {}),
  };
}
