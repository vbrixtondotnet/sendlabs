-- Multi-tenancy: adds tenants, access (roles) and users, and makes contacts, campaigns,
-- campaign_recipients, imports and import_rows belong to a tenant.
--
-- WHY THIS IS NOT A PLAIN DIFF. SQLite cannot add a NOT NULL tenant_id column (or change a UNIQUE key,
-- or add composite foreign keys) to a table that already exists, so the five tenant-owned tables are
-- dropped and recreated. That is only safe while they are empty, so the first statements ABORT THE
-- MIGRATION if any of them holds a row. Nothing is deleted in that case: clear the data on purpose
-- (npm run db:clear:local), or write a data-preserving migration, then run it again.
--
-- The CREATE statements below are the exact output of `drizzle-kit generate` for the current schema,
-- so the schema snapshot in migrations/meta stays truthful.

DROP TABLE IF EXISTS `__tenancy_guard`;
--> statement-breakpoint
CREATE TABLE `__tenancy_guard` (`tables_must_be_empty` integer NOT NULL);
--> statement-breakpoint
INSERT INTO `__tenancy_guard` (`tables_must_be_empty`) SELECT CASE WHEN EXISTS (SELECT 1 FROM `contacts`) OR EXISTS (SELECT 1 FROM `campaigns`) OR EXISTS (SELECT 1 FROM `campaign_recipients`) OR EXISTS (SELECT 1 FROM `imports`) OR EXISTS (SELECT 1 FROM `import_rows`) THEN NULL ELSE 1 END;
--> statement-breakpoint
DROP TABLE `__tenancy_guard`;
--> statement-breakpoint
DROP TABLE `import_rows`;
--> statement-breakpoint
DROP TABLE `campaign_recipients`;
--> statement-breakpoint
DROP TABLE `imports`;
--> statement-breakpoint
DROP TABLE `campaigns`;
--> statement-breakpoint
DROP TABLE `contacts`;
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "tenants_status_chk" CHECK("status" IN ('Active', 'Suspended')),
	CONSTRAINT "tenants_name_chk" CHECK(length(trim("name")) > 0),
	CONSTRAINT "tenants_slug_chk" CHECK("slug" <> '' AND "slug" NOT GLOB '*[^a-z0-9-]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_uq` ON `tenants` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_name_uq` ON `tenants` (lower("name"));--> statement-breakpoint
CREATE TABLE `access` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_name_uq` ON `access` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`normalized_email` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`password_hash` text NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`access_id` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`access_id`) REFERENCES `access`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "users_status_chk" CHECK("status" IN ('Active', 'Disabled')),
	CONSTRAINT "users_normalized_email_chk" CHECK("normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email"))),
	CONSTRAINT "users_password_hash_chk" CHECK("password_hash" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_normalized_email_uq` ON `users` (`normalized_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_tenant_id_uq` ON `users` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `users_access_idx` ON `users` (`access_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
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
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "contacts_consent_chk" CHECK("consent_status" IN ('Granted', 'Unknown', 'Withdrawn')),
	CONSTRAINT "contacts_normalized_email_chk" CHECK("normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email"))),
	CONSTRAINT "contacts_employees_chk" CHECK("employees" IS NULL OR "employees" >= 0),
	CONSTRAINT "contacts_revenue_chk" CHECK("annual_revenue" IS NULL OR "annual_revenue" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_tenant_email_uq` ON `contacts` (`tenant_id`,`normalized_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_tenant_id_uq` ON `contacts` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `contacts_tenant_industry_idx` ON `contacts` (`tenant_id`,`industry`);--> statement-breakpoint
CREATE INDEX `contacts_tenant_source_import_idx` ON `contacts` (`tenant_id`,`source_import_id`);--> statement-breakpoint
CREATE INDEX `contacts_tenant_created_at_idx` ON `contacts` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `campaign_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
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
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`campaign_id`) REFERENCES `campaigns`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`contact_id`) REFERENCES `contacts`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
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
CREATE INDEX `campaign_recipients_contact_idx` ON `campaign_recipients` (`tenant_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`html_body` text NOT NULL,
	`text_body` text,
	`status` text DEFAULT 'Draft' NOT NULL,
	`sender_account_id` text,
	`created_by` text NOT NULL,
	`recipient_import_id` text,
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
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`created_by`) REFERENCES `users`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "campaigns_status_chk" CHECK("status" IN ('Draft', 'Queuing', 'Queued', 'Sending', 'Paused', 'Completed', 'CompletedWithErrors', 'Failed', 'Cancelled')),
	CONSTRAINT "campaigns_daily_limit_chk" CHECK("daily_limit" BETWEEN 1 AND 2000),
	CONSTRAINT "campaigns_name_chk" CHECK(length(trim("name")) > 0),
	CONSTRAINT "campaigns_window_chk" CHECK(("send_window_start" GLOB '[01][0-9]:[0-5][0-9]' OR "send_window_start" GLOB '2[0-3]:[0-5][0-9]') AND ("send_window_end" GLOB '[01][0-9]:[0-5][0-9]' OR "send_window_end" GLOB '2[0-3]:[0-5][0-9]') AND "send_window_start" < "send_window_end")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_tenant_id_uq` ON `campaigns` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `campaigns_tenant_status_idx` ON `campaigns` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `campaigns_tenant_created_at_idx` ON `campaigns` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `campaigns_due_idx` ON `campaigns` (`status`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`import_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`raw_value` text DEFAULT '' NOT NULL,
	`outcome` text NOT NULL,
	`contact_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`import_id`) REFERENCES `imports`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`contact_id`) REFERENCES `contacts`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_rows_outcome_chk" CHECK("outcome" IN ('Created', 'Existing', 'Blank', 'Malformed', 'Duplicate', 'Bad row')),
	CONSTRAINT "import_rows_rejected_unlinked_chk" CHECK("outcome" IN ('Created', 'Existing') OR "contact_id" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_rows_import_row_uq` ON `import_rows` (`import_id`,`row_number`);--> statement-breakpoint
CREATE INDEX `import_rows_import_outcome_idx` ON `import_rows` (`import_id`,`outcome`);--> statement-breakpoint
CREATE INDEX `import_rows_contact_idx` ON `import_rows` (`tenant_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`filename` text NOT NULL,
	`file_size` integer NOT NULL,
	`status` text DEFAULT 'Processing' NOT NULL,
	`column_mapping` text NOT NULL,
	`total_rows` integer NOT NULL,
	`valid_rows` integer DEFAULT 0 NOT NULL,
	`created_contacts` integer DEFAULT 0 NOT NULL,
	`existing_contacts` integer DEFAULT 0 NOT NULL,
	`malformed_rows` integer DEFAULT 0 NOT NULL,
	`bad_rows` integer DEFAULT 0 NOT NULL,
	`duplicate_rows` integer DEFAULT 0 NOT NULL,
	`blank_rows` integer DEFAULT 0 NOT NULL,
	`numeric_warnings` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`created_by`) REFERENCES `users`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "imports_status_chk" CHECK("status" IN ('Processing', 'Completed', 'Failed')),
	CONSTRAINT "imports_counts_chk" CHECK("total_rows" >= 0 AND "valid_rows" >= 0 AND "created_contacts" >= 0 AND "existing_contacts" >= 0 AND "valid_rows" <= "total_rows")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `imports_tenant_id_uq` ON `imports` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `imports_tenant_created_at_idx` ON `imports` (`tenant_id`,`created_at`);
--> statement-breakpoint
-- Reference data: the three access levels. Ids are stable and match ACCESS_LEVELS in src/shared/types.ts.
INSERT INTO `access` (`id`, `name`, `description`, `sort_order`, `created_at`) VALUES
  ('administrator', 'Administrator', 'Full access: manages users and settings, imports contacts, and builds, launches and cancels campaigns.', 1, CAST(strftime('%s', 'now') AS integer) * 1000),
  ('campaign-manager', 'Campaign Manager', 'Imports contacts and manages contacts and campaigns, including test sends and launching. Cannot manage users or settings.', 2, CAST(strftime('%s', 'now') AS integer) * 1000),
  ('viewer', 'Viewer', 'Read-only access to contacts, campaigns and reports.', 3, CAST(strftime('%s', 'now') AS integer) * 1000);
