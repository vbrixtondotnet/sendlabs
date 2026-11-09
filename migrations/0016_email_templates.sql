CREATE TABLE `email_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`builtin_key` text,
	`html_body` text NOT NULL,
	`selected` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`created_by`) REFERENCES `users`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "email_templates_name_chk" CHECK(length(trim("name")) > 0 AND length("name") <= 100),
	CONSTRAINT "email_templates_body_chk" CHECK(length(trim("html_body")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_templates_tenant_name_uq` ON `email_templates` (`tenant_id`,lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `email_templates_tenant_builtin_uq` ON `email_templates` (`tenant_id`,`builtin_key`) WHERE "email_templates"."builtin_key" IS NOT NULL;