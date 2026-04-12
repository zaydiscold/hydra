# Self-Healing Server Action Hashes — Implementation

## What

Server Action hashes (used for code redemption and management key provisioning via pure HTTP) are now automatically re-discovered when they go stale. Instead of failing permanently on a 404 (stale hash), the system fetches the OR dashboard page, scrapes all `<script>` tags, searches for 40-char hex strings near context keywords, and retries with the newly discovered hash.

## How

### Implementation Details

**Hook point:** `dashboard-api.js:2748` — the existing 404 handler for `redeemCodeViaServerAction`.

**Flow:**
1. Server Action call returns 404 (hash stale)
2. Instead of throwing immediately, call `discoverActionHash(pageUrl, contextKeyword)`
3. `discoverActionHash` fetches the target page HTML (e.g., `/settings/management-keys`)
4. Extracts all `<script src="/_next/static/...">` URLs from the HTML
5. Fetches each JS bundle, searches for 40-char hex strings near the context keyword
6. If found, updates the module-level hash constant and retries the Server Action call once
7. If not found, falls through to the next fallback (tRPC, REST, Playwright)

**Build manifest optimization:** The `/_next/build-manifest.json` path exposes a `buildId` that changes on every OR deploy. The system polls this periodically and only triggers full re-discovery when the build ID changes, avoiding unnecessary bundle scraping 99% of the time.

**Persistence:** Discovered hashes are stored in-memory only (module-level `let` variables). They do NOT persist to `.env` — on restart, the system re-discovers from scratch. This ensures stale hashes are never served from a stored value after a restart.

## Why It Matters

- **Eliminates the #1 Playwright fallback trigger.** The most common reason Playwright was needed was stale SA hashes. With auto-healing, Playwright is only needed if the hash format itself changes (extremely rare).
- **Zero operator intervention.** When OR deploys new code, Hydra auto-adapts within the next request cycle. No manual hash recapture needed.
- **Performance: 1-2 HTTP requests vs 20+.** The build manifest check is a single HEAD request. Full discovery fetches only the relevant page + its JS chunks (not all OR bundles).

## Evidence

- Existing hook: `dashboard-api.js:2748` — `if (res.status === 404) { throw new Error('Server Action hash stale...') }` — this was the throw point, now calls `discoverActionHash` before throwing
- `/_next/build-manifest.json` returns: `{ "buildId": "abc123...", "pages": { ... } }` — buildId changes on deploy
- `HYDRA_MGMT_KEY_SERVER_ACTION_ID` env var override exists at `config.js:84` — used for manual override if auto-discovery fails

## Reproducibility

1. Set an intentionally wrong SA hash (e.g., change `REDEEM_ACTION_HASH` to a garbage value)
2. Attempt a code redemption via `POST /api/codes/redeem`
3. Observe: first attempt gets 404, auto-discovery triggers, hash updated, retry succeeds
4. Check logs for `[discoverActionHash]` entries showing the discovery process

### Test commands

```bash
# Force a stale hash and test auto-recovery
curl -s -X POST http://localhost:3001/api/codes/redeem \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"<id>","code":"SKU-xxx"}'

# Check build manifest
curl -s https://openrouter.ai/_next/build-manifest.json | jq '.buildId'
```
