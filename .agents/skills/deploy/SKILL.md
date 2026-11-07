---
name: deploy
description: Procedures for deploying WatchHive Backend to Railway staging and production environments, verifying health checks, and validating logs.
---

# Deploy Skill — WatchHive Backend

## Deployment Target Topology
- **Platform**: Railway Containerized Infrastructure (Dockerfile + Railway CLI)
- **Staging URL**: `https://watchhive-api-staging.up.railway.app`
- **Production URL**: `https://watchhive-api-production.up.railway.app`
- **CI/CD**: Automatic branch triggers:
  - Pushes to `staging` branch deploy to Staging.
  - Pushes to `main` branch deploy to Production.

## Pre-Deployment Verification Checklist
1. Ensure all TypeScript builds cleanly:
   ```bash
   npm run build
   ```
2. Run test suites:
   ```bash
   npm test
   ```
3. Verify ESLint passes:
   ```bash
   npm run lint
   ```
4. Verify database schema migrations are committed in `drizzle/` if any schema changes occurred.

## Post-Deployment Health Check
Verify live deployment health:
```bash
curl -s https://watchhive-api-production.up.railway.app/health | jq .
```
Expected output:
```json
{
  "status": "ok",
  "database": "connected",
  "environment": "production"
}
```
