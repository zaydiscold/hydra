#!/bin/bash
set -uo pipefail
# NOTE: deliberately NOT `set -e`. We want the container to start the Node
# server even if Prisma schema sync fails — the server's own db-self-heal
# fallback (server/lib/db-self-heal.js) can usually recover, and crashing
# at boot blocks the operator from even SSHing in to investigate.

# Hydra Docker Entrypoint
# 1. Ensures persistent volume directory exists
# 2. Synchronizes Prisma schema non-destructively (best-effort)
# 3. Hands off to Node process (replaces shell via exec)

# 1. Ensure persistent volume directory exists
mkdir -p /app/data

# 2. Sync database schema non-destructively (best-effort).
# Using db push instead of migrate deploy because the project was developed
# with db push and may lack a clean migration history. --accept-data-loss=false
# prevents accidental data wiping while dynamically healing drifted schemas.
# If this fails, Node's startup db-self-heal will retry via $executeRawUnsafe.
echo "[Hydra] Synchronizing Prisma schema..."
if npx prisma db push --accept-data-loss=false; then
  echo "[Hydra] Schema synced via Prisma CLI."
else
  status=$?
  echo "[Hydra] WARN: prisma db push exited with status $status — continuing." >&2
  echo "[Hydra] WARN: Node will attempt db-self-heal at boot." >&2
fi

# 3. Hand off to Node process, substituting the shell.
# `exec` makes Node PID 1 (or the child of `init: true` in compose), so it
# receives SIGTERM directly and runs gracefulShutdown.
echo "[Hydra] Starting Hydra server..."
exec node server/standalone.js
