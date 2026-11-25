CREATE TABLE "contact_lookups" (
	"id" text PRIMARY KEY NOT NULL,
	"cache_key" text NOT NULL,
	"company_name" text NOT NULL,
	"email" text,
	"name" text DEFAULT '' NOT NULL,
	"position" text DEFAULT '' NOT NULL,
	"confidence" integer,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	CONSTRAINT "contact_lookups_confidence_chk" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 100))
);
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "note" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_lookups_key_uq" ON "contact_lookups" USING btree ("cache_key");
--> statement-breakpoint
CREATE INDEX "credit_transactions_user_note_idx" ON "credit_transactions" USING btree ("user_id","reason","note");
