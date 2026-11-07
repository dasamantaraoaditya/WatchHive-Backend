---
name: db-migration
description: Workflow for safely making database schema changes, generating Drizzle ORM migrations, and applying idempotent database updates.
---

# Database Migration Skill — WatchHive Backend

## Drizzle ORM Workflow

### Step 1: Update Schema Definition
Edit `src/db/schema.ts` to add or modify tables, columns, indexes, or relations.
- Keep foreign keys consistent (`uuid` references `users.id`, or cascade rules specified).
- Use proper types (`uuid`, `integer`, `varchar`, `text`, `timestamp`, `boolean`, `decimal`).
- Add appropriate indices on frequently queried foreign keys.

### Step 2: Generate Migration SQL
Run Drizzle Kit to create a new SQL migration file in the `drizzle/` directory:
```bash
npm run db:generate
```
Review the generated `.sql` file in `drizzle/` to ensure safe DDL.

### Step 3: Add Idempotent Guard to `src/index.ts`
For zero-downtime rolling deployments, also add an idempotent DDL guard in `src/index.ts` inside the server startup sequence:
```ts
await db.execute(sql`
    ALTER TABLE "my_table" ADD COLUMN IF NOT EXISTS "my_column" text;
`);
```

### Step 4: Verify Migration
Run the test suite to ensure the ORM models and queries operate cleanly:
```bash
npm test
```
