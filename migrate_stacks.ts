import { db } from './src/db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
    console.log('Applying schema changes for Cinematic Stacks...');
    try {
        // 1. Create the enum type if it doesn't exist
        await db.execute(sql`
            DO $$ BEGIN
                CREATE TYPE "ListType" AS ENUM('WATCHLIST', 'RANKING_STACK', 'COLLECTION');
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
        `);
        console.log('Created ListType enum.');

        // 2. Add the type column to lists
        await db.execute(sql`
            ALTER TABLE "lists" 
            ADD COLUMN IF NOT EXISTS "type" "ListType" DEFAULT 'WATCHLIST' NOT NULL;
        `);
        console.log('Added type column to lists table.');

        console.log('Schema changes applied successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Error applying schema changes:', error);
        process.exit(1);
    }
}

main();
