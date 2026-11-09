CREATE TABLE `suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`normalized_email` text NOT NULL,
	`reason` text DEFAULT 'Unsubscribed' NOT NULL,
	`campaign_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`campaign_id`) REFERENCES `campaigns`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "suppressions_reason_chk" CHECK("reason" IN ('Unsubscribed')),
	CONSTRAINT "suppressions_email_chk" CHECK("normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppressions_tenant_email_uq` ON `suppressions` (`tenant_id`,`normalized_email`);--> statement-breakpoint
ALTER TABLE `campaigns` DROP COLUMN `footer`;