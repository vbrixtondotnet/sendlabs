CREATE TABLE "job_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"job_id" text NOT NULL,
	"network" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"started_at" bigint NOT NULL,
	"rewarded_at" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "job_shares_network_chk" CHECK ("network" IN ('linkedin', 'facebook'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_shares_user_job_network_uq" ON "job_shares" USING btree ("user_id","job_id","network");
--> statement-breakpoint
CREATE INDEX "job_shares_user_rewarded_idx" ON "job_shares" USING btree ("user_id","rewarded_at");
--> statement-breakpoint
ALTER TABLE "job_shares" ADD CONSTRAINT "job_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
