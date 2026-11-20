CREATE TABLE `personal_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`recipient` text NOT NULL,
	`normalized_recipient` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`sent_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`sent_by`) REFERENCES `users`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "personal_emails_recipient_chk" CHECK("normalized_recipient" <> '' AND "normalized_recipient" = lower(trim("normalized_recipient"))),
	CONSTRAINT "personal_emails_body_chk" CHECK(length(trim("body")) > 0 AND length(trim("subject")) > 0)
);
--> statement-breakpoint
CREATE INDEX `personal_emails_tenant_created_idx` ON `personal_emails` (`tenant_id`,`created_at`);