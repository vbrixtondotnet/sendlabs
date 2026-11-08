import type { CampaignDto, CampaignSummaryDto, ContactDto, ImportDto, ImportRowDto, RecipientDto, RecipientTotals } from "../../shared/api";
import { RECIPIENT_STATUSES } from "../../shared/types";
import type { CampaignRecipientRow, CampaignRow } from "../database/schema/campaigns";
import type { ContactRow } from "../database/schema/contacts";
import type { ImportRow, ImportRowRow } from "../database/schema/imports";
import { iso, isoOrNull } from "./http";

export const emptyTotals = (): RecipientTotals =>
  Object.fromEntries(RECIPIENT_STATUSES.map((s) => [s, 0])) as RecipientTotals;

export function toContactDto(r: ContactRow): ContactDto {
  return {
    id: r.id,
    // `email` as entered is kept in the database for audit. The API exposes the normalized address.
    email: r.normalizedEmail,
    firstName: r.firstName,
    lastName: r.lastName,
    title: r.title,
    companyName: r.companyName,
    employees: r.employees,
    industry: r.industry,
    linkedinUrl: r.linkedinUrl,
    website: r.website,
    city: r.city,
    state: r.state,
    country: r.country,
    annualRevenue: r.annualRevenue,
    consentStatus: r.consentStatus,
    consentSource: r.consentSource,
    sourceImportId: r.sourceImportId,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

/** List queries skip the (potentially large) bodies, so the summary mapper does not need them. */
export type CampaignSummaryRow = Omit<CampaignRow, "htmlBody" | "textBody">;

export function toCampaignSummaryDto(r: CampaignSummaryRow, totals: RecipientTotals): CampaignSummaryDto {
  return {
    id: r.id,
    name: r.name,
    subject: r.subject,
    status: r.status,
    senderAccountId: r.senderAccountId,
    recipientImportId: r.recipientImportId,
    createdBy: r.createdBy,
    dailyLimit: r.dailyLimit,
    sendWindowStart: r.sendWindowStart,
    sendWindowEnd: r.sendWindowEnd,
    timezone: r.timezone,
    nextRunAt: isoOrNull(r.nextRunAt),
    lastRunAt: isoOrNull(r.lastRunAt),
    launchedAt: isoOrNull(r.launchedAt),
    completedAt: isoOrNull(r.completedAt),
    archivedAt: isoOrNull(r.archivedAt),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    totals,
  };
}

export const toCampaignDto = (r: CampaignRow, totals: RecipientTotals): CampaignDto => ({
  ...toCampaignSummaryDto(r, totals),
  htmlBody: r.htmlBody,
  textBody: r.textBody,
});

export function toRecipientDto(r: CampaignRecipientRow): RecipientDto {
  return {
    id: r.id,
    campaignId: r.campaignId,
    contactId: r.contactId,
    email: r.emailSnapshot,
    personalization: r.personalizationSnapshot,
    sequence: r.sequence,
    status: r.status,
    skipReason: r.skipReason,
    attemptCount: r.attemptCount,
    queuedAt: isoOrNull(r.queuedAt),
    acceptedAt: isoOrNull(r.acceptedAt),
    lastError: r.lastError,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function toImportDto(r: ImportRow): ImportDto {
  return {
    id: r.id,
    filename: r.filename,
    fileSize: r.fileSize,
    status: r.status,
    columnMapping: r.columnMapping,
    totalRows: r.totalRows,
    validRows: r.validRows,
    createdContacts: r.createdContacts,
    existingContacts: r.existingContacts,
    counts: { malformed: r.malformedRows, badRow: r.badRows, duplicate: r.duplicateRows, blank: r.blankRows },
    rejectedRows: r.malformedRows + r.badRows + r.duplicateRows + r.blankRows,
    numericWarnings: r.numericWarnings,
    error: r.error,
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt),
    completedAt: isoOrNull(r.completedAt),
  };
}

export const toImportRowDto = (r: ImportRowRow): ImportRowDto => ({
  rowNumber: r.rowNumber,
  value: r.rawValue,
  outcome: r.outcome,
  contactId: r.contactId,
});
