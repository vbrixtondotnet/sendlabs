/** Shapes returned by the API. Timestamps are ISO-8601 strings (the database stores UTC milliseconds). */
import type {
  CampaignStatus,
  ConsentStatus,
  ContactFields,
  ImportRowOutcome,
  AccessId,
  ImportStatus,
  InvitationStatus,
  RecipientStatus,
  Role,
  SenderProvider,
  SenderStatus,
  UserStatus,
  SkipReason,
  SuppressionReason,
} from "./types";

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ContactDto extends ContactFields {
  id: string;
  consentStatus: ConsentStatus;
  consentSource: string | null;
  sourceImportId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RecipientTotals = Record<RecipientStatus, number>;

export interface CampaignDto {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  /** The email signature (sign-off), plain text. Empty = none. */
  signature: string;
  status: CampaignStatus;
  senderAccountId: string | null;
  /** null = every contact, otherwise the people in that import. */
  recipientImportId: string | null;
  /** When not empty: everyone whose industry is one of these. Never combined with an import. */
  recipientIndustries: string[];
  createdBy: string;
  dailyLimit: number;
  sendWindowStart: string;
  sendWindowEnd: string;
  timezone: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  launchedAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Recipient counts by status, zero-filled. */
  totals: RecipientTotals;
}

/** Campaign list rows omit the bodies, which can be large. */
export type CampaignSummaryDto = Omit<CampaignDto, "htmlBody" | "textBody" | "signature">;

export interface RecipientDto {
  id: string;
  campaignId: string;
  contactId: string | null;
  email: string;
  personalization: Partial<ContactFields>;
  sequence: number;
  status: RecipientStatus;
  skipReason: SkipReason | null;
  attemptCount: number;
  queuedAt: string | null;
  acceptedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlationId: string;
  };
}

export interface ImportDto {
  id: string;
  filename: string;
  fileSize: number;
  status: ImportStatus;
  /** { fieldKey: csvColumnIndex } as confirmed by the user. */
  columnMapping: Record<string, number>;
  totalRows: number;
  /** Rows with a valid, unique email = createdContacts + existingContacts. */
  validRows: number;
  createdContacts: number;
  /** Valid rows whose contact already existed. Existing contacts are never overwritten. */
  existingContacts: number;
  counts: { malformed: number; badRow: number; duplicate: number; blank: number };
  /** Total rejected rows. They are kept, never silently dropped. */
  rejectedRows: number;
  /** Rows kept, with a non-numeric # Employees / Annual Revenue left blank. */
  numericWarnings: number;
  error: string | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
}

export interface ImportRowDto {
  rowNumber: number;
  value: string;
  outcome: ImportRowOutcome;
  contactId: string | null;
}

/** The signed-in user and the tenant they belong to. */
export interface MeDto {
  user: { id: string; email: string; firstName: string; lastName: string; position: string; displayName: string; access: Role; mustChangePassword: boolean };
  /** True when signed in through a real session (e.g. after accepting an invitation), false for the local development placeholder user. */
  session: boolean;
  tenant: { id: string; name: string; slug: string; postalAddress: string; website: string; requireUnsubscribeLink: boolean; oneClickUnsubscribe: boolean };
}

/** A user of the caller's tenant. Deliberately has no password or hash field. */
export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Job title. Empty when not set. */
  position: string;
  displayName: string;
  access: Role;
  accessId: AccessId;
  status: UserStatus;
  mustChangePassword: boolean;
  /** Null until sign-in exists and the user has signed in. */
  lastLoginAt: string | null;
  createdAt: string;
}

/** The tenant's connected email account. Never carries a token. */
export interface SenderDto {
  id: string;
  provider: SenderProvider;
  /** The address campaigns are sent from: the one Google reported when the account was connected. */
  email: string;
  status: SenderStatus;
  /** What the tenant allowed, in plain words (e.g. "Send email"). */
  permissions: string[];
  /** Email of the user who connected it. */
  connectedBy: string;
  connectedAt: string;
}

/** A template in My Templates. The body is left out (it is large): fetch one template to get it. */
export interface EmailTemplateSummaryDto {
  id: string;
  name: string;
  /** The key of the Available (system) template this is a copy of, or null for one an Administrator wrote. */
  systemKey: string | null;
  createdAt: string;
}

export interface EmailTemplateDto extends EmailTemplateSummaryDto {
  /** The message body, as HTML. */
  htmlBody: string;
}

/** A system-made template in Available Templates. Shared by every organization. */
export interface AvailableTemplateDto {
  key: string;
  name: string;
}

export interface AvailableTemplateFullDto extends AvailableTemplateDto {
  htmlBody: string;
}

/** An address that will never be emailed again (it unsubscribed). */
export interface SuppressionDto {
  id: string;
  email: string;
  reason: SuppressionReason;
  createdAt: string;
}

/** What the public unsubscribe page shows for a valid link. The address is masked: the link is not a login. */
export interface UnsubscribeInfoDto {
  companyName: string;
  /** Like `a***@example.com`. */
  email: string;
  alreadyUnsubscribed: boolean;
  /** The link came from a test email: opening and confirming it changes nothing. */
  test: boolean;
}

export interface UnsubscribeResultDto {
  /** False for a test link, which unsubscribes nobody. */
  unsubscribed: boolean;
  test: boolean;
  companyName: string;
}

/** One address on the test-send allowlist. */
export interface TestRecipientDto {
  id: string;
  email: string;
  /** Who added it (their email). Empty if that user can no longer be found. */
  addedBy: string;
  createdAt: string;
}

/** The result of a campaign's test send: who it went to. */
export interface TestSendResultDto {
  sent: string[];
}

export interface SenderStatusDto {
  /** False when this server has no Google credentials, so connecting is impossible until they are supplied. */
  configured: boolean;
  /** Null when the tenant has not connected an account. */
  sender: SenderDto | null;
}

/** An invitation an Administrator sent. Never carries the link or the token: those exist only in the email. */
export interface InvitationDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Job title the invitation was sent with. Empty when none. */
  position: string;
  access: Role;
  accessId: AccessId;
  /** Pending, or Expired once past its date. Accepted and revoked invitations are not listed. */
  status: Extract<InvitationStatus, "Pending" | "Expired">;
  /** Email of the Administrator who sent it. */
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
}

/** What the invitation page needs to greet the invited person. Returned for a valid, unused, unexpired link only. */
export interface InvitationPreviewDto {
  tenantName: string;
  email: string;
  firstName: string;
  lastName: string;
  access: Role;
  expiresAt: string;
}
