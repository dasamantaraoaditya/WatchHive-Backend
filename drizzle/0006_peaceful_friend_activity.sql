ALTER TYPE "public"."NotificationType" ADD VALUE 'FRIEND_STARTED_WATCHING';--> statement-breakpoint
ALTER TYPE "public"."NotificationType" ADD VALUE 'FRIEND_LOGGED_WATCH';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_following_activity" boolean DEFAULT true NOT NULL;
