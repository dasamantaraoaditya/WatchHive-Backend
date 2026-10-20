ALTER TABLE "entries" ADD COLUMN IF NOT EXISTS "poster_path" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN IF NOT EXISTS "backdrop_path" text;
