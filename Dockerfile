# syntax=docker/dockerfile:1

# ============================================================
# Stage 1: UI Builder
# Builds the Vite frontend into dist/ using a lightweight Alpine image.
# NO native modules compiled here — pure JS/TS only.
# ============================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Skip Playwright browser download during npm ci (not needed for build)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npx prisma generate
RUN npm run build

# ============================================================
# Stage 2: Production Runtime (Playwright Runner)
# Uses the official Playwright image which ships Chromium + deps
# for Ubuntu Jammy. npm ci runs HERE to ensure native C++ bindings
# (sqlite3, bcryptjs) compile against the runtime OS — NOT copied
# from the Alpine builder (which would cause ABI mismatch crashes).
# ============================================================
FROM mcr.microsoft.com/playwright:v1.58.2-jammy AS runtime

WORKDIR /app

# Install tini as a proper init system for signal forwarding & zombie reaping.
# (When using docker-compose with `init: true`, tini is redundant but harmless.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

# Production environment defaults
ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_URL=file:/app/data/hydra.db \
    HYDRA_DOCKERIZED=1 \
    HYDRA_PLAYWRIGHT_NO_SANDBOX=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install ONLY production dependencies inside the Jammy environment
# This ensures native C++ addons (bcryptjs, sqlite3/Prisma) link against
# the correct glibc — the #1 cause of crashes in V1 Dockerfile.
COPY package*.json ./
RUN npm ci --omit=dev

# Generate Prisma client against the runtime OS
COPY prisma ./prisma
RUN npx prisma generate

# Copy built frontend from Stage 1
COPY --from=builder /app/dist ./dist

# Copy server code (Express, routes, services)
COPY server ./server

# Copy entrypoint script
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create persistent data directory
RUN mkdir -p /app/data

EXPOSE 3001
VOLUME ["/app/data"]

# Use tini as init to properly forward signals and reap zombies.
# If running via docker-compose with init:true, this is belt-and-suspenders.
ENTRYPOINT ["tini", "--"]

# Entrypoint runs Prisma schema sync then starts Node
CMD ["docker-entrypoint.sh"]
