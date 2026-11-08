export type Role = "Administrator" | "Campaign Manager" | "Viewer";

/**
 * Enumerations shared by the API, the database schema (as CHECK constraints) and the UI.
 * Add a value here and the schema and types follow. A migration is still required.
 */
export const CAMPAIGN_STATUSES = [
  "Draft",
  "Queuing",
  "Queued",
  "Sending",
  "Paused",
  "Completed",
  "CompletedWithErrors",
  "Failed",
  "Cancelled",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const RECIPIENT_STATUSES = [
  "Pending",
  "Queued",
  "Processing",
  "Accepted",
  "Failed",
  "Skipped",
  "Cancelled",
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const CONSENT_STATUSES = ["Granted", "Unknown", "Withdrawn"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

/** An import is Processing while its rows are written, so a crash leaves a visible, recoverable state. */
export const IMPORT_STATUSES = ["Processing", "Completed", "Failed"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/**
 * What happened to one CSV row. Created/Existing rows link to a contact. The rest were rejected,
 * and are kept (never silently dropped) so they can be reviewed and downloaded.
 */
export const IMPORT_ROW_OUTCOMES = ["Created", "Existing", "Blank", "Malformed", "Duplicate", "Bad row"] as const;
export type ImportRowOutcome = (typeof IMPORT_ROW_OUTCOMES)[number];
export const REJECTED_OUTCOMES = ["Blank", "Malformed", "Duplicate", "Bad row"] as const satisfies readonly ImportRowOutcome[];

/** Why a recipient was Skipped. */
export const SKIP_REASONS = ["Suppressed", "InvalidEmail", "Manual"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Fields of template.csv, normalized. Every contact is keyed by its normalized email. */
export interface ContactFields {
  email: string;
  firstName: string;
  lastName: string;
  title: string;
  companyName: string;
  employees: number | null;
  industry: string;
  linkedinUrl: string;
  website: string;
  city: string;
  state: string;
  country: string;
  annualRevenue: number | null;
}

export interface InvalidRow {
  row: number;
  raw: string;
  reason: "Blank" | "Malformed" | "Duplicate" | "Bad row";
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  lastActive: string;
}

export interface SuppressionEntry {
  email: string;
  reason: "Unsubscribed" | "Bounced" | "Complaint" | "Manual";
  addedAt: string;
}
