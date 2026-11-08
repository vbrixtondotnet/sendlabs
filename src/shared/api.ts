/** Shapes returned by the API. Timestamps are ISO-8601 strings (the database stores UTC milliseconds). */
import type {
  CampaignStatus,
  ConsentStatus,
  ContactFields,
  ImportRowOutcome,
  ImportStatus,
  RecipientStatus,
  SkipReason,
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
  status: CampaignStatus;
  senderAccountId: string | null;
  /** null = every contact, otherwise the people in that import. */
  recipientImportId: string | null;
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
export type CampaignSummaryDto = Omit<CampaignDto, "htmlBody" | "textBody">;

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
