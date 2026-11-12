-- My Templates is now just the rows that exist: drop every template that was not picked, then the picking flag itself.
DELETE FROM `email_templates` WHERE `selected` = 0;
--> statement-breakpoint
ALTER TABLE `email_templates` DROP COLUMN `selected`;
