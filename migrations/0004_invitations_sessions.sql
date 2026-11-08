CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`normalized_email` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`access_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`invited_by` text NOT NULL,
	`accepted_at` integer,
	`accepted_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`access_id`) REFERENCES `access`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`invited_by`) REFERENCES `users`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`,`accepted_user_id`) REFERENCES `users`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invitations_status_chk" CHECK("status" IN ('Pending', 'Accepted', 'Revoked', 'Expired')),
	CONSTRAINT "invitations_email_chk" CHECK("normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email"))),
	CONSTRAINT "invitations_names_chk" CHECK(length(trim("first_name")) > 0 AND length(trim("last_name")) > 0),
	CONSTRAINT "invitations_token_chk" CHECK("token_hash" <> ''),
	CONSTRAINT "invitations_accepted_chk" CHECK(("status" = 'Accepted') = ("accepted_at" IS NOT NULL AND "accepted_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_uq` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_pending_email_uq` ON `invitations` (`tenant_id`,`normalized_email`) WHERE "invitations"."status" = 'Pending';--> statement-breakpoint
CREATE INDEX `invitations_tenant_status_idx` ON `invitations` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `first_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `last_name` text DEFAULT '' NOT NULL;