const pg = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../Users/adityadasamantharao/Documents/Repos/WatchHive-Backend/.env') });

const { Client } = pg;

const client = new Client({
  connectionString: "postgresql://postgres.bhzkgsbpseujegmvkszz:Dasamantarao..123@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true",
  ssl: {
    rejectUnauthorized: false
  }
});

async function migrate() {
  try {
    await client.connect();
    console.log('Connected to database.');
    
    // 1. Add SUGGESTION to NotificationType enum if missing
    const { rows } = await client.query("SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE typname = 'NotificationType' AND enumlabel = 'SUGGESTION'");
    
    if (rows.length === 0) {
      console.log('Adding SUGGESTION to NotificationType enum...');
      await client.query("ALTER TYPE \"NotificationType\" ADD VALUE 'SUGGESTION'");
    } else {
      console.log('SUGGESTION already exists in NotificationType enum.');
    }

    // 2. Create suggestions table with TEXT for user IDs to match existing DB
    console.log('Creating suggestions table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "suggestions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "from_user_id" text NOT NULL,
        "to_user_id" text NOT NULL,
        "tmdb_id" integer NOT NULL,
        "media_type" varchar(20) DEFAULT 'movie' NOT NULL,
        "message" text,
        "status" varchar(20) DEFAULT 'pending' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `);

    // 3. Add foreign keys using TEXT types
    console.log('Adding foreign keys...');
    try {
        await client.query('ALTER TABLE suggestions ADD CONSTRAINT suggestions_from_user_id_users_id_fk FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE;');
    } catch (e) {
        if (!e.message.includes('already exists')) throw e;
    }

    try {
        await client.query('ALTER TABLE suggestions ADD CONSTRAINT suggestions_to_user_id_users_id_fk FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE;');
    } catch (e) {
        if (!e.message.includes('already exists')) throw e;
    }

    // 4. Create indexes
    console.log('Creating indexes for suggestions table...');
    await client.query('CREATE INDEX IF NOT EXISTS "suggestions_to_user_id_idx" ON "suggestions" ("to_user_id");');
    await client.query('CREATE INDEX IF NOT EXISTS "suggestions_tmdb_id_idx" ON "suggestions" ("tmdb_id");');

    console.log('Migration successful!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

migrate();
