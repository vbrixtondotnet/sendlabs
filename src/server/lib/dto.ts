import type { CampaignDto, CampaignSummaryDto, ContactDto, ImportDto, ImportRowDto, RecipientDto, RecipientTotals, UserDto } from "../../shared/api";
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
export type CampaignSummaryRow = Omit<CampaignRow, "htmlBody" | "textBody" | "signature">;

/** `createdByEmail`: the creator is stored as a user id, but the API shows who they are. */
export function toCampaignSummaryDto(r: CampaignSummaryRow, totals: RecipientTotals, createdByEmail: string): CampaignSummaryDto {
  return {
    id: r.id,
    name: r.name,
    subject: r.subject,
    status: r.status,
    senderAccountId: r.senderAccountId,
    recipientImportId: r.recipientImportId,
    createdBy: createdByEmail,
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

export const toCampaignDto = (r: CampaignRow, totals: RecipientTotals, createdByEmail: string): CampaignDto => ({
  ...toCampaignSummaryDto(r, totals, createdByEmail),
  htmlBody: r.htmlBody,
  textBody: r.textBody,
  signature: r.signature,
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

export function toImportDto(r: ImportRow, createdByEmail: string): ImportDto {
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
    createdBy: createdByEmail,
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

/** The columns a user listing reads. Listing never selects the password hash, so it cannot leak by mistake. */
export interface UserListRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  position: string;
  displayName: string;
  accessId: UserDto["accessId"];
  accessName: UserDto["access"];
  status: UserDto["status"];
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  createdAt: number;
}

export const toUserDto = (r: UserListRow): UserDto => ({
  id: r.id,
  email: r.email,
  firstName: r.firstName,
  lastName: r.lastName,
  position: r.position,
  displayName: r.displayName,
  access: r.accessName,
  accessId: r.accessId,
  status: r.status,
  mustChangePassword: r.mustChangePassword,
  lastLoginAt: isoOrNull(r.lastLoginAt),
  createdAt: iso(r.createdAt),
});
