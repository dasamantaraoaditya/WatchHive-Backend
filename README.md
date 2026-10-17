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
- **Multi-Environment Orchestration**: Isolated Staging and Production architectures running with automated CI/CD and protected branches.

---

## 🛠️ 2. Tech Stack

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Runtime** | Node.js (v20+) | Modern ES Modules (`"type": "module"`) |
| **Framework** | Express.js | Fast, unopinionated HTTP server with robust middleware |
| **Language** | TypeScript (v5+) | Full end-to-end type safety |
| **Database** | PostgreSQL | Relational database with UUID keys & strict foreign constraints |
| **ORM & Migrations** | Drizzle ORM & Drizzle Kit | Type-safe SQL query builder and schema management |
| **Authentication** | JWT + bcryptjs | Custom stateless authentication with access & refresh tokens |
| **External APIs** | TMDb API v3 | Rich movie/TV metadata, credits, posters, and trailers |
| **Cloud Storage** | AWS S3 SDK (`@aws-sdk/client-s3`) | Profile avatar storage and presigned uploads |
| **Push Notifications** | Firebase Admin SDK + Web Push | FCM for Android/iOS mobile devices & standard Web Push (VAPID) |
| **Performance Testing** | Autocannon + tsx | Automated concurrent benchmark suite and load testing |
| **Deployment & CI** | Railway + GitHub Actions | Automated branch deployments (`staging`, `main`) with branch protection |

---

## 🚀 3. How to Setup

### Prerequisites
- Node.js (v20.x or higher)
- PostgreSQL database (Local, Railway, or Supabase)
- npm (v9+)

### Step-by-Step Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/dasamantaraoaditya/WatchHive-Backend.git
   cd WatchHive-Backend
   ```

2. **Install dependencies**:
   ```bash
   npm install
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
   npm run db:push
   ```

5. **Seed Realistic Staging / Dev Data**:
   Populate test users, ranking stacks, watch entries, suggestions, and social follows:
   ```bash
   npx tsx scripts/seed-staging.ts
   ```

6. **Start Development Server**:
   ```bash
   npm run dev
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

The WatchHive API is continuously benchmarked under concurrent traffic. The following metrics were collected from our live **Railway Staging Environment** with real database queries, JWT verification, and multi-table aggregations.

### Live Staging Benchmark Results (Autocannon, 10 Concurrent Connections)

| Scenario | Method & Endpoint | Avg Throughput | Avg Latency | p99 Latency | Total Requests | Success Rate |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline Health** | `GET /health` | **37 req/s** | 266 ms | 406 ms | 369 | **100.0%** (0 errors) |
| **User Profile** | `GET /api/v1/users/me` | **37 req/s** | 264 ms | 444 ms | 372 | **100.0%** (0 errors) |
| **Watch Entries** | `GET /api/v1/entries` | **38 req/s** | 263 ms | 412 ms | 377 | **100.0%** (0 errors) |
| **Activity Feed** | `GET /api/v1/feed/trending` | **37 req/s** | 269 ms | 477 ms | 367 | **100.0%** (0 errors) |
| **Authentication** | `POST /api/v1/auth/login` | **14 req/s** | 341 ms | 726 ms | 144 | **100.0%** (0 errors) |

### Key Performance Characteristics:
1. **Sub-Millisecond Internal Database Latency:**
   Comparing `GET /health` (trivial `SELECT 1`) with `GET /api/v1/entries` (querying rows and parsing JSON) shows identical response times (~263ms). This confirms that internal query execution between the API and PostgreSQL is **$< 1\text{ms}$** over the private network mesh.
2. **Zero Failures Under Concurrency:**
   Across **1,629 continuous load requests**, the API maintained a **100% success rate** with **0 timeouts**, **0 dropped connections**, and **0 HTTP 5xx errors**.
3. **Optimized Password Hashing:**
   The `POST /api/v1/auth/login` endpoint handles **14 logins/sec** using bcrypt with 10 salt rounds, balancing strong resistance against brute-force attacks with efficient container CPU utilization.

### How to Re-Run Benchmarks
You can execute the automated performance test suite against any environment at any time:
```bash
# Run against Staging
npx tsx scripts/perf-benchmark.ts

# Run against custom target
TARGET_URL="https://your-api-domain.com" npx tsx scripts/perf-benchmark.ts
```
