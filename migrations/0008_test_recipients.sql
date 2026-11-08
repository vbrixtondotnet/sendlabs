CREATE TABLE `test_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`normalized_email` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`created_by`) REFERENCES `users`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "test_recipients_email_chk" CHECK("normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email"))),
	CONSTRAINT "test_recipients_len_chk" CHECK(length("email") <= 320)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_recipients_tenant_email_uq` ON `test_recipients` (`tenant_id`,`normalized_email`);