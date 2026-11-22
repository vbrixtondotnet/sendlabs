CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"postal_address" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"require_unsubscribe_link" boolean DEFAULT true NOT NULL,
	"one_click_unsubscribe" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "tenants_status_chk" CHECK ("status" IN ('Active', 'Suspended')),
	CONSTRAINT "tenants_name_chk" CHECK (length(trim("name")) > 0),
	CONSTRAINT "tenants_slug_chk" CHECK ("slug" <> '' AND "slug" !~ '[^a-z0-9-]')
);
--> statement-breakpoint
CREATE TABLE "access" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"position" text DEFAULT '' NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"access_id" text NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"last_login_at" bigint,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "users_status_chk" CHECK ("status" IN ('Active', 'Disabled')),
	CONSTRAINT "users_normalized_email_chk" CHECK ("normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email"))),
	CONSTRAINT "users_password_hash_chk" CHECK ("password_hash" <> '')
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"employees" bigint,
	"industry" text DEFAULT '' NOT NULL,
	"linkedin_url" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"annual_revenue" bigint,
	"consent_status" text DEFAULT 'Unknown' NOT NULL,
	"consent_source" text,
	"source_import_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "contacts_consent_chk" CHECK ("consent_status" IN ('Granted', 'Unknown', 'Withdrawn')),
	CONSTRAINT "contacts_normalized_email_chk" CHECK ("normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email"))),
	CONSTRAINT "contacts_employees_chk" CHECK ("employees" IS NULL OR "employees" >= 0),
	CONSTRAINT "contacts_revenue_chk" CHECK ("annual_revenue" IS NULL OR "annual_revenue" >= 0)
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"contact_id" text,
	"email_snapshot" text NOT NULL,
	"personalization_snapshot" jsonb NOT NULL,
	"sequence" integer NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"skip_reason" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" bigint,
	"queued_at" bigint,
	"accepted_at" bigint,
	"last_error" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "campaign_recipients_status_chk" CHECK ("status" IN ('Pending', 'Queued', 'Processing', 'Accepted', 'Failed', 'Skipped', 'Cancelled')),
	CONSTRAINT "campaign_recipients_skip_reason_chk" CHECK ("skip_reason" IS NULL OR "skip_reason" IN ('Suppressed', 'InvalidEmail', 'Manual')),
	CONSTRAINT "campaign_recipients_skip_consistency_chk" CHECK (("status" = 'Skipped') = ("skip_reason" IS NOT NULL)),
	CONSTRAINT "campaign_recipients_attempts_chk" CHECK ("attempt_count" >= 0),
	CONSTRAINT "campaign_recipients_email_chk" CHECK ("email_snapshot" <> '')
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"html_body" text NOT NULL,
	"text_body" text,
	"signature" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"sender_account_id" text,
	"created_by" text NOT NULL,
	"recipient_import_id" text,
	"recipient_industries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plain_text" boolean DEFAULT false NOT NULL,
	"daily_limit" integer DEFAULT 500 NOT NULL,
	"send_window_start" text DEFAULT '09:00' NOT NULL,
	"send_window_end" text DEFAULT '17:00' NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"next_run_at" bigint,
	"last_run_at" bigint,
	"launched_at" bigint,
	"completed_at" bigint,
	"archived_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "campaigns_status_chk" CHECK ("status" IN ('Draft', 'Queuing', 'Queued', 'Sending', 'Paused', 'Completed', 'CompletedWithErrors', 'Failed', 'Cancelled')),
	CONSTRAINT "campaigns_daily_limit_chk" CHECK ("daily_limit" BETWEEN 1 AND 2000),
	CONSTRAINT "campaigns_name_chk" CHECK (length(trim("name")) > 0),
	CONSTRAINT "campaigns_window_chk" CHECK (("send_window_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND ("send_window_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND "send_window_start" < "send_window_end")
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"import_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"raw_value" text DEFAULT '' NOT NULL,
	"outcome" text NOT NULL,
	"contact_id" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "import_rows_outcome_chk" CHECK ("outcome" IN ('Created', 'Existing', 'Blank', 'Malformed', 'Duplicate', 'Bad row')),
	CONSTRAINT "import_rows_rejected_unlinked_chk" CHECK ("outcome" IN ('Created', 'Existing') OR "contact_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"filename" text NOT NULL,
	"file_size" integer NOT NULL,
	"status" text DEFAULT 'Processing' NOT NULL,
	"column_mapping" jsonb NOT NULL,
	"total_rows" integer NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"created_contacts" integer DEFAULT 0 NOT NULL,
	"existing_contacts" integer DEFAULT 0 NOT NULL,
	"malformed_rows" integer DEFAULT 0 NOT NULL,
	"bad_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"blank_rows" integer DEFAULT 0 NOT NULL,
	"numeric_warnings" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"completed_at" bigint,
	CONSTRAINT "imports_status_chk" CHECK ("status" IN ('Processing', 'Completed', 'Failed')),
	CONSTRAINT "imports_counts_chk" CHECK ("total_rows" >= 0 AND "valid_rows" >= 0 AND "created_contacts" >= 0 AND "existing_contacts" >= 0 AND "valid_rows" <= "total_rows")
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"code_verifier_encrypted" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text DEFAULT 'gmail' NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"status" text DEFAULT 'Connected' NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"scopes" text NOT NULL,
	"sender_name" text DEFAULT '' NOT NULL,
	"connected_by" text NOT NULL,
	"connected_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "sender_accounts_provider_chk" CHECK ("provider" IN ('gmail')),
	CONSTRAINT "sender_accounts_status_chk" CHECK ("status" IN ('Connected', 'NeedsReconnect')),
	CONSTRAINT "sender_accounts_email_chk" CHECK ("normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email"))),
	CONSTRAINT "sender_accounts_token_chk" CHECK ("refresh_token_encrypted" <> '')
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"position" text DEFAULT '' NOT NULL,
	"access_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"expires_at" bigint NOT NULL,
	"invited_by" text NOT NULL,
	"accepted_at" bigint,
	"accepted_user_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "invitations_status_chk" CHECK ("status" IN ('Pending', 'Accepted', 'Revoked', 'Expired')),
	CONSTRAINT "invitations_email_chk" CHECK ("normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email"))),
	CONSTRAINT "invitations_names_chk" CHECK (length(trim("first_name")) > 0 AND length(trim("last_name")) > 0),
	CONSTRAINT "invitations_token_chk" CHECK ("token_hash" <> ''),
	CONSTRAINT "invitations_accepted_chk" CHECK (("status" = 'Accepted') = ("accepted_at" IS NOT NULL AND "accepted_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_start" bigint NOT NULL,
	"locked_until" bigint,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "test_recipients_email_chk" CHECK ("normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email"))),
	CONSTRAINT "test_recipients_len_chk" CHECK (length("email") <= 320)
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"reason" text DEFAULT 'Unsubscribed' NOT NULL,
	"campaign_id" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "suppressions_reason_chk" CHECK ("reason" IN ('Unsubscribed')),
	CONSTRAINT "suppressions_email_chk" CHECK ("normalized_email" <> '' AND "normalized_email" = lower(trim("normalized_email")))
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"builtin_key" text,
	"html_body" text NOT NULL,
	"created_by" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "email_templates_name_chk" CHECK (length(trim("name")) > 0 AND length("name") <= 100),
	CONSTRAINT "email_templates_body_chk" CHECK (length(trim("html_body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "system_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"html_body" text NOT NULL,
	"created_by" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "system_templates_name_chk" CHECK (length(trim("name")) > 0 AND length("name") <= 100),
	CONSTRAINT "system_templates_body_chk" CHECK (length(trim("html_body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "personal_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"recipient" text NOT NULL,
	"normalized_recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"sent_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "personal_emails_recipient_chk" CHECK ("normalized_recipient" <> '' AND "normalized_recipient" = lower(trim("normalized_recipient"))),
	CONSTRAINT "personal_emails_body_chk" CHECK (length(trim("body")) > 0 AND length(trim("subject")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_uq" ON "tenants" USING btree ("slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_name_uq" ON "tenants" USING btree (lower("name"));
--> statement-breakpoint
CREATE UNIQUE INDEX "access_name_uq" ON "access" USING btree ("name");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_normalized_email_uq" ON "users" USING btree ("normalized_email");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_id_uq" ON "users" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "users_access_idx" ON "users" USING btree ("access_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_email_uq" ON "contacts" USING btree ("tenant_id","normalized_email");
--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_id_uq" ON "contacts" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "contacts_tenant_industry_idx" ON "contacts" USING btree ("tenant_id","industry");
--> statement-breakpoint
CREATE INDEX "contacts_tenant_source_import_idx" ON "contacts" USING btree ("tenant_id","source_import_id");
--> statement-breakpoint
CREATE INDEX "contacts_tenant_created_at_idx" ON "contacts" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_campaign_contact_uq" ON "campaign_recipients" USING btree ("campaign_id","contact_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_campaign_sequence_uq" ON "campaign_recipients" USING btree ("campaign_id","sequence");
--> statement-breakpoint
CREATE INDEX "campaign_recipients_pick_idx" ON "campaign_recipients" USING btree ("campaign_id","status","sequence");
--> statement-breakpoint
CREATE INDEX "campaign_recipients_lease_idx" ON "campaign_recipients" USING btree ("status","lease_expires_at");
--> statement-breakpoint
CREATE INDEX "campaign_recipients_contact_idx" ON "campaign_recipients" USING btree ("tenant_id","contact_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_tenant_id_uq" ON "campaigns" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "campaigns_tenant_status_idx" ON "campaigns" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX "campaigns_tenant_created_at_idx" ON "campaigns" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX "campaigns_due_idx" ON "campaigns" USING btree ("status","next_run_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_import_row_uq" ON "import_rows" USING btree ("import_id","row_number");
--> statement-breakpoint
CREATE INDEX "import_rows_import_outcome_idx" ON "import_rows" USING btree ("import_id","outcome");
--> statement-breakpoint
CREATE INDEX "import_rows_contact_idx" ON "import_rows" USING btree ("tenant_id","contact_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "imports_tenant_id_uq" ON "imports" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "imports_tenant_created_at_idx" ON "imports" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_states_hash_uq" ON "oauth_states" USING btree ("state_hash");
--> statement-breakpoint
CREATE INDEX "oauth_states_expires_idx" ON "oauth_states" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "sender_accounts_tenant_uq" ON "sender_accounts" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sender_accounts_tenant_id_uq" ON "sender_accounts" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uq" ON "invitations" USING btree ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_email_uq" ON "invitations" USING btree ("tenant_id","normalized_email") WHERE "invitations"."status" = 'Pending';
--> statement-breakpoint
CREATE INDEX "invitations_tenant_status_idx" ON "invitations" USING btree ("tenant_id","status","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "login_attempts_updated_idx" ON "login_attempts" USING btree ("updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "test_recipients_tenant_email_uq" ON "test_recipients" USING btree ("tenant_id","normalized_email");
--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_tenant_email_uq" ON "suppressions" USING btree ("tenant_id","normalized_email");
--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_tenant_name_uq" ON "email_templates" USING btree ("tenant_id",lower("name"));
--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_tenant_builtin_uq" ON "email_templates" USING btree ("tenant_id","builtin_key") WHERE "email_templates"."builtin_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "system_templates_name_uq" ON "system_templates" USING btree (lower("name"));
--> statement-breakpoint
CREATE INDEX "personal_emails_tenant_created_idx" ON "personal_emails" USING btree ("tenant_id","created_at");
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_access_id_access_id_fk" FOREIGN KEY ("access_id") REFERENCES "public"."access"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "recipients_campaign_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "recipients_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_creator_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."imports"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_creator_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sender_accounts" ADD CONSTRAINT "sender_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sender_accounts" ADD CONSTRAINT "sender_accounts_connected_by_fk" FOREIGN KEY ("tenant_id","connected_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_access_id_access_id_fk" FOREIGN KEY ("access_id") REFERENCES "public"."access"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_fk" FOREIGN KEY ("tenant_id","invited_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_user_fk" FOREIGN KEY ("tenant_id","accepted_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "test_recipients" ADD CONSTRAINT "test_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "test_recipients" ADD CONSTRAINT "test_recipients_creator_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_campaign_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "public"."campaigns"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_creator_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "personal_emails" ADD CONSTRAINT "personal_emails_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "personal_emails" ADD CONSTRAINT "personal_emails_sender_fk" FOREIGN KEY ("tenant_id","sent_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
