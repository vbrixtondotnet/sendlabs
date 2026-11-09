ALTER TABLE `tenants` ADD `require_unsubscribe_link` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `one_click_unsubscribe` integer DEFAULT true NOT NULL;