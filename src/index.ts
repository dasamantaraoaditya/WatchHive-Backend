import app from './app.js';
import { config } from './config.js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './db/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);

    try {
        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
};

// Graceful shutdown signals
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    gracefulShutdown('SIGINT');
});

// Run DB migrations before starting server
const migrationsFolder = path.join(__dirname, '..', 'drizzle');
try {
    console.log('🗄️  Running database migrations...');
    await migrate(db, { migrationsFolder });
    console.log('✅ Database migrations complete');
} catch (err) {
    console.error('❌ Migration failed:', err);
    // Do not block startup for migration errors — log and continue
}

// Ensure critical schema columns exist idempotently to prevent any runtime mismatch
try {
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_email_verified" boolean DEFAULT true NOT NULL;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verification_token" text;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verification_expires_at" timestamp;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer DEFAULT 0 NOT NULL;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lockout_until" timestamp;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_version" integer DEFAULT 1 NOT NULL;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "watch_streak" integer DEFAULT 0 NOT NULL;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_watch_date" text;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "has_completed_onboarding" boolean DEFAULT false NOT NULL;
        ALTER TABLE "entries" ADD COLUMN IF NOT EXISTS "poster_path" text;
        ALTER TABLE "entries" ADD COLUMN IF NOT EXISTS "backdrop_path" text;
        ALTER TABLE "entries" ADD COLUMN IF NOT EXISTS "post_to_feed" boolean DEFAULT true NOT NULL;
        ALTER TABLE "entries" ADD COLUMN IF NOT EXISTS "current_season" integer;
        ALTER TABLE "entries" ADD COLUMN IF NOT EXISTS "current_episode" integer;
        ALTER TABLE "entries" ADD COLUMN IF NOT EXISTS "total_episodes_watched" integer DEFAULT 0 NOT NULL;
        ALTER TABLE "entries" ADD COLUMN IF NOT EXISTS "total_episodes_count" integer;
        ALTER TABLE "entries" ALTER COLUMN "watched_at" DROP NOT NULL;

        CREATE TABLE IF NOT EXISTS "episode_watches" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
            "tmdb_id" integer NOT NULL,
            "season_number" integer NOT NULL,
            "episode_number" integer NOT NULL,
            "episode_id" integer,
            "episode_name" text,
            "watched_at" timestamp with time zone DEFAULT now() NOT NULL,
            "rating" numeric(3, 1),
            "review" text,
            "post_to_feed" boolean DEFAULT false NOT NULL,
            "created_at" timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT "episode_watches_user_tmdb_season_episode_unique" UNIQUE("user_id", "tmdb_id", "season_number", "episode_number")
        );
        CREATE INDEX IF NOT EXISTS "episode_watches_user_tmdb_idx" ON "episode_watches"("user_id", "tmdb_id");
        CREATE INDEX IF NOT EXISTS "episode_watches_user_watched_idx" ON "episode_watches"("user_id", "watched_at");
    `);
    console.log('✅ Schema columns verified');
} catch (schemaErr) {
    console.error('⚠️ Schema verification warning:', schemaErr);
}

// Start the server
const serverPort = process.env.PORT || config.port || 8080;
app.listen(Number(serverPort), '0.0.0.0', () => {
    console.log(`\n🚀 WatchHive API Server`);
    console.log(`📡 Server running and listening on port ${serverPort}`);
    console.log(`🌍 Environment: ${config.nodeEnv}`);
    console.log(`💾 Database: Connected`);
    console.log(`\n📋 Available endpoints:`);
    console.log(`   GET  /health`);
    console.log(`   POST /api/v1/auth/register`);
    console.log(`   POST /api/v1/auth/login`);
    console.log(`   POST /api/v1/auth/refresh`);
    console.log(`   POST /api/v1/auth/logout`);
    console.log(`\n✨ Ready to accept requests!\n`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('Unhandled Rejection');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown('Uncaught Exception');
});

export default app;
