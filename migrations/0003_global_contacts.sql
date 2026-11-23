CREATE TABLE "global_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"employee_count" bigint,
	"industry" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "global_contacts_employee_count_chk" CHECK ("employee_count" IS NULL OR "employee_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "global_contacts_email_uq" ON "global_contacts" USING btree (lower(trim("email"))) WHERE "global_contacts"."email" <> '';
--> statement-breakpoint
CREATE INDEX "global_contacts_country_idx" ON "global_contacts" USING btree ("country");
--> statement-breakpoint
CREATE INDEX "global_contacts_industry_idx" ON "global_contacts" USING btree ("industry");
--> statement-breakpoint
CREATE INDEX "global_contacts_employee_count_idx" ON "global_contacts" USING btree ("employee_count");
