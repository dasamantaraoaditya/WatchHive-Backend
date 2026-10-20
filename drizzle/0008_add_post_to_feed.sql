ALTER TABLE "entries" ADD COLUMN IF NOT EXISTS "post_to_feed" boolean DEFAULT true NOT NULL;
