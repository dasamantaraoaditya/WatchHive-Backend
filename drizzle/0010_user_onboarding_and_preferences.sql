ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "has_completed_onboarding" boolean DEFAULT false NOT NULL;
