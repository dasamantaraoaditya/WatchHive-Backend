CREATE TYPE "public"."PrivacyLevel" AS ENUM('PUBLIC', 'FOLLOWERS_ONLY', 'PRIVATE');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "privacy_level" "PrivacyLevel" DEFAULT 'PUBLIC' NOT NULL;