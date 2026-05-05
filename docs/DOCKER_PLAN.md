# Hydra Dockerization Plan

**Status:** ✅ FULLY IMPLEMENTED & SMOKE TESTED (session 21/22) | **Priority:** P1

All 8 gotchas are resolved. Dockerfile, docker-compose.yml, entrypoint, .dockerignore, build helper, and ghcr.io Actions workflow are all committed and pushed to master.

## Why Docker?

Docker here is not just for deployment — it's **version-controlled distribution**. The problem it solves:

> Giving Hydra to someone else means they need: correct Node version, `npm install` resolving cleanly, `.env` configured, Prisma migrations run, port 3001 free. That's 15+ steps and usually breaks.

With Docker: `docker compose up`. That's it. The image has the right Node version, the right npm dependencies compiled against the right OS, Prisma synced, everything. Anyone with Docker Desktop can run the same exact binary you're running.

The **version control** angle: every push to `master` triggers the GitHub Actions workflow (`.github/workflows/docker.yml`) which builds a new image and pushes it to `ghcr.io/zaydiscold/hydra:latest`. The git commit SHA is also tagged (`sha-abc1234`). This means:
- Every version of Hydra ever built is stored and pullable by tag
- Rolling back = `docker compose pull ghcr.io/zaydiscold/hydra:sha-abc1234`
- Updating = `docker compose pull && docker compose up -d`

The **data stays local** because the bind mount (`./data:/app/data`) makes Docker read your local `data/` directory directly. The image contains zero user data — it's a pure runtime. Each person who runs it has their own `data/` with their own encrypted accounts and secrets.

## Quick Start

```bash
# Run with your existing local data (accounts, sessions, secrets):
docker compose up

# Or build locally first:
./scripts/docker-build.sh && docker compose up
```

The app will be at `http://localhost:3001`.

## Database path (important)

The canonical database is `data/hydra.db`. Both dev mode and Docker use this path.

Your `.env` should have:
```
DATABASE_URL="file:/Users/zaydk/Desktop/hydra/data/hydra.db"
```

Docker's `docker-compose.yml` overrides with `DATABASE_URL=file:/app/data/hydra.db` (same file, different mount path inside the container).

**Historical note:** The project previously used `prisma/dev.db` as the dev database. If your accounts are missing from Docker, check whether your real database is at `prisma/dev.db` — copy it to `data/hydra.db` to consolidate:
```bash
cp prisma/dev.db data/hydra.db
```
Then update your `.env` to point at `data/hydra.db` so dev mode uses the same location going forward.

## Cursor / AI IDE integration

Hydra works as a drop-in OpenAI-compatible proxy for Cursor, Continue, any AI IDE:
- **Base URL:** `http://localhost:3001/v1`
- **API Key:** `sk-hydra-<your-key>` (shown at startup, derived from your `local-secrets.json`)

This works identically whether you're running via `npm run dev` or `docker compose up`. Same port, same endpoints, same key.

## Volume Strategy: Local vs Server Deployment

**Local use (current config in docker-compose.yml):**
```yaml
volumes:
  - ./data:/app/data   # bind mount → uses your actual local data/
```
This is why your accounts and sessions survive — Docker is reading the exact same `data/` directory that the dev server uses. No login prompt.

**Server/shared deployment:** swap to a named volume so Docker manages the lifecycle independently of any local path:
```yaml
volumes:
  - hydra_data:/app/data

volumes:
  hydra_data:           # Docker-managed, survives container restarts
```

**Data safety:** `data/` is in `.gitignore` and `.dockerignore`. The SQLite DB, `local-secrets.json`, and `proxy-gate.json` never leave your machine via git or image builds.

## ghcr.io CI/CD

`.github/workflows/docker.yml` — triggers on every push to `master` and on `v*.*.*` git tags.
- Tags pushed: `ghcr.io/zaydiscold/hydra:latest` + `ghcr.io/zaydiscold/hydra:sha-<short>` + semver on tags
- Uses `GITHUB_TOKEN` — no manual secrets needed
- Layer cache stored at `ghcr.io/zaydiscold/hydra:buildcache` (speeds up rebuilds ~80%)

To publish a versioned release:
```bash
git tag v1.0.1 && git push origin v1.0.1
```

---

## Background: The "Oopsies" That Were Identified in V1

Standard containerization paradigms break down due to Hydra's specific stack (Playwright, SQLite, Express Rate Limiting, Node Native Modules).

---

## 🛑 The "Oopsies" Identified in V1

### 1. The Rate Limiter "Self-DDoS" Trap
**The Flaw:** Hydra uses `express-rate-limit` for authentication and proxy routes. In Docker, all incoming requests hit the Express server via the internal Docker bridge network (e.g., `172.17.0.1`). Because Express doesn't know it's behind a proxy/Docker bridge, it logs the bridge IP for *every* request. The Rate Limiter will falsely see 1000 requests from one IP and immediately lock out ALL users and automated systems.
**The Fix:** We must explicitly enable `app.set('trust proxy', 1)` in `server/index.js` when running in production/Docker so Express resolves the true `X-Forwarded-For` IP.

### 2. The Playwright Zombie Memory Leak
**The Flaw:** In Docker, the `ENTRYPOINT` or `CMD` script runs as PID 1. When the container stops (`docker stop`), a SIGTERM is sent to PID 1. Standard shell scripts do not forward signals to child processes. If Playwright has spawned headless Chromium instances during an account generation task, those Chromium processes will become unkillable zombie processes eating host RAM.
**The Fix:** We must use `tini` or `dumb-init` as the Docker `ENTRYPOINT`. Tini acts as a proper init system, reaping zombie processes and correctly forwarding SIGTERM to Node and Chromium.

### 3. The `node_modules` ABI Mismatch (C++ Addons)
**The Flaw:** `bcryptjs` and `sqlite3` (via Prisma) compile native C++ bindings upon `npm install`. If we run `npm ci` in a `node:20-slim` (Debian) build stage, and then copy `node_modules/` into the `mcr.microsoft.com/playwright` (Ubuntu Jammy) production stage, the native bindings will violently crash due to mismatched `glibc` libraries.
**The Fix:** Stage 1 (Builder) will only build the `dist/` Vite frontend. Stage 2 (Production) *must* independently run `npm ci --omit=dev` and `npx prisma generate` directly inside the Jammy OS boundaries to guarantee native C++ bindings match the runtime. 

### 4. Prisma `db push` vs `migrate` Conflict
**The Flaw:** The project `package.json` setup script currently uses `npx prisma db push --accept-data-loss`. However, a `prisma/migrations` folder exists! If users have been using `db push` locally, their database lacks a strict migration history. Running `npx prisma migrate deploy` in the Docker entrypoint will crash because the database schema has drifted from the rigid migration history.
**The Fix:** The Docker entrypoint should use `npx prisma db push --accept-data-loss=false` to ensure the schema matches the Prisma models without requiring a flawless linear migration history, preventing accidental data wiping while dynamically healing drifted schemas.

---

## 🕵️ V3 Deep Reconnaissance & Edge-Case Findings

A tertiary pass using code tracing and OSINT techniques (`curl -I https://openrouter.ai`) revealed nuanced constraints that will impact Hydra explicitly in Docker environments:

### 5. Datacenter IP Blacklisting (The Cloudflare Trap)
**The Discovery:** OpenRouter is hosted on Vercel and protected by Cloudflare Enterprise. While Hydra's automated Playwright login fallback works *locally* because it runs on residential ISPs, moving Hydra to a cloud Docker environment (DigitalOcean, AWS, Linode) changes the IP ASN to a datacenter.
**The Threat:** Cloudflare heavily scrutinizes datacenter IPs. `chromium.launch({ headless: true })` without stealth plugins (`playwright-extra`) will instantly trigger Turnstile CAPTCHAs or `403 Forbidden` response codes from OpenRouter's dashboard when provisioning. 
**The Mitigation:** Users deploying this Docker image on public VPS hostings MUST be warned that automated provision features may be heavily ratelimited or blocked unless routed through a residential proxy. Because the codebase currently lacks proxy support inside `chromium.launch()`, Playwright will execute directly under the VPS's Datacenter IP.

### 6. Secret Key and Local Data Scaffolding
**The Discovery:** By tracing `server/services/local-secrets.js` and `redemption-log.js`, I discovered that the app writes stateful artifacts like `local-secrets.json` and `redemption-log.json` to a directory named `data/` derived from `process.cwd()`.
**The Threat:** If a user only sets `DATABASE_URL=file:/app/data/hydra.db` in their `.env`, they might think their data is safe. However, the application uses `process.cwd()/data` for multiple files. If the Dockerfile's `WORKDIR` is `/app`, both `local-secrets.json` and `redemption-log.json` will be written to `/app/data/`.
**The Mitigation:** This identically matches the proposed volume mount `- hydra_data:/app/data`, which proves this mount covers MORE than just the SQLite database. It covers the encryption keys (`local-secrets.json`) required to decrypt the vault. This is a critical success factor for the Docker configuration: `/app/data` is the absolute source of truth.

### 7. The `/tmp` UnionFS Exhaustion
**The Discovery:** The `.env` template indicates network logs and Playwright debug artifacts write to `$TMPDIR`/hydra-provision-debug/ (e.g., `HYDRA_PROVISION_NETWORK_LOG=1`).
**The Threat:** In Docker, `/tmp` uses the overlay filesystem (UnionFS). If an operator runs Hydra continuously with debug logs on, Playwright traces and network logs will fill the Docker container's immutable layer until node runs out of disk space.
**The Mitigation:** Add a note in `docker-compose.yml` that `HYDRA_PROVISION_NETWORK_LOG` and `HYDRA_PROVISION_DEBUG` should absolutely be `0` in a persistent containerized environment, or `/tmp` must be mounted as `tmpfs` into the container limits.

### 8. Webhook Ingress (The NAT Constraint)
**The Discovery:** The route `server/routes/webhooks.js: /api/webhooks/clerk` processes incoming push events from Clerk to `webhook-idempotency.js`.
**The Threat:** Docker containers typically live behind NAT. If OpenRouter/Clerk implements external webhooks that must reach Hydra, they will fail unless Hydra is publicly exposed to the internet.
**The Mitigation:** If webhooks are vital, users must be instructed to use Cloudflare Tunnels (cloudflared) or Ngrok alongside Docker to provide Clerk with a valid ingress endpoint. (For local dashboard usage, perhaps this webhook is rarely used or only used for cloud-hosted versions of the tool).

---

## The Corrected Multi-Stage Architecture

### Stage 1: The UI Builder
- **Base:** `node:20-alpine` (Fastest, lightest for pure JS builds)
- **Action:** Install all `devDependencies`, copy `src/`, run `Vite build`.
- **Note:** Do *not* generate Prisma or native modules here.

### Stage 2: The Playwright Runner
- **Base:** `mcr.microsoft.com/playwright:v1.58.2-jammy`
- **Setup Actions:**
  1. Install `tini` via `apt-get install -y tini`.
  2. Copy `package*.json` and `prisma/`.
  3. Run `npm ci --omit=dev` (Compiles native SQLite & bcrypt for Ubuntu Jammy).
  4. Run `npx prisma generate`.
  5. Copy `dist/` from Stage 1. 
  6. Copy `server/` files.

---

## Mandatory Code Modifications

### A. The Rate Limiter Proxy Hook
In `server/index.js`, right before standard middleware:
```javascript
// Trust the Docker internal bridge / reverse proxy to prevent rate-limit global lockouts
if (process.env.NODE_ENV === 'production' || process.env.HYDRA_DOCKERIZED === '1') {
  app.set('trust proxy', 1);
}
```

### B. Playwright Sandbox Override
In `server/services/account-generator.js`, Chromium must run with `--no-sandbox` because the container defaults to the `root` user:
```javascript
const launchArgs = [];
if (process.env.HYDRA_PLAYWRIGHT_NO_SANDBOX === '1') {
  launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
}
const browser = await chromium.launch({ headless: true, args: launchArgs });
```

### C. Persistent Paths
In the `.env` provided to the container:
```env
# Mapped to a Docker Volume to survive restarts
DATABASE_URL="file:/app/data/hydra.db"
```

---

## The Bulletproof Boot Sequence

Instead of directly running Node, Docker will use this `docker-entrypoint.sh`:
```bash
#!/bin/bash
set -e

# 1. Ensure persistent volume directory exists
mkdir -p /app/data

# 2. Sync database schema non-destructively
echo "Synchronizing Prisma schema..."
npx prisma db push --accept-data-loss=false

# 3. Hand off to node process, substituting the shell
echo "Starting Hydra server..."
exec node server/index.js
```

### The resulting `docker-compose.yml`
```yaml
version: '3.8'
services:
  hydra:
    image: ghcr.io/zayd/hydra:latest
    build: .
    init: true # Docker runtime equivalent of Tini (remedies zombie processes)
    ports:
      - "3001:3001"
    volumes:
      - hydra_data:/app/data
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:/app/data/hydra.db
      - HYDRA_PLAYWRIGHT_NO_SANDBOX=1
      - HYDRA_DOCKERIZED=1
    restart: unless-stopped

volumes:
  hydra_data:
```

---

## Implementation Notes (File:Line References)

### Gotcha #1 — Rate Limiter Self-DDoS
- **Target file:** `server/index.js:34` (after `const app = express();`)
- **Insert before line 40** (`app.use(cors())`):
  ```javascript
  if (process.env.NODE_ENV === 'production' || process.env.HYDRA_DOCKERIZED === '1') {
    app.set('trust proxy', 1);
  }
  ```
- Without this, every Docker request appears from `172.x.x.x` → rate limiter locks out all users.

### Gotcha #2 — Playwright Zombie Memory Leak
- **Handled by:** `docker-compose.yml` `init: true` (Docker-native tini equivalent)
- **No code change needed** — Docker Compose `init: true` provides proper PID 1 signal forwarding.
- Alternative: `ENTRYPOINT ["tini", "--"]` in Dockerfile if not using Compose.

### Gotcha #3 — node_modules ABI Mismatch
- **Dockerfile line:** Stage 2 MUST run `npm ci --omit=dev` + `npx prisma generate` inside `mcr.microsoft.com/playwright:v1.58.2-jammy`
- **NEVER** `COPY --from=build /app/node_modules` — this was the V1 flaw.
- Current `Dockerfile:33` does exactly this wrong pattern. Must be replaced.

### Gotcha #4 — Prisma db push vs migrate
- **Target file:** `scripts/docker-entrypoint.sh` line with `npx prisma db push --accept-data-loss=false`
- **Current Dockerfile:44** uses `--skip-generate` flag only — needs `--accept-data-loss=false` to prevent accidental wipes.

### Gotcha #5 — Datacenter IP Blacklisting
- **Target file:** `docker-compose.yml` — add comment warning about `HYDRA_PROVISION_*` env vars
- **No code change** — documented in compose file comments.

### Gotcha #6 — Secret Key / Data Scaffolding
- **Volume mount:** `hydra_data:/app/data` covers SQLite + `local-secrets.json` + `redemption-log.json`
- **Source:** `server/services/local-secrets.js` writes to `process.cwd()/data/`
- Already correctly handled by the volume mount plan.

### Gotcha #7 — /tmp UnionFS Exhaustion
- **Target file:** `docker-compose.yml` — add `tmpfs: /tmp` or comment disabling debug flags
- **Env vars to warn about:** `HYDRA_PROVISION_NETWORK_LOG`, `HYDRA_PROVISION_DEBUG`

### Gotcha #8 — Webhook Ingress / NAT
- **Source file:** `server/routes/webhooks.js` (`/api/webhooks/clerk`)
- **No code change** — documented in compose file comments about Cloudflare Tunnels.

### Code Mod A — Trust Proxy
- **File:** `server/index.js`
- **Location:** Line 34, immediately after `const app = express();`
- **Already detailed above** (Gotcha #1)

### Code Mod B — Playwright Sandbox Override
- **File:** `server/services/account-generator.js:79`
- **Current code:** `const browser = await chromium.launch({ headless: true });`
- **Replace with:**
  ```javascript
  const launchArgs = [];
  if (process.env.HYDRA_PLAYWRIGHT_NO_SANDBOX === '1') {
    launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  const browser = await chromium.launch({ headless: true, args: launchArgs });
  ```

### Docker File Manifest
| File | Status | Notes |
|------|--------|-------|
| `Dockerfile` | REWRITE | Multi-stage per plan (alpine builder + playwright runner) |
| `docker-compose.yml` | CREATE | init:true, volume, env vars, comments for gotchas |
| `.dockerignore` | UPDATE | Add scripts/, AGENTS.md, CLAUDE.md |
| `scripts/docker-entrypoint.sh` | CREATE | mkdir data, prisma db push, exec node |

---

## Next Steps for Execution
With these edge cases documented, we can confidently create the `.dockerignore`, `Dockerfile`, and `docker-compose.yml`, followed by the exact code modifications to `server/index.js` and `account-generator.js`.

---

## Errata — 2026-05-05

Two production-blocking bugs found and fixed during a device-agnostic audit.

### 1. `Dockerfile` ENTRYPOINT/CMD pair was broken

**Symptom:** `docker compose up` exits immediately with a JS SyntaxError trying to parse `#!/bin/bash`.

**Cause:** The Dockerfile had:
```dockerfile
ENTRYPOINT ["node", "--"]
CMD ["docker-entrypoint.sh"]
```
Docker concatenates these into `node -- docker-entrypoint.sh`, which asks Node to interpret a bash script as JavaScript. Node parses `#!/bin/bash` as a syntax error and exits.

**Fix:**
```dockerfile
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
```
The bash entrypoint already does `exec node server/standalone.js` on its last line, so PID 1 still ends up as Node. SIGTERM forwarding is provided by `init: true` in `docker-compose.yml`.

### 2. `docker-entrypoint.sh` was not resilient to schema-sync failure

**Symptom:** A transient Prisma push failure (network blip during `prisma generate`, locked DB during a backup) crashed the container at boot. Combined with `restart: unless-stopped`, the container would loop-crash forever, and the operator couldn't `docker exec` in to investigate.

**Cause:** `set -e` made the entire script abort on the first non-zero exit, including from `npx prisma db push`.

**Fix:** Switched from `set -e` to `set -uo pipefail` and explicitly handle the prisma push exit code — log a warning and continue. The Node server's own `db-self-heal` fallback (in `server/lib/db-self-heal.js`) replays migration SQL idempotently at boot, so the container starts even if the Prisma CLI step fails.

### Quick verification

```bash
# clean rebuild + run
docker compose build --no-cache
docker compose up

# expect: schema sync log (or warn), then "[Hydra] Starting Hydra server..."
# expect: HTTP 200 from `curl http://localhost:3001/`
```
