/** Shapes returned by the API. Timestamps are ISO-8601 strings (the database stores UTC milliseconds). */
import type {
  CampaignStatus,
  ConsentStatus,
  ContactFields,
  ImportRowOutcome,
  ImportStatus,
  RecipientStatus,
  Role,
  SenderProvider,
  SenderStatus,
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

/** What launching a campaign did: the campaign (now Sending), how many people will be emailed, and how many were left out. */
export interface LaunchResultDto {
  campaign: CampaignDto;
  recipients: number;
  /** In the audience but not emailed: on the suppression list, or having withdrawn consent. */
  excluded: number;
}

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
  /** Sent as plain text only (no HTML part, no formatting). */
  plainText: boolean;
  /** null = every contact, otherwise the people in that import. */
  recipientImportId: string | null;
  /** When not empty: everyone whose industry is one of these. Never combined with an import. */
  recipientIndustries: string[];
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
  createdAt: string;
  completedAt: string | null;
}

export interface ImportRowDto {
  rowNumber: number;
  value: string;
  outcome: ImportRowOutcome;
  contactId: string | null;
}

/** One row of the shared people directory, as a SuperAdmin manages it (the email is shown in full). */
export interface GlobalContactDto {
  id: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  email: string;
  employeeCount: number | null;
  industry: string;
  website: string;
  city: string;
  state: string;
  country: string;
  updatedAt: string;
}

/** One account, as a SuperAdmin sees it in User Accounts. Never carries password data. */
export interface UserAccountDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  role: Role;
  status: "Active" | "Disabled";
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** The signed-in account: who they are, and the company details they send email as. */
export interface MeDto {
  user: { id: string; role: Role; email: string; /** The address of the profile picture (add nothing: it is a path on this app), or null when none was uploaded. */ avatarUrl: string | null; firstName: string; lastName: string; position: string; displayName: string; mustChangePassword: boolean; /** Credits left. Adding a person from Search People spends them. */ credits: number };
  /** True when signed in through a real session, false for the local development placeholder user. */
  session: boolean;
  /** The account's own company details: the name and address printed in its emails, and its unsubscribe settings. */
  company: { name: string; postalAddress: string; website: string; requireUnsubscribeLink: boolean; oneClickUnsubscribe: boolean };
}

/** The account's connected email account. Never carries a token. */
export interface SenderDto {
  id: string;
  provider: SenderProvider;
  /** The address campaigns are sent from: the one Google reported when the account was connected. */
  email: string;
  status: SenderStatus;
  /** The name recipients see on the From line. Empty when none was set (the sending user's name is used). */
  senderName: string;
  /** What the account allowed, in plain words (e.g. "Send email"). */
  permissions: string[];
  connectedAt: string;
}

/**
 * One person found by the people search (a row of global_contacts). The email address is only included once it has been revealed:
 * that is, when the person is already one of the caller's own contacts (they paid a credit for it, or already had it). Otherwise
 * `email` is null, so it never travels with an ordinary search result.
 */
export interface PersonDto {
  id: string;
  firstName: string;
  lastName: string;
  title: string;
  companyName: string;
  /** Employees at the person's company; null when unknown. */
  employees: number | null;
  industry: string;
  website: string;
  city: string;
  state: string;
  country: string;
  /** The email address, or null while it is not revealed (the person is not one of the caller's contacts yet). */
  email: string | null;
  /** Whether the directory has an email address for this person at all. When false there is nothing to reveal. */
  hasEmail: boolean;
}

export type PeopleSearchDto = Page<PersonDto>;

/** The result of "Add Contact" on a person: they are now (or already were) one of the caller's contacts, with the email revealed. */
/** The contact email found for a job's company. */
export interface ContactEmailDto {
  email: string;
  /** The person, when Hunter knows the name. */
  name: string;
  position: string;
  /** Hunter's confidence, 0 to 100. */
  confidence: number;
  /** True when credits were spent; false when this account already paid for this company recently. */
  charged: boolean;
  /** The caller's credits after this. */
  credits: number;
}

/** "Add to Contacts" on a Hiring Companies card: the company's contact person, now one of the caller's contacts. */
export interface CompanyContactDto {
  /** The contact in the caller's list. */
  contactId: string;
  email: string;
  name: string;
  position: string;
  /** True when a credit was spent; false when the address was already one of the caller's contacts. */
  charged: boolean;
  /** The caller's credits after this. */
  credits: number;
}

export interface AddContactResultDto {
  person: PersonDto;
  /** The contact in the caller's list. */
  contactId: string;
  /** True when a credit was spent; false when the person was already one of the caller's contacts (nothing is charged twice). */
  charged: boolean;
  /** The caller's credits after this. */
  credits: number;
}

/** One job in the Jobs list. The source's description is not included: it is HTML from outside and is never shown. */
export interface JobDto {
  /** The source's name and the job's id there ("remotive:2091177", "arbeitnow:some-slug"), so ids never clash. Jobs are not stored. */
  id: string;
  title: string;
  companyName: string;
  /** The company's logo address (https), or "". */
  companyLogo: string;
  category: string;
  /** "Full-time", "Part-time", "Contract"... */
  employmentType: string;
  /** Can be done remotely. */
  remote: boolean;
  /** Remotive: where the person may work from ("Worldwide", "USA, Canada"). Arbeitnow: where the job is ("Berlin"). May be empty. */
  location: string;
  salary: string;
  skills: string[];
  /** The job's page at its source: where Apply goes. */
  url: string;
  /** The source's name ("Remotive", "Arbeitnow"), which must be shown with the job. */
  source: string;
  /** ISO time the source published it, or null. */
  publishedAt: string | null;
}

/** One piece of a job's description, as plain text: the page draws it with ordinary elements (a description is never shown as markup). */
export type JobDescriptionBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] };

/** What the View Job panel shows besides the job it was opened from. */
export interface JobDescriptionDto {
  id: string;
  blocks: JobDescriptionBlock[];
}

/** A page of jobs, plus the sources that could not be reached for it (the others are still shown). */
export interface JobsPageDto extends Page<JobDto> {
  unavailable: string[];
}

/** One company in the Hiring Companies panel: made from the jobs the current search found, so its count matches the list. */
export interface HiringCompanyDto {
  name: string;
  logo: string;
  /** The category most of its jobs are in. */
  industry: string;
  /** How many of the current search's jobs are this company's. */
  openPositions: number;
  /** A couple of its job titles. */
  sampleTitles: string[];
}

export interface HiringCompaniesDto {
  items: HiringCompanyDto[];
  /** How many companies the search found (the list is cut to the busiest). */
  total: number;
  unavailable: string[];
}

/** One choice of the Job Category filter: Remotive's category, by the value its API takes and the name people read. */
export interface JobCategoryDto {
  value: string;
  label: string;
}

/** A template in My Templates. The body is left out (it is large): fetch one template to get it. */
export interface EmailTemplateSummaryDto {
  id: string;
  name: string;
  /** The id of the Available (system) template this is a copy of, or null for one an Administrator wrote. */
  systemKey: string | null;
  createdAt: string;
}

export interface EmailTemplateDto extends EmailTemplateSummaryDto {
  /** The message body, as HTML. */
  htmlBody: string;
}

/** A system-made template in Available Templates. Shared by every organization. */
export interface AvailableTemplateDto {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
}

/** The result of a campaign's test send: who it went to. */
export interface TestSendResultDto {
  sent: string[];
}

export interface SenderStatusDto {
  /** False when this server has no Google credentials, so connecting is impossible until they are supplied. */
  configured: boolean;
  /** Null when the account has not connected a Gmail address. */
  sender: SenderDto | null;
}

/** Sharing a job (see shared/shares.ts). */
export interface ShareStartDto {
  shareId: string;
  /** The public link to post. */
  url: string;
  network: "linkedin" | "facebook";
  /** True when this job was already shared to this network and rewarded: sharing again earns nothing. */
  alreadyRewarded: boolean;
  /** How long after the share window opened "I've posted it" works. */
  confirmAfterMs: number;
}
export interface ShareConfirmDto {
  /** False when the credit had already been given. */
  rewarded: boolean;
  credits: number;
}
/** What the public page /share/<id> shows: the job and its description, as in the View Job panel. */
export interface SharedJobDto {
  job: JobDto;
  blocks: JobDescriptionBlock[];
}
