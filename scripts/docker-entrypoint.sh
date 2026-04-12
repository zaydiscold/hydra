#!/bin/bash
set -e

# Hydra Docker Entrypoint
# 1. Ensures persistent volume directory exists
# 2. Synchronizes Prisma schema non-destructively
# 3. Hands off to Node process (replaces shell via exec)

# 1. Ensure persistent volume directory exists
mkdir -p /app/data

# 2. Sync database schema non-destructively
# Using db push instead of migrate deploy because the project was developed
# with db push and may lack a clean migration history. --accept-data-loss=false
# prevents accidental data wiping while dynamically healing drifted schemas.
echo "[Hydra] Synchronizing Prisma schema..."
npx prisma db push --accept-data-loss=false

# 3. Hand off to Node process, substituting the shell
# exec ensures Node receives SIGTERM directly (tini forwards it)
echo "[Hydra] Starting Hydra server..."
exec node server/index.js
