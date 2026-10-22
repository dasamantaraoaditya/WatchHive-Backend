# ─── Stage 1: Build & Prune ───
FROM oven/bun:1-slim AS builder

WORKDIR /app

# Copy package descriptors and lockfile
COPY package.json bun.lock* ./

# Install dependencies (including devDependencies needed for build)
RUN bun install --frozen-lockfile

# Copy application source
COPY . .

# Compile TypeScript
RUN bun run build

# Install production-only dependencies
RUN rm -rf node_modules && bun install --production --frozen-lockfile

# ─── Stage 2: Minimal Production Runner ───
FROM oven/bun:1-slim AS runner

WORKDIR /app

# Copy compiled files and production modules from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Expose port (Railway / Render provides PORT env var)
EXPOSE 8080

ENV NODE_ENV=production

# Start directly with Bun
CMD ["bun", "dist/index.js"]
