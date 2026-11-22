CREATE TABLE `import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`raw_value` text DEFAULT '' NOT NULL,
	`outcome` text NOT NULL,
	`contact_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "import_rows_outcome_chk" CHECK("outcome" IN ('Created', 'Existing', 'Blank', 'Malformed', 'Duplicate', 'Bad row')),
	CONSTRAINT "import_rows_rejected_unlinked_chk" CHECK("outcome" IN ('Created', 'Existing') OR "contact_id" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_rows_import_row_uq` ON `import_rows` (`import_id`,`row_number`);--> statement-breakpoint
CREATE INDEX `import_rows_import_outcome_idx` ON `import_rows` (`import_id`,`outcome`);--> statement-breakpoint
CREATE INDEX `import_rows_contact_idx` ON `import_rows` (`contact_id`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
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
	CONSTRAINT "imports_status_chk" CHECK("status" IN ('Processing', 'Completed', 'Failed')),
	CONSTRAINT "imports_counts_chk" CHECK("total_rows" >= 0 AND "valid_rows" >= 0 AND "created_contacts" >= 0 AND "existing_contacts" >= 0 AND "valid_rows" <= "total_rows")
);
--> statement-breakpoint
CREATE INDEX `imports_created_at_idx` ON `imports` (`created_at`);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `recipient_import_id` text;