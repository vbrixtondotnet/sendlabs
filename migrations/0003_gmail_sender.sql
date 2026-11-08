CREATE TABLE `oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state_hash` text NOT NULL,
	`code_verifier_encrypted` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`user_id`) REFERENCES `users`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_states_hash_uq` ON `oauth_states` (`state_hash`);--> statement-breakpoint
CREATE INDEX `oauth_states_expires_idx` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sender_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text DEFAULT 'gmail' NOT NULL,
	`email` text NOT NULL,
	`normalized_email` text NOT NULL,
	`status` text DEFAULT 'Connected' NOT NULL,
	`refresh_token_encrypted` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`scopes` text NOT NULL,
	`connected_by` text NOT NULL,
	`connected_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`connected_by`) REFERENCES `users`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sender_accounts_provider_chk" CHECK("provider" IN ('gmail')),
	CONSTRAINT "sender_accounts_status_chk" CHECK("status" IN ('Connected', 'NeedsReconnect')),
	CONSTRAINT "sender_accounts_email_chk" CHECK("normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email"))),
	CONSTRAINT "sender_accounts_token_chk" CHECK("refresh_token_encrypted" <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sender_accounts_tenant_uq` ON `sender_accounts` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sender_accounts_tenant_id_uq` ON `sender_accounts` (`tenant_id`,`id`);