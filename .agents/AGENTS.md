# WatchHive Backend — Agent Context & Architectural Guidelines

> **Repository Master Reference**  
> Runtime: Bun / Node.js 20+ (ES Modules)  
> Framework: Express.js + TypeScript (strict mode, NodeNext module resolution)  
> Database: PostgreSQL + Drizzle ORM (schema: `src/db/schema.ts`)  
> Cache: Zero-cost in-memory LRU (`MemoryCache` in `src/utils/cache.util.ts`) + Redis fallback

---

## 🏛️ 1. Architecture & Key Directories

```
src/
├── app.ts                 # Express configuration, CORS, Helmet, routes mount, health check
├── index.ts               # Server startup, graceful shutdown, DB migration runner
├── config.ts              # Type-safe environment config (cleanEnv, cleanPass)
├── db/
│   ├── index.ts           # PostgreSQL client pool & Drizzle ORM instance
│   └── schema.ts          # Master Drizzle schema (15 tables, 4 enums, relations)
├── middleware/
│   ├── auth.middleware.ts # JWT verification & email verification gate
│   ├── error.middleware.ts# Centralized error handler & 404 handler
│   ├── rate-limit.middleware.ts # In-memory & Redis rate limiters
│   └── validation.middleware.ts # Express-validator helpers
├── routes/                # Express router endpoints (/api/v1/*)
│   ├── auth.routes.ts, entries.ts, episode.routes.ts, feed.routes.ts
│   ├── follows.routes.ts, likes.routes.ts, lists.routes.ts, mindlens.routes.ts
│   ├── notifications.routes.ts, push.routes.ts, suggestions.routes.ts, tmdb.routes.ts
├── services/              # Business logic & external API clients
│   ├── auth.service.ts, tmdb.service.ts, episode-tracking.service.ts
│   ├── notification.service.ts, push.service.ts, email.service.ts
│   └── mindlens.service.ts (Shannon entropy & Russell circumplex math)
└── utils/
    ├── cache.util.ts      # In-memory singletons & user cache invalidator
    └── jwt.util.ts        # Access (7d) & Refresh (90d) token issuance
```

---

## 🗄️ 2. Database Schema Summary (`src/db/schema.ts`)

| Table | Primary Key | Key Foreign Keys | Key Columns |
|---|---|---|---|
| `users` | `id` (uuid) | - | `username`, `email`, `passwordHash`, `googleId`, `appleId`, `xp`, `level`, `watchStreak`, `preferences` (jsonb), `isEmailVerified`, `tokenVersion` |
| `entries` | `id` (uuid) | `userId` → `users.id` (cascade), `suggestedByUserId` → `users.id` | `tmdbId`, `title`, `type` (`MOVIE`/`TV_SHOW`/`EPISODE`), `watchedAt`, `rating`, `review`, `isRewatch`, `isWatching`, `currentSeason`, `currentEpisode`, `totalEpisodesWatched`, `totalEpisodesCount` |
| `episode_watches` | `id` (uuid) | `userId` → `users.id` (cascade) | `tmdbId`, `seasonNumber`, `episodeNumber`, `episodeName`, `rating`, `review`, `watchedAt` |
| `follows` | `id` (uuid) | `followerId`, `followingId` → `users.id` (cascade) | `createdAt` (unique composite index) |
| `follow_requests` | `id` (uuid) | `senderId`, `recipientId` → `users.id` | `status` (`pending`/`accepted`/`rejected`) |
| `likes` | `id` (uuid) | `userId`, `entryId` → `entries.id` (cascade) | `createdAt` (unique composite index) |
| `comments` | `id` (uuid) | `userId`, `entryId`, `parentCommentId` → `comments.id` | `content`, `createdAt` |
| `lists` / `list_items` | `id` (uuid) | `userId`, `listId` → `lists.id` | `type` (`WATCHLIST`/`RANKING_STACK`/`COLLECTION`), `tmdbId`, `orderIndex` |
| `notifications` | `id` (uuid) | `userId` → `users.id` (cascade) | `type`, `content` (jsonb), `isRead` |
| `suggestions` | `id` (uuid) | `fromUserId`, `toUserId` → `users.id` | `tmdbId`, `mediaType`, `message`, `status` |
| `push_subscriptions` | `id` (uuid) | `userId` → `users.id` | WebPush credentials (`endpoint`, `p256dh`, `auth`) |
| `device_tokens` | `id` (uuid) | `userId` → `users.id` | Mobile push (`token`, `platform`: `android`/`ios`) |
| `reports` / `blocked_users` | `id` (uuid) | `reporterId`/`blockerId`, `blockedId` | UGC moderation & Apple Guideline 1.2 compliance |

---

## ⚡ 3. In-Memory Cache Pattern (`src/utils/cache.util.ts`)

- Hot read endpoints use singletons of `MemoryCache` (capacity-bounded, microsecond response):
  - `userProfileCache` (size: 3000)
  - `statsSummaryCache` (size: 3000)
  - `mindlensCache` (size: 2000)
  - `feedSuggestionsCache` (size: 2000)
  - `tokenVersionCache` (size: 5000)
- **CRITICAL**: On ANY user write operation (entry added, updated, deleted, follow, episode logged), YOU MUST CALL:
  ```ts
  import { invalidateUserCaches } from '../utils/cache.util.js';
  invalidateUserCaches(userId);
  ```

---

## 🔒 4. Auth & Request Conventions

1. **Token Payload**:
   ```ts
   // In route handlers:
   const userId = req.user?.userId || (req.user as any)?.id;
   ```
2. **ES Modules & NodeNext**:
   - Every internal import MUST specify the `.js` extension (e.g., `import { config } from './config.js';`), even when writing TypeScript.
3. **Database Column Migration Safety**:
   - In addition to Drizzle migration files, critical new columns must be guarded idempotently in `src/index.ts` with `ALTER TABLE "..." ADD COLUMN IF NOT EXISTS ...`.

---

## 🛠️ 5. Standard Commands

- Development: `bun --watch src/index.ts` or `npm run dev:tsx`
- Build: `npm run build` (`tsc` compiling to `dist/`)
- Test: `npm test` (Jest with experimental VM modules) or `bun test`
- Lint: `npm run lint`
- Database:
  - Generate migration: `npm run db:generate`
  - Push schema directly: `npm run db:push`
  - Drizzle studio GUI: `npm run db:studio`
