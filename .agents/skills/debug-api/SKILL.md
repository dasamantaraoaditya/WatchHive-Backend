---
name: debug-api
description: Step-by-step runbook for diagnosing API endpoint issues, rate limit tripping, CORS failures, cache staleness, and database connectivity.
---

# API Debugging Skill — WatchHive Backend

## Common Failure Modes & Solutions

### 1. `401 Unauthorized` / Invalid Token
- **Symptom**: Requests fail with `{ "error": "Invalid or expired token" }`.
- **Diagnostic**: Check `Authorization` header (`Bearer <token>`) or `jwt_access` cookie.
- **Root Cause Check**: Token version mismatch. Verify if `tokenVersion` in the DB was incremented after a password reset.
- **Fix**: Re-authenticate via `/api/v1/auth/login` or refresh via `/api/v1/auth/refresh`.

### 2. `403 Forbidden` / Email Verification Required
- **Symptom**: `{ "code": "email_verification_required" }`.
- **Fix**: User must verify email or check `users.is_email_verified` in database.

### 3. Cache Staleness (Updated data not reflecting)
- **Symptom**: User updates their profile or logs a watch, but old stats or feed entries persist.
- **Root Cause**: `invalidateUserCaches(userId)` was not called after the write operation in the route or service.
- **Fix**: Ensure `src/utils/cache.util.ts` -> `invalidateUserCaches(userId)` is triggered on all write mutations.

### 4. CORS Errors on Web Clients
- **Symptom**: `CORS: origin ... not allowed`.
- **Diagnostic**: Check `src/app.ts` allowed origin array and regexes:
  - `allowedVercelPattern`: `/^https:\/\/([a-z0-9-]+-)?(watchhive|watchershive)[a-z0-9-]*\.vercel\.app$/i`
  - `allowedRailwayPattern`: `/^https:\/\/watchhive-api-(production|staging)\.up\.railway\.app$/i`
- **Fix**: Ensure origin matches the production domain or staging preview domain regex.

### 5. Database Connection Issues
- **Diagnostic**: Call `/health`. If `database: "disconnected"`, check `DATABASE_URL` pool availability and Supabase status.
