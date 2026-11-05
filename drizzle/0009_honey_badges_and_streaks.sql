ALTER TABLE "users" ADD COLUMN "watch_streak" integer NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "last_watch_date" text;
