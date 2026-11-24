CREATE TABLE "global_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_source_id" text NOT NULL,
	"external_job_id" text NOT NULL,
	"job_title" text NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"company_logo" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"employment_type" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"salary" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"job_url" text DEFAULT '' NOT NULL,
	"published_at" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "global_jobs_tags_chk" CHECK (jsonb_typeof("tags") = 'array')
);
--> statement-breakpoint
CREATE TABLE "job_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source_type" text NOT NULL,
	"api_endpoint" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" bigint,
	"last_attempt_at" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "job_sources_type_chk" CHECK ("source_type" IN ('api', 'feed', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "global_jobs_source_external_uq" ON "global_jobs" USING btree ("job_source_id","external_job_id");
--> statement-breakpoint
CREATE INDEX "global_jobs_active_published_idx" ON "global_jobs" USING btree ("is_active","published_at");
--> statement-breakpoint
CREATE INDEX "global_jobs_category_idx" ON "global_jobs" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "global_jobs_company_idx" ON "global_jobs" USING btree ("company_name");
--> statement-breakpoint
CREATE UNIQUE INDEX "job_sources_name_uq" ON "job_sources" USING btree (lower("name"));
--> statement-breakpoint
ALTER TABLE "global_jobs" ADD CONSTRAINT "global_jobs_job_source_id_job_sources_id_fk" FOREIGN KEY ("job_source_id") REFERENCES "public"."job_sources"("id") ON DELETE restrict ON UPDATE no action;
