---
name: test
description: Guidelines and commands for executing unit, integration, and E2E tests for WatchHive Backend using Jest and Bun.
---

# Testing Skill — WatchHive Backend

## Test Suites & Runners
WatchHive Backend uses Jest configured with experimental VM modules for ESM support, and also supports Bun's native test runner.

### Running All Tests
```bash
npm test
```
Or with Bun:
```bash
npm run test:bun
```

### Running a Specific Test File
```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/unit/auth.service.test.ts
```

### Writing Tests
- Place unit tests under `tests/unit/`.
- Place integration/e2e tests under `tests/e2e/`.
- Mock external APIs (TMDb, Firebase Admin, Resend/SMTP) to prevent test flakiness or external credential requirements.
- Mock database calls using transaction rollbacks or in-memory fixtures.
