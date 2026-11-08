import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  CAMPAIGN_STATUSES,
  RECIPIENT_STATUSES,
  SKIP_REASONS,
  type ContactFields,
} from "../../../shared/types";
import { contacts } from "./contacts";
import { createdAt, idColumn, inList, updatedAt } from "./helpers";

const hhmm = (column: string) =>
  `("${column}" GLOB '[01][0-9]:[0-5][0-9]' OR "${column}" GLOB '2[0-3]:[0-5][0-9]')`;

/**
 * A campaign sends one separate email per recipient, in daily batches (the "drip"):
 * a daily tick takes up to `daily_limit` Pending recipients, in `sequence` order, until none are left.
 * Subject, body and drip settings lock once the campaign leaves Draft (enforced in the service layer).
 */
export const campaigns = sqliteTable(
  "campaigns",
  {
    id: idColumn(),
    name: text("name").notNull(),
    /** May contain merge fields, e.g. {{firstName}}. */
    subject: text("subject").notNull(),
    htmlBody: text("html_body").notNull(),
    /** Null means "derive plain text from the HTML when sending". */
    textBody: text("text_body"),

    status: text("status", { enum: CAMPAIGN_STATUSES }).notNull().default("Draft"),

    /** Becomes a foreign key to `sender_accounts.id` when that table is added. */
    senderAccountId: text("sender_account_id"),
    /** Becomes a foreign key to `users.id` when that table is added. Holds the verified identity for now. */
    createdBy: text("created_by").notNull(),

    /**
     * Who gets the emails: null means every contact, otherwise the people in that import.
     * Resolved into campaign_recipients at launch. A soft reference (no foreign key) because adding
     * one to an existing SQLite table would force a table rebuild, which cascades into recipients.
     * The API checks that the import exists and is Completed.
     */
    recipientImportId: text("recipient_import_id"),

    /* --- daily drip schedule --- */
    dailyLimit: integer("daily_limit").notNull().default(500),
    /** "HH:MM" in `timezone`. */
    sendWindowStart: text("send_window_start").notNull().default("09:00"),
    sendWindowEnd: text("send_window_end").notNull().default("17:00"),
    /** IANA timezone name, e.g. America/Los_Angeles. */
    timezone: text("timezone").notNull().default("America/Los_Angeles"),
    nextRunAt: integer("next_run_at"),
    lastRunAt: integer("last_run_at"),

    launchedAt: integer("launched_at"),
    completedAt: integer("completed_at"),
    archivedAt: integer("archived_at"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("campaigns_status_idx").on(t.status),
    index("campaigns_created_at_idx").on(t.createdAt),
    // Lets the daily tick find due campaigns without scanning.
    index("campaigns_due_idx").on(t.status, t.nextRunAt),
    check("campaigns_status_chk", inList("status", CAMPAIGN_STATUSES)),
    check("campaigns_daily_limit_chk", sql.raw(`"daily_limit" BETWEEN 1 AND 2000`)),
    check("campaigns_name_chk", sql.raw(`length(trim("name")) > 0`)),
    // "HH:MM", 00:00 to 23:59, and the window must end after it starts (zero-padded text compares correctly).
    check("campaigns_window_chk", sql.raw(
      `${hhmm("send_window_start")} AND ${hhmm("send_window_end")} AND "send_window_start" < "send_window_end"`,
    )),
  ],
);

/**
 * One row per (campaign, contact). Created for the whole list at launch, so a lost HTTP request
 * never loses recipient work. Only each day's batch is enqueued.
 */
export const campaignRecipients = sqliteTable(
  "campaign_recipients",
  {
    id: idColumn(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    /**
     * SET NULL (not RESTRICT) so a contact can be erased on request while the campaign keeps its
     * audit trail through the snapshots below.
     */
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),

    /** Normalized address at launch time. Historical campaigns stay auditable if the contact later changes. */
    emailSnapshot: text("email_snapshot").notNull(),
    /** Merge-field values at launch time, so every send is reproducible. */
    personalizationSnapshot: text("personalization_snapshot", { mode: "json" })
      .$type<Partial<ContactFields>>()
      .notNull(),

    /** Stable send order within the campaign (import row order). Drives which recipients each day picks. */
    sequence: integer("sequence").notNull(),

    status: text("status", { enum: RECIPIENT_STATUSES }).notNull().default("Pending"),
    skipReason: text("skip_reason", { enum: SKIP_REASONS }),
    attemptCount: integer("attempt_count").notNull().default(0),
    /** Set when the queue consumer claims the row. An expired lease means the consumer died mid-send. */
    leaseExpiresAt: integer("lease_expires_at"),

    queuedAt: integer("queued_at"),
    /** When Gmail accepted the message. Acceptance is not inbox delivery. */
    acceptedAt: integer("accepted_at"),
    /** Sanitized provider error. Never contains tokens or message content. */
    lastError: text("last_error"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("campaign_recipients_campaign_contact_uq").on(t.campaignId, t.contactId),
    uniqueIndex("campaign_recipients_campaign_sequence_uq").on(t.campaignId, t.sequence),
    // Dashboard counts and the daily "next N Pending in order" query.
    index("campaign_recipients_pick_idx").on(t.campaignId, t.status, t.sequence),
    // Reconciliation: stuck Processing rows with expired leases.
    index("campaign_recipients_lease_idx").on(t.status, t.leaseExpiresAt),
    index("campaign_recipients_contact_idx").on(t.contactId),
    check("campaign_recipients_status_chk", inList("status", RECIPIENT_STATUSES)),
    check("campaign_recipients_skip_reason_chk", sql.raw(
      `"skip_reason" IS NULL OR "skip_reason" IN (${SKIP_REASONS.map((r) => `'${r}'`).join(", ")})`,
    )),
    // A skip reason belongs to Skipped rows only, and every Skipped row has one.
    check("campaign_recipients_skip_consistency_chk", sql.raw(
      `("status" = 'Skipped') = ("skip_reason" IS NOT NULL)`,
    )),
    check("campaign_recipients_attempts_chk", sql.raw(`"attempt_count" >= 0`)),
    check("campaign_recipients_email_chk", sql.raw(`"email_snapshot" <> ''`)),
  ],
);

export type CampaignRow = typeof campaigns.$inferSelect;
export type NewCampaignRow = typeof campaigns.$inferInsert;
export type CampaignRecipientRow = typeof campaignRecipients.$inferSelect;
export type NewCampaignRecipientRow = typeof campaignRecipients.$inferInsert;
