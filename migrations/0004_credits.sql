CREATE TABLE "credit_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" text NOT NULL,
	"global_contact_id" text,
	"contact_id" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "credit_transactions_delta_chk" CHECK ("delta" <> 0),
	CONSTRAINT "credit_transactions_balance_chk" CHECK ("balance_after" >= 0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credits" integer DEFAULT 100 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_credits_chk" CHECK ("credits" >= 0);
--> statement-breakpoint
CREATE INDEX "credit_transactions_user_created_idx" ON "credit_transactions" USING btree ("user_id","created_at");
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
