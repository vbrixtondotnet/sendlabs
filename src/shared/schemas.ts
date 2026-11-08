/** Request validation shared by the API (authoritative) and the UI (early feedback). */
import { z } from "zod";
import { FIELDS } from "./csv";
import { isValidEmail, normalizeEmail } from "./email";
import { PASSWORD_MAX_LENGTH } from "./password-rules";
import { ACCESS_LEVELS, CAMPAIGN_STATUSES, CONSENT_STATUSES, IMPORT_ROW_OUTCOMES, RECIPIENT_STATUSES, type AccessId } from "./types";

/* ------------------------------ primitives ------------------------------ */

const text = (max: number) => z.string().trim().max(max);

/** Empty, or an http(s) URL. Blocks javascript:, data: and similar schemes that the UI would render as links. */
const httpUrlOrEmpty = (max = 500) =>
  text(max).refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Must be an http(s) URL or empty");

/** Trimmed as entered. The API normalizes it (`normalizeEmail`) for storage and comparison. */
const email = z
  .string()
  .trim()
  .max(320)
  .refine((v) => isValidEmail(normalizeEmail(v)), "Not a valid email address");

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();

export const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------ pagination ------------------------------ */

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof pageQuery>;

/** Empty query-string values ("?q=") count as absent. */
const optionalQuery = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

/* ------------------------------ contacts ------------------------------ */

const contactFields = {
  firstName: text(200).default(""),
  lastName: text(200).default(""),
  title: text(300).default(""),
  companyName: text(300).default(""),
  employees: count.default(null),
  industry: text(200).default(""),
  linkedinUrl: httpUrlOrEmpty().default(""),
  website: httpUrlOrEmpty().default(""),
  city: text(200).default(""),
  state: text(200).default(""),
  country: text(200).default(""),
  annualRevenue: count.default(null),
  consentStatus: z.enum(CONSENT_STATUSES).default("Unknown"),
  consentSource: text(300).nullable().default(null),
};

/** Unknown properties are rejected, so a typo never silently drops data. */
export const contactCreateSchema = z.strictObject({ email, ...contactFields });
export type ContactCreate = z.infer<typeof contactCreateSchema>;

/** PATCH: only the fields present are changed. Defaults do not apply. */
export const contactPatchSchema = z
  .strictObject({
    email,
    firstName: text(200),
    lastName: text(200),
    title: text(300),
    companyName: text(300),
    employees: count,
    industry: text(200),
    linkedinUrl: httpUrlOrEmpty(),
    website: httpUrlOrEmpty(),
    city: text(200),
    state: text(200),
    country: text(200),
    annualRevenue: count,
    consentStatus: z.enum(CONSENT_STATUSES),
    consentSource: text(300).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to change");
export type ContactPatch = z.infer<typeof contactPatchSchema>;

export const contactListQuery = pageQuery.extend({
  q: optionalQuery(z.string().trim().max(100)),
  industry: optionalQuery(z.string().trim().max(200)),
  consent: optionalQuery(z.enum(CONSENT_STATUSES)),
});
export type ContactListQuery = z.infer<typeof contactListQuery>;

/* ------------------------------ campaigns ------------------------------ */

const timeOfDay = z.string().regex(HHMM, "Use 24-hour HH:MM, e.g. 09:00");
const timezone = z.string().max(64).refine(isValidTimeZone, "Unknown IANA timezone");

const campaignFields = {
  name: text(200).min(1, "Name is required"),
  subject: text(300).min(1, "Subject is required"),
  htmlBody: z.string().min(1, "HTML body is required").max(200_000),
  textBody: z.string().max(200_000).nullable(),
  dailyLimit: z.number().int().min(1).max(2000),
  sendWindowStart: timeOfDay,
  sendWindowEnd: timeOfDay,
  timezone,
  /** null = every contact. Otherwise the id of a Completed import. */
  recipientImportId: z.string().min(1).max(64).nullable(),
};

/** The send window must end after it starts. Checked after merging with stored values on PATCH. */
export const windowIsValid = (start: string, end: string): boolean => start < end;

export const campaignCreateSchema = z
  .strictObject({
    ...campaignFields,
    textBody: campaignFields.textBody.default(null),
    dailyLimit: campaignFields.dailyLimit.default(500),
    sendWindowStart: timeOfDay.default("09:00"),
    sendWindowEnd: timeOfDay.default("17:00"),
    timezone: timezone.default("America/Los_Angeles"),
    recipientImportId: campaignFields.recipientImportId.default(null),
  })
  .refine((v) => windowIsValid(v.sendWindowStart, v.sendWindowEnd), {
    message: "The send window must end after it starts",
    path: ["sendWindowEnd"],
  });
export type CampaignCreate = z.infer<typeof campaignCreateSchema>;

/** Status is deliberately absent: it only changes through the action endpoints. */
export const campaignPatchSchema = z
  .strictObject(campaignFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to change");
export type CampaignPatch = z.infer<typeof campaignPatchSchema>;

export const campaignListQuery = pageQuery.extend({
  status: optionalQuery(z.enum(CAMPAIGN_STATUSES)),
  q: optionalQuery(z.string().trim().max(100)),
  archived: z.enum(["exclude", "include", "only"]).default("exclude"),
});
export type CampaignListQuery = z.infer<typeof campaignListQuery>;

export const recipientListQuery = pageQuery.extend({
  status: optionalQuery(z.enum(RECIPIENT_STATUSES)),
  q: optionalQuery(z.string().trim().max(100)),
});
export type RecipientListQuery = z.infer<typeof recipientListQuery>;

/* ------------------------------ imports ------------------------------ */

/** { fieldKey: csvColumnIndex }. Only the known template fields, and Email is required. */
export const importMappingSchema = z
  .strictObject(Object.fromEntries(FIELDS.map((f) => [f.key, z.number().int().min(0).max(999).optional()])))
  .refine((m) => m["email"] !== undefined, { message: "Map the Email column", path: ["email"] });

export const importListQuery = pageQuery;
export const userListQuery = pageQuery;

export const importRowsQuery = pageQuery.extend({
  outcome: optionalQuery(z.enum(IMPORT_ROW_OUTCOMES)),
  /** "rejected" = every outcome that did not become a contact. */
  show: z.enum(["all", "rejected"]).default("all"),
});
export type ImportRowsQuery = z.infer<typeof importRowsQuery>;

/* ------------------------------ invitations ------------------------------ */

const ACCESS_IDS = ACCESS_LEVELS.map((a) => a.id) as unknown as [AccessId, ...AccessId[]];
const personName = (label: string) => z.string().trim().min(1, `${label} is required`).max(100);

/** Who to invite. Unknown properties are rejected, so a tenant or status can never be smuggled in. */
export const invitationCreateSchema = z.strictObject({
  email,
  firstName: personName("First name"),
  lastName: personName("Last name"),
  accessId: z.enum(ACCESS_IDS),
});
export type InvitationCreate = z.infer<typeof invitationCreateSchema>;

/** The invited person's chosen password. Length rules live in password-rules.ts and are applied by the service. */
export const acceptInvitationSchema = z.strictObject({ password: z.string().min(1, "Choose a password").max(PASSWORD_MAX_LENGTH) });

/** Sign-in. Deliberately no length or format rules beyond sanity bounds: the answer to a wrong value is always the same. */
export const loginSchema = z.strictObject({
  email: z.string().trim().min(1, "Enter your email address").max(254),
  password: z.string().min(1, "Enter your password").max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;
