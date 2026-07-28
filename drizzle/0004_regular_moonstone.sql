ALTER TYPE "public"."NotificationType" ADD VALUE 'FOLLOW_REJECT' BEFORE 'LIKE';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_reset_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_reset_expires_at" timestamp;