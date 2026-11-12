/**
 * The access levels (roles) a user can hold. This is the catalog stored in the `access` table, seeded by
 * a migration with exactly these ids. Authorization code keys off `name`.
 */
export const ACCESS_LEVELS = [
  {
    id: "administrator",
    name: "Administrator",
    sortOrder: 1,
    description: "Full access: manages users and settings, imports contacts, and builds, launches and cancels campaigns.",
  },
  {
    id: "campaign-manager",
    name: "Campaign Manager",
    sortOrder: 2,
    description: "Imports contacts and manages contacts and campaigns, including test sends and launching. Cannot manage users or settings.",
  },
  {
    id: "viewer",
    name: "Viewer",
    sortOrder: 3,
    description: "Read-only access to contacts, campaigns and reports.",
  },
] as const;
export type TenantRole = (typeof ACCESS_LEVELS)[number]["name"];
/** The access levels a tenant can give its users (the ones in ACCESS_LEVELS). */
export type AccessId = (typeof ACCESS_LEVELS)[number]["id"];

/**
 * The SuperAdministrator: a global user of the platform itself, not tied to any tenant (`users.tenant_id` is NULL).
 * Deliberately NOT in ACCESS_LEVELS: a tenant can never invite someone as one, and the role pickers never list it.
 * It is in the `access` table (reference data, seeded by a migration) so a user can hold it.
 */
export const SUPER_ADMINISTRATOR = {
  id: "super-administrator",
  name: "SuperAdministrator",
  sortOrder: 0,
  description: "Platform-wide access, not tied to any tenant. Manages what every tenant shares, such as the Available Templates.",
} as const;

/** Every access level a signed-in user can hold. */
export type Role = TenantRole | typeof SUPER_ADMINISTRATOR.name;

/** A tenant is one customer organization. Everything it owns is invisible to every other tenant. */
export const TENANT_STATUSES = ["Active", "Suspended"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const USER_STATUSES = ["Active", "Disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

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

/** Why an address is on the suppression list (never emailed). Only unsubscribing exists so far. */
export const SUPPRESSION_REASONS = ["Unsubscribed"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

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

/**
 * An invitation to join a tenant. Pending until the person accepts it. Revoked by an Administrator, or replaced
 * by a newer invitation to the same address. Expired once past its date without being accepted.
 */
export const INVITATION_STATUSES = ["Pending", "Accepted", "Revoked", "Expired"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** A tenant's connected email account. Only Gmail exists so far. */
export const SENDER_PROVIDERS = ["gmail"] as const;
export type SenderProvider = (typeof SENDER_PROVIDERS)[number];

/**
 * Connected: tokens work. NeedsReconnect: Google rejected the stored token (revoked, expired in testing
 * mode, password changed), so the tenant must connect again before anything can be sent.
 */
export const SENDER_STATUSES = ["Connected", "NeedsReconnect"] as const;
export type SenderStatus = (typeof SENDER_STATUSES)[number];

/**
 * Why a Gmail connection attempt failed. The OAuth callback redirects the browser back to the app with one
 * of these codes (never a free-text message), and the UI maps each to a plain explanation.
 */
export const SENDER_CONNECT_ERRORS = [
  "denied", // the user pressed Cancel, or refused on Google's screen
  "invalid_state", // expired, already used, or not one we issued
  "exchange_failed", // Google would not swap the code for tokens
  "missing_permission", // consent was granted, but the permission to send email was left unticked
  "no_refresh_token", // Google issued no long-lived token, so we could not stay connected
  "email_unavailable", // could not read a verified email address for the account
  "not_configured", // this server has no Google credentials
  "inactive", // the tenant or user is not active
] as const;
export type SenderConnectError = (typeof SENDER_CONNECT_ERRORS)[number];

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
