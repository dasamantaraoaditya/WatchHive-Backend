import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { config } from '../config.js';
import { sql } from 'drizzle-orm';

// Required for Supabase/Neon connection with self-signed certificates in some environments
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const connectionString = config.database.url;

const isSslNeeded = connectionString.includes('supabase') ||
    connectionString.includes('neon.tech') ||
    connectionString.includes('render.com') ||
    connectionString.includes('railway.app');

// postgres.js client is fully native and compatible with both Bun and Node
export const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 30,
    ssl: isSslNeeded ? 'require' : false,
});

export const db = drizzle(client, { schema });

// Helper to check DB health
export const checkDbHealth = async () => {
    try {
        await db.execute(sql`SELECT 1`);
        return true;
    } catch (error) {
        console.error('Database health check failed:', error);
        return false;
    }
};

export default db;
