CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`normalized_email` text NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`company_name` text DEFAULT '' NOT NULL,
	`employees` integer,
	`industry` text DEFAULT '' NOT NULL,
	`linkedin_url` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`state` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`annual_revenue` integer,
	`consent_status` text DEFAULT 'Unknown' NOT NULL,
	`consent_source` text,
	`source_import_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "contacts_consent_chk" CHECK("consent_status" IN ('Granted', 'Unknown', 'Withdrawn')),
	CONSTRAINT "contacts_normalized_email_chk" CHECK("normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email"))),
	CONSTRAINT "contacts_employees_chk" CHECK("employees" IS NULL OR "employees" >= 0),
	CONSTRAINT "contacts_revenue_chk" CHECK("annual_revenue" IS NULL OR "annual_revenue" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_normalized_email_uq` ON `contacts` (`normalized_email`);--> statement-breakpoint
CREATE INDEX `contacts_industry_idx` ON `contacts` (`industry`);--> statement-breakpoint
CREATE INDEX `contacts_source_import_idx` ON `contacts` (`source_import_id`);--> statement-breakpoint
CREATE INDEX `contacts_created_at_idx` ON `contacts` (`created_at`);--> statement-breakpoint
CREATE TABLE `campaign_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`contact_id` text,
	`email_snapshot` text NOT NULL,
	`personalization_snapshot` text NOT NULL,
	`sequence` integer NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`skip_reason` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`lease_expires_at` integer,
	`queued_at` integer,
	`accepted_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "campaign_recipients_status_chk" CHECK("status" IN ('Pending', 'Queued', 'Processing', 'Accepted', 'Failed', 'Skipped', 'Cancelled')),
	CONSTRAINT "campaign_recipients_skip_reason_chk" CHECK("skip_reason" IS NULL OR "skip_reason" IN ('Suppressed', 'InvalidEmail', 'Manual')),
	CONSTRAINT "campaign_recipients_skip_consistency_chk" CHECK(("status" = 'Skipped') = ("skip_reason" IS NOT NULL)),
	CONSTRAINT "campaign_recipients_attempts_chk" CHECK("attempt_count" >= 0),
	CONSTRAINT "campaign_recipients_email_chk" CHECK("email_snapshot" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_recipients_campaign_contact_uq` ON `campaign_recipients` (`campaign_id`,`contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_recipients_campaign_sequence_uq` ON `campaign_recipients` (`campaign_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `campaign_recipients_pick_idx` ON `campaign_recipients` (`campaign_id`,`status`,`sequence`);--> statement-breakpoint
CREATE INDEX `campaign_recipients_lease_idx` ON `campaign_recipients` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `campaign_recipients_contact_idx` ON `campaign_recipients` (`contact_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`html_body` text NOT NULL,
	`text_body` text,
	`status` text DEFAULT 'Draft' NOT NULL,
	`sender_account_id` text,
	`created_by` text NOT NULL,
	`daily_limit` integer DEFAULT 500 NOT NULL,
	`send_window_start` text DEFAULT '09:00' NOT NULL,
	`send_window_end` text DEFAULT '17:00' NOT NULL,
	`timezone` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`launched_at` integer,
	`completed_at` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "campaigns_status_chk" CHECK("status" IN ('Draft', 'Queuing', 'Queued', 'Sending', 'Paused', 'Completed', 'CompletedWithErrors', 'Failed', 'Cancelled')),
	CONSTRAINT "campaigns_daily_limit_chk" CHECK("daily_limit" BETWEEN 1 AND 2000),
	CONSTRAINT "campaigns_name_chk" CHECK(length(trim("name")) > 0),
	CONSTRAINT "campaigns_window_chk" CHECK(("send_window_start" GLOB '[01][0-9]:[0-5][0-9]' OR "send_window_start" GLOB '2[0-3]:[0-5][0-9]') AND ("send_window_end" GLOB '[01][0-9]:[0-5][0-9]' OR "send_window_end" GLOB '2[0-3]:[0-5][0-9]') AND "send_window_start" < "send_window_end")
);
--> statement-breakpoint
CREATE INDEX `campaigns_status_idx` ON `campaigns` (`status`);--> statement-breakpoint
CREATE INDEX `campaigns_created_at_idx` ON `campaigns` (`created_at`);--> statement-breakpoint
CREATE INDEX `campaigns_due_idx` ON `campaigns` (`status`,`next_run_at`);