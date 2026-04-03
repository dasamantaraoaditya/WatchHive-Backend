ALTER TABLE "users" ADD COLUMN "show_watch_entries" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "show_currently_watching" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "show_watchlist" boolean DEFAULT true NOT NULL;