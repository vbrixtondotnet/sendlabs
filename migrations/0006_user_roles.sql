ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'JobSeeker' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_chk" CHECK ("role" IN ('SuperAdmin', 'JobSeeker', 'Agency'));
