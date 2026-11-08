ALTER TABLE `users` ADD `is_deleted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_at` integer;