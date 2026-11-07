ALTER TYPE "public"."NotificationType" ADD VALUE 'FRIEND_STARTED_WATCHING';--> statement-breakpoint
ALTER TYPE "public"."NotificationType" ADD VALUE 'FRIEND_LOGGED_WATCH';--> statement-breakpoint
CREATE TABLE "blocked_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_users_blocker_id_blocked_id_unique" UNIQUE("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE TABLE "episode_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tmdb_id" integer NOT NULL,
	"season_number" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"episode_id" integer,
	"episode_name" text,
	"watched_at" timestamp DEFAULT now() NOT NULL,
	"rating" numeric(3, 1),
	"review" text,
	"post_to_feed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "episode_watches_user_id_tmdb_id_season_number_episode_number_unique" UNIQUE("user_id","tmdb_id","season_number","episode_number")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_id" varchar(255) NOT NULL,
	"reason" varchar(50) NOT NULL,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_tokens" ALTER COLUMN "user_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "watched_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "suggested_by_user_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "list_items" ALTER COLUMN "suggested_by_user_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "user_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "poster_path" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "backdrop_path" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "post_to_feed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "current_season" integer;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "current_episode" integer;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "total_episodes_watched" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "total_episodes_count" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "apple_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_following_activity" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "watch_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_watch_date" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "has_completed_onboarding" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "token_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verification_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verification_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lockout_until" timestamp;--> statement-breakpoint
ALTER TABLE "blocked_users" ADD CONSTRAINT "blocked_users_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_users" ADD CONSTRAINT "blocked_users_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_watches" ADD CONSTRAINT "episode_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocked_users_blocked_id_idx" ON "blocked_users" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "blocked_users_blocker_id_idx" ON "blocked_users" USING btree ("blocker_id");--> statement-breakpoint
CREATE INDEX "episode_watches_user_tmdb_idx" ON "episode_watches" USING btree ("user_id","tmdb_id");--> statement-breakpoint
CREATE INDEX "episode_watches_user_watched_idx" ON "episode_watches" USING btree ("user_id","watched_at");--> statement-breakpoint
CREATE INDEX "entries_created_at_idx" ON "entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "entries_user_created_idx" ON "entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "entries_user_tmdb_idx" ON "entries" USING btree ("user_id","tmdb_id");--> statement-breakpoint
CREATE INDEX "users_email_lower_idx" ON "users" USING btree (LOWER("email"));--> statement-breakpoint
CREATE INDEX "users_username_lower_idx" ON "users" USING btree (LOWER("username"));--> statement-breakpoint
CREATE INDEX "users_google_id_idx" ON "users" USING btree ("google_id");--> statement-breakpoint
CREATE INDEX "users_xp_idx" ON "users" USING btree ("xp");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_apple_id_unique" UNIQUE("apple_id");