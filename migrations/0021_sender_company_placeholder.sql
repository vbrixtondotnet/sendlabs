-- The system templates named "Sabertooth Software Labs" as the sender. They now use the {{senderCompany}} merge field, which
-- becomes the sending organization's own company name. Unedited copies in My Templates (builtin_key set) change with them;
-- templates an organization wrote itself are left alone.
UPDATE `system_templates` SET `html_body` = REPLACE(`html_body`, 'Sabertooth Software Labs', '{{senderCompany}}') WHERE `html_body` LIKE '%Sabertooth Software Labs%';--> statement-breakpoint
UPDATE `email_templates` SET `html_body` = REPLACE(`html_body`, 'Sabertooth Software Labs', '{{senderCompany}}') WHERE `builtin_key` IS NOT NULL AND `html_body` LIKE '%Sabertooth Software Labs%';
