# WatchHive Backend API 🎬

> Central RESTful API engine for **WatchersHive** — powering real-time social movie & TV show tracking, personalized ranking stacks, community suggestions, friend activity feeds, and user profile management across Web and Mobile.

---

## 📌 1. What is this Repo For?

WatchHive Backend provides the core business logic, social graph, movie metadata orchestration, and data persistence for the WatchersHive ecosystem:
- **Watch Tracking & Reviews**: Logging watched movies, episodes, rewatches, personal ratings, and detailed reviews.
- **Ranking Stacks & Curations**: Creating shareable, ranked stacks of movies that represent a user's personal "report card" of cinema.
- **Community Suggestions Engine**: Suggesting movies directly to friends, tracking recommendation impact, and logging suggester gratitude.
- **Social Graph & Feed**: Follow/unfollow, friend activity feeds, likes, comments, and mentions.
- **Cross-Platform Notifications**: Web Push notifications and Firebase Cloud Messaging (FCM) for mobile push.
- **SmartSuggest AI Recommendations**: Hybrid algorithmic recommendation engine balancing friend recommendations, public ratings, user preferences, and diversity nudges.
- **MindLens 2.0 Behavioral Intelligence Engine**: Empirical cinematic telemetry measuring Shannon Information Entropy ($H(G)$) for taste breadth, Russell's Circumplex Affective State, Empirical Bayesian Recommender Trust ($RTS$), and 6 cognitive viewing archetypes. Full specification documented in [MINDLENS_SPECIFICATION.md](docs/MINDLENS_SPECIFICATION.md).
- **Master Features & Logic Wiki**: Complete architectural documentation of all 14 core features, mathematical models, and edge cases in [FEATURES_AND_LOGIC_WIKI.md](docs/FEATURES_AND_LOGIC_WIKI.md).
- **Backend Architecture & System Blueprint**: Comprehensive Express layer topology, Drizzle ORM schema models, Redis caching, and deployment pipelines in [ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Multi-Environment Orchestration**: Isolated Staging and Production architectures running with automated CI/CD and protected branches.

---

## 🛠️ 2. Tech Stack

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Runtime** | Bun (v1.1+) / Node.js (v20+ fallback) | Ultra-fast native TypeScript runtime with Node ESM compatibility |
| **Framework** | Express.js | Fast, unopinionated HTTP server with robust middleware |
| **Language** | TypeScript (v5+) | Full end-to-end type safety |
| **Database** | PostgreSQL | Relational database with UUID keys & strict foreign constraints |
| **ORM & Migrations** | Drizzle ORM & Drizzle Kit | Type-safe SQL query builder and schema management (`postgres.js` driver) |
| **Authentication** | JWT + bcryptjs | Custom stateless authentication with access & refresh tokens |
| **External APIs** | TMDb API v3 | Rich movie/TV metadata, credits, posters, and trailers |
| **Cloud Storage** | AWS S3 SDK (`@aws-sdk/client-s3`) | Profile avatar storage and presigned uploads |
| **Push Notifications** | Firebase Admin SDK + Web Push | FCM for Android/iOS mobile devices & standard Web Push (VAPID) |
| **Performance Testing** | Autocannon + Bun native runner | Automated concurrent benchmark suite and load testing |
| **Deployment & CI** | Railway + GitHub Actions | Automated branch deployments (`staging`, `main`) with branch protection |

---

## 🚀 3. How to Setup

### Prerequisites
- [Bun](https://bun.sh) (v1.1+ or higher)
- PostgreSQL database (Local, Railway, or Supabase)

### Step-by-Step Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/dasamantaraoaditya/WatchHive-Backend.git
   cd WatchHive-Backend
   ```

2. **Install dependencies**:
   ```bash
   bun install
   ```

3. **Configure environment variables**:
   Create a `.env` file in the root directory:
   ```env
   # Database
   DATABASE_URL="postgresql://postgres:password@localhost:5432/watchhive"

   # Server
   PORT=5001
   NODE_ENV=development

   # JWT Secrets
   JWT_SECRET=your-secure-jwt-secret-key-32-chars
   JWT_REFRESH_SECRET=your-secure-jwt-refresh-secret-key-32-chars
   JWT_EXPIRES_IN=7d
   JWT_REFRESH_EXPIRES_IN=90d

   # CORS Allowed Origins
   FRONTEND_URL=http://localhost:5173,http://localhost:3000

   # TMDb API
   TMDB_API_KEY=your_tmdb_api_key
   TMDB_BASE_URL=https://api.themoviedb.org/3

   # Google OAuth (Optional for Google Sign-in)
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   ```

4. **Initialize Database Schema**:
   Push the Drizzle schema directly to your database:
   ```bash
   bun run db:push
   ```

5. **Seed Realistic Staging / Dev Data**:
   Populate test users, ranking stacks, watch entries, suggestions, and social follows:
   ```bash
   bun scripts/seed-staging.ts
   ```

6. **Start Development Server**:
   ```bash
   bun run dev
   ```
   The API will be available at `http://localhost:5001`.
   Swagger Interactive API Docs: `http://localhost:5001/api/docs`.

---

## 🏛️ 4. Architecture

WatchHive Backend follows a clean, modular layered architecture designed for separation of concerns and high concurrency:

```mermaid
flowchart TD
    Client["Clients: Web (React PWA) / Mobile (Flutter Android & iOS)"]
    Proxy["Railway Edge Proxy / HTTPS"]
    MW["Express Middleware: Helmet, CORS, Rate-Limiter, JWT Auth"]
    Routes["API Routes (/api/v1/...)"]
    Services["Domain Services: TMDb Service, Push Service, XP Service"]
    ORM["Drizzle ORM Query Layer"]
    DB[("PostgreSQL Database (Users, Entries, Stacks, Suggestions)")]
    S3[("AWS S3 Avatar Storage")]
    FCM["Firebase Cloud Messaging & WebPush"]

    Client --> Proxy
    Proxy --> MW
    MW --> Routes
    Routes --> Services
    Routes --> ORM
    Services --> ORM
    Services --> S3
    Services --> FCM
    ORM --> DB
```

### Directory Structure
```text
src/
├── config/           # Swagger and system configuration
├── db/               # Drizzle database connection and schema definitions
│   ├── index.ts      # Connection pooler setup
│   └── schema.ts     # PostgreSQL tables, relations, and enums
├── middleware/       # JWT auth, error handling, rate limiting
├── routes/           # RESTful API route declarations
│   ├── auth.routes.ts
│   ├── entries.ts
│   ├── feed.routes.ts
│   ├── lists.routes.ts
│   ├── suggestions.routes.ts
│   └── user.routes.ts
├── services/         # Business logic (TMDb, push notifications, XP engine)
├── utils/            # Avatar formatting, cryptographic helpers
├── app.ts            # Express application composition
└── index.ts          # Server entry point & graceful shutdown
scripts/
├── seed-staging.ts   # Staging seed script
└── perf-benchmark.ts # Autocannon performance test suite
```

---

## ⚡ 5. Performance & Load Benchmarks

The WatchHive API is continuously benchmarked under concurrent traffic and profiled for runtime performance. With the migration to **Bun**, the engine achieves drastic improvements in startup time, test runner speed, installation overhead, and process CPU utilization.

### Runtime Benchmark: Bun vs. Node.js

| Metric Category | Node.js (v20) / npm | Bun (v1.4+) | Performance Delta |
| :--- | :--- | :--- | :--- |
| **Cold Start / Module Evaluation** | `2.79s` (tsx) | `0.62s` (Bun native) | **~4.5x faster startup** |
| **Test Suite (`8 suites, 79 tests`)** | `2.70s` wall / `7.86s` CPU | `1.04s` wall / `0.63s` CPU | **12.5x less CPU / 2.6x faster** |
| **Dependency Install (`--frozen-lockfile`)** | `9.01s` (12.98s CPU) | `0.13s` (0.04s CPU) | **~67x faster (~320x less CPU)** |
| **CI Pipeline Test Execution** | `~2m 30s` | `40s` | **~3.7x faster CI pipeline** |

---

### Live Staging & Production Benchmark Results

The following metrics reflect our live **Railway Production & Staging Environments** under authenticated load, real Supabase PostgreSQL pooler transactions, JWT verification, and multi-table aggregations.

#### Production Benchmark: Before vs. After Optimization

| Endpoint | Method | Pre-Optimization Avg | Post-Optimization Avg | Peak (Min) | Latency Reduction |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Friend Recommendations** | `GET /api/v1/users/suggested` | `2,143 ms` | **927 ms** | `250 ms` (cached) | **57% – 88% faster** |
| **Activity Feed (Page 1)** | `GET /api/v1/feed?page=1` | `2,163 ms` | **1,206 ms** | `1,050 ms` | **44% faster** |
| **MindLens Insights** | `GET /api/v1/mindlens/insights` | `1,586 ms` | **818 ms** | `793 ms` | **48% faster** |
| **Stats Summary** | `GET /api/v1/entries/stats/summary` | `858 ms` | **509 ms** | `492 ms` | **41% faster** |
| **User Profile (`/me`)** | `GET /api/v1/users/me` | `791 ms` | **520 ms** | `498 ms` | **34% faster** |
| **Detailed Analytics** | `GET /api/v1/stats/detailed` | `764 ms` | **594 ms** | `524 ms` | **22% faster** |
| **Trending Feed** | `GET /api/v1/feed/trending` | `636 ms` | **504 ms** | `490 ms` | **21% faster** |
| **Watch Entries** | `GET /api/v1/entries` | `506 ms` | **518 ms** | `498 ms` | **Stable** |
| **TMDb Popular** | `GET /api/v1/tmdb/popular` | `262 ms` | **279 ms** | `264 ms` | **Sub-300ms** |
| **TMDb Trending Week** | `GET /api/v1/tmdb/trending/all/week` | `312 ms` | **249 ms** | `243 ms` | **20% faster** |
| **TMDb Multi-Search** | `GET /api/v1/tmdb/search/multi` | `296 ms` | **270 ms** | `264 ms` | **Sub-300ms** |
| **Health Check** | `GET /health` | `492 ms` | **458 ms` | `372 ms` | **Baseline** |

---

### Core Architectural Optimizations:
1. **Supabase PostgreSQL Expression & B-Tree Indexes:**
   - `users_email_lower_idx` on `LOWER(email)`: Eliminates table scans during login, registration, and email verification.
   - `users_username_lower_idx` on `LOWER(username)`: Instant O(log N) username resolution for search and profile queries.
   - `users_xp_idx` on `(xp DESC)`: High-velocity indexing for cinephile community leaderboards and cold-start fallback suggestions.
   - `entries_created_at_idx` & `entries_user_created_idx`: Accelerates feed sorting and reverse-chronological user catalogs.
   - `blocked_users_blocked_id_idx`: Fast lookup for bidirectional blocking exclusions.
2. **Concurrent Database Pipeline (`Promise.all`):**
   - Replaced serial database round-trips with parallel batches. In `/users/suggested`, 8 sequential queries were collapsed into 2 parallel batches. In `/mindlens/insights`, watch history and social suggestion network telemetry run simultaneously.
   - In `/entries/stats/summary`, 5 separate count/avg queries were consolidated into a single SQL statement utilizing `FILTER (WHERE ...)`.
3. **Outbound TMDB Fan-Out Parallelization (`Promise.allSettled`):**
   - In `/feed`, sequential loops for language and genre discovery were converted to parallel concurrent calls using `Promise.allSettled`, dropping outbound latency overhead from ~1,800ms to ~250ms.
4. **Multi-Tier In-Memory Short-TTL Caching:**
   - 5-minute memory cache for personalized feed recommendations.
   - 60-second cache for friend recommendations with instant invalidation on follow/unfollow events.
5. **PgBouncer Multi-Tenant Pooler Stability:**
   - Enforced `prepare: false` on the Postgres client connection pooler to prevent prepared statement collision errors across Supabase transaction-pooled connections.

### How to Re-Run Benchmarks
You can execute the automated performance test suite against any environment at any time:
```bash
# Run against Staging using Bun
bun scripts/perf-benchmark.ts

# Run against custom target
TARGET_URL="https://your-api-domain.com" bun scripts/perf-benchmark.ts
```

---

## 📖 6. Master Features & Business Logic Documentation

For an exhaustive, chapter-by-chapter walkthrough of all product capabilities, scoring algorithms, and database logic, see the **[Master Features & Logic Wiki](docs/FEATURES_AND_LOGIC_WIKI.md)**:

1. **Platform Philosophy & Core Pillars**: Frictionless logging, anti-algorithm social graph, cinematic aesthetic.
2. **User Authentication & Profile Onboarding**: JWT auth, OAuth, onboarding watch preferences, force update dialogs.
3. **Watch Tracking & Entry Logging**: Single-flight TMDB fetching, 1-10 rating parity, rewatch detection, spoiler masking.
4. **Currently Watching Shelf**: Live sessions, progress markers, atomic transition to watched.
5. **Curated Watchlists**: Recommender attribution (`suggestedByUserId`), filtering & search.
6. **Stacks & Ranked Lists**: Custom reorderable lists, visibility controls, shareable cards.
7. **The Hive Feed & Social Graph**: Real-time activity feed, cursor pagination, likes, nested comments, Who to Follow.
8. **Direct Suggestions & Impact Loop**: Friend recommendations, acceptance tracking, Suggester Impact score.
9. **SmartSuggest Recommendation Engine**: Multi-factor scoring formula ($S = w_f F + w_c C + w_t T + B_{\text{div}} - P_{\text{fatigue}}$), 3 modes (Social, Critic, Explore).
10. **MindLens 2.0 Behavioral Telemetry**: Shannon Information Entropy ($H(G)$), Russell Circumplex affect plane, Bayesian recommender trust ($RTS$).
11. **Deep Linking & Universal App Links**: Android App Links (`assetlinks.json`), Apple Universal Links (`apple-app-site-association`), QR scanning.
12. **Honey Badges & Cinephile XP**: 5-tier level progression, watch streaks, 8 achievement badges.
13. **Offline-First Architecture & Sync Protocol**: Conflict resolution, mutation queues, exponential backoff.
14. **Mobile-Responsive UX & Touch Ergonomics**: API payloads, low-latency queries, safe payloads.

> 💡 **Developer Note:** All documentation files reside within `docs/` and are strictly excluded from client JS/CSS bundles and native mobile binaries, adding **0 bytes** to production release artifacts.
