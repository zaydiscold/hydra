# syntax=docker/dockerfile:1

# ============================================================
# Stage 1: UI Builder
# Builds the Vite frontend into dist/ on the same Debian family as runtime.
# Electron 42 tooling requires Node >=22.12, and Prisma generation should not
# run on Alpine/musl when the runtime is Debian/glibc.
# ============================================================
FROM node:22-bookworm AS builder

WORKDIR /app

# Skip Playwright browser download during npm ci (not needed for build)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install dependencies first (layer caching). Ignore postinstall here: the
# builder stage only runs Prisma generation and Vite, so Electron native rebuild
# work is unnecessary inside Docker.
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY . .
RUN npx prisma generate
RUN npm run build

# ============================================================
# Stage 2: Production Runtime (node:22-bookworm)
#
# MIGRATION NOTE (2026-04-21):
# Was: mcr.microsoft.com/playwright:v1.58.2-jammy (~2.1GB bundled Chromium)
# Now: node:22-bookworm (~500MB) + on-demand Chromium (~350MB) = ~1.1GB total
#
# Why bookworm: node:*-jammy is not available for the current runtime line.
# bookworm is
# Debian 12, glibc-based (not Alpine/musl), so native C++ addons link correctly.
#
# Why no tini: Node handles SIGTERM fine. Also avoids apt-get which was
# failing with 403 Forbidden from deb.debian.org behind Docker Desktop proxy.
#
# Why no --with-deps: node:22-bookworm already includes most Chromium system
# libraries. --with-deps runs apt-get which fails in this Docker environment.
# If Chromium crashes at runtime, install deps manually in the container.
#
# Layer order is load-bearing — npm ci MUST run BEFORE playwright install.
# ============================================================
FROM node:22-bookworm AS runtime

WORKDIR /app

# Skip tini, Node handles SIGTERM fine via exec in entrypoint.
# This avoids apt-get hitting 403 from deb.debian.org behind Docker Desktop proxy.
# Browser fallback remains available for CAPTCHA-gated signup flows.

# Production environment defaults
ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_URL=file:/app/data/hydra.db \
    HYDRA_DOCKERIZED=1 \
    HYDRA_PLAYWRIGHT_NO_SANDBOX=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install ONLY production dependencies inside the Bookworm environment.
# This ensures native C++ addons (bcryptjs, sqlite3/Prisma) link against
# the correct glibc — the #1 cause of crashes in V1 Dockerfile.
COPY package*.json ./
# `--ignore-scripts` skips package.json `postinstall: electron-builder install-app-deps`.
# Docker doesn't need electron-builder rebuilding native modules — Hydra in
# the container only runs server-side code (Express + Prisma). The legitimate
# native rebuilds (`npx prisma generate`) are invoked explicitly below.
# Without --ignore-scripts the build fails with exit code 127 because
# electron-builder lives in devDependencies which --omit=dev strips out.
RUN npm ci --omit=dev --ignore-scripts

# Install Chromium for Playwright fallback (dashboard-api provisioning path).
# Must run AFTER npm ci so the playwright binary exists in node_modules/.bin.
# node:22-bookworm already includes most Chromium system deps (libglib2.0, libdbus-1-3, etc.)
# so we skip --with-deps (which runs apt-get and can fail behind Docker Desktop proxy).
# If you get runtime Chromium errors, add --with-deps back and fix the proxy first.
RUN npx playwright install chromium

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

# CRITICAL: ENTRYPOINT must be the entrypoint script (which runs Prisma schema
# sync then `exec node server/standalone.js`). Earlier shape was
#   ENTRYPOINT ["node", "--"]
#   CMD ["docker-entrypoint.sh"]
# which concatenates to `node -- docker-entrypoint.sh` — Node tries to parse
# a bash script as JS and the container exits with a SyntaxError on first run.
# `init: true` in docker-compose.yml provides PID 1 / SIGTERM forwarding, so
# we don't need a Node-as-init shim here.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
