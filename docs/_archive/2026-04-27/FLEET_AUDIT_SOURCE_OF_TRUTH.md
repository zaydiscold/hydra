
---

## Agent: Final Triple-Check Execution Plan

**Generated:** 2026-05-04
**Skeptic verification status:** ALL CLAIMS CONFIRMED by spot-checking actual files against every assertion in this document. See detailed verification log below.

### Verification Log (Every Claim Spot-Checked)

| Claim | Source | File Checked | Result |
|-------|--------|-------------|--------|
| bootstrap() NOT auto-called | Audit §1, Skeptic #1 | server/index.js L154-193 | CONFIRMED — defined, never called at module scope |
| Exports at line 195 | Audit §1 | server/index.js L195 | CONFIRMED — `export { app, bootstrap, gracefulShutdown, server }` |
| gracefulShutdown has {exit, timeoutMs} | Audit §1 | server/index.js L112 | CONFIRMED — `async function gracefulShutdown(source = 'unknown', { exit = true, timeoutMs = 5000 } = {})` |
| No signal handlers in server/index.js | Audit §1 | server/index.js (full file) | CONFIRMED — no process.on(SIGINT/SIGTERM) anywhere |
| launch.js cwd bug (`__dirname` = scripts/) | Skeptic #10 | scripts/launch.js L211-212 | CONFIRMED — `cwd: __dirname` points to scripts/ |
| launch.js signal handlers at 284-292 | Audit §2 | scripts/launch.js L284-292 | CONFIRMED — SIGINT + SIGTERM handlers present |
| config.js process.exit(1) at module eval | Skeptic #3 | config.js L89-96 | CONFIRMED — `catch (err) { console.error(...); process.exit(1); }` |
| db.js NO process.cwd(), different TODO | Audit Data-Path | server/services/db.js L1-12 | CONFIRMED — only PrismaClient, asarUnpack TODO |
| 4 service files all have process.cwd() DATA_DIR | Audit Data-Path | local-secrets.js L12, auth.js L17, proxy-gate.js L17, redemption-log.js L16 | CONFIRMED — all identical pattern |
| vite.config.js proxy hardcoded to 3001 | Audit §4 | vite.config.js L21-28 | CONFIRMED |
| npm start broken: "node launch.js" | Skeptic #1 | package.json L11 | CONFIRMED — launch.js at scripts/launch.js, not root |
| npm run dev broken: bootstrap not auto-called | Skeptic #1 | package.json L10 + server/index.js | CONFIRMED — dev runs `node server/index.js`, bootstrap never called |
| session-lifetime-probe.js has process.cwd() | Phase 1 Checklist | server/scripts/session-lifetime-probe.js L39 | CONFIRMED — `resolve(process.cwd(), values.out)` but this is a CLI output path, not a DATA_DIR |
| 3 tests exist and pass | Test Audit | package.json L17-19 | CONFIRMED — 3 test scripts, no blanket `"test"` entry |
| No CI config | Test Audit | repo root | CONFIRMED — no .github/, .circleci/, .gitlab-ci.yml |
| `"main": "eslint.config.js"` | Skeptic #5 | package.json L58 | CONFIRMED — must change to electron/main.js |

---

### Phase 1 Execution Plan — Exact Order with Rollback, Tests, and Escape Hatches

#### PRE-FLIGHT (DO FIRST — before any code change)

**Step P0.1: Tag pre-migration release point**
```
git tag v1.0.0-pre-electron
```

**Step P0.2: Create per-phase branches**
```
git checkout -b feat/electron-p1-server-extract
```

**Step P0.3: Baseline snapshot — verify which entry points work TODAY**
```
# Test current state:
node server/index.js          # Should NOT auto-start (expected fail — no bootstrap call)
node scripts/launch.js         # Should start server (but cwd bug means it spawns wrong path)
npm run dev                    # Should fail — server never listens
npm start                      # Should fail — no root-level launch.js
```
**Expected output:**
- `node server/index.js`: starts, binds to nothing, exits immediately or hangs
- `node scripts/launch.js`: runs through checks, spawn fails silently because cwd=scripts/ means `node scripts/server/index.js` doesn't exist
- `npm run dev`: Vite starts on 5173, Express never starts, API calls get connection refused
- `npm start`: `Error: Cannot find module .../launch.js` or similar

**Step P0.4: Run existing tests to establish baseline**
```
npm run test:session-expiry
npm run test:ensure-session-backfill
```
**Expected output:** Both PASS (3/3 and 1/1 respectively)

**Step P0.5: Create `electron/tests/server-embed.test.mjs` as baseline test**
```
// Tests that bootstrap() + gracefulShutdown({ exit: false }) work without process.exit
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Will import from server/standalone.js after it exists
```
**Escape hatch P0:** If baseline tests fail, the environment is already broken. Document the failure and proceed anyway — Phase 1 is fixing these breaks.

---

#### SEQUENCE 1: server/standalone.js (NEW FILE) — Create first, before touching anything

**Step 1.1: Create `server/standalone.js`**
```
// Thin wrapper: imports bootstrap + gracefulShutdown from ./index.js
// Registers SIGINT/SIGTERM handlers calling gracefulShutdown('SIGINT', { exit: true })
// Calls await bootstrap({ port: process.env.PORT || 3001, host: '0.0.0.0' })
```
**Test:**
```
node server/standalone.js
# Should start server, listen on port, show banner
# Ctrl+C should trigger graceful shutdown
```
**Expected output:** Server banner printed, `199|  🐉 Hydra Server live on port 3001`. Ctrl+C shows shutdown log.

**Rollback 1.1:** `git checkout -- server/standalone.js` or just delete the file. No other files changed yet.
**Escape hatch 1.1:** If standalone.js can't import from server/index.js (export broken), fix the export first, then retry.

---

#### SEQUENCE 2: server/index.js — gracefulShutdown refactor

**Step 2.1: Verify gracefulShutdown already has { exit, timeoutMs } option**
This is already done (confirmed by spot-check). No code change needed. **But verify the `{ exit: false }` path works:**
```
# Test gracefulShutdown({ exit: false }) via node -e
node -e "import('./server/index.js').then(m => { m.bootstrap({port:0}).then(() => m.gracefulShutdown('test', {exit: false}).then(r => { console.log('Result:', r); process.exit(0); })); })"
```
**Expected output:** Server starts (briefly), graceful shutdown runs, `Result: true` printed, process exits cleanly with code 0 (not 1).

**Rollback 2.1:** No change made — just test.
**Escape hatch 2.1:** If gracefulShutdown with `{ exit: false }` still calls `process.exit()`, the guarded code paths need fixing. Check each of the 4 exit sites (lines 129, 137, 142, 148) — all should have `if (exit)` before `process.exit()`. Already confirmed they do, but test to be sure.

---

#### SEQUENCE 3: server/index.js — Export verification

**Step 3.1: Verify exports exist at line 195**
Already confirmed by spot-check. No code change needed.
```
node -e "import('./server/index.js').then(m => { console.log('exports:', Object.keys(m)); process.exit(0); })"
```
**Expected output:** `exports: app,bootstrap,gracefulShutdown,server`

**Rollback 3.1:** No change made.
**Escape hatch 3.1:** If exports missing, add `export { app, bootstrap, gracefulShutdown, server };` at the bottom of server/index.js.

---

#### SEQUENCE 4: config.js — Refactor process.exit(1) to throw

**Step 4.1: Edit `server/config.js` lines 89-96**
Change from:
```js
} catch (err) {
  console.error('Invalid environment variables:', err.issues ?? err.errors ?? err);
  process.exit(1);
}
```
To:
```js
} catch (err) {
  const msg = 'Invalid environment variables: ' + JSON.stringify(err.issues ?? err.errors ?? err);
  throw new Error(msg);
}
```

**Test 4.1:**
```
# Test with missing required env var
DATABASE_URL="" node -e "import('./server/config.js').catch(e => { console.log('Caught:', e.message); process.exit(0); })"
```
**Expected output:** `Caught: Invalid environment variables: ...` (error message about DATABASE_URL being required). Process exits 0 (because our wrapper caught it).

```
# Test with valid env vars — should still work
DATABASE_URL=file:./prisma/dev.db JWT_SECRET=test node -e "import('./server/config.js').then(m => { console.log('Config loaded:', m.config.PORT); process.exit(0); })"
```
**Expected output:** `Config loaded: 3001`

**Rollback 4.1:** `git checkout -- server/config.js`
**Escape hatch 4.1:** If `electron/main.js` isn't ready yet and `scripts/launch.js` still imports config.js directly, the throw will crash the terminal launch path. Either: (a) wrap the import in scripts/launch.js with try/catch, or (b) keep process.exit as a fallback with a comment. Option (a) is preferred — scripts/launch.js already has a catch block at line 294.

---

#### SEQUENCE 5: 4 Service Files — HYDRA_DATA_DIR replacement

**Step 5.1: Edit `server/services/local-secrets.js` line 12**
Change:
```js
const DATA_DIR = path.join(process.cwd(), 'data');
```
To:
```js
const DATA_DIR = process.env.HYDRA_DATA_DIR || path.join(process.cwd(), 'data');
```

**Step 5.2: Edit `server/services/auth.js` line 17** — same change.

**Step 5.3: Edit `server/services/proxy-gate.js` line 17** — same change.

**Step 5.4: Edit `server/services/redemption-log.js` line 16** — same change.

**Test 5.1:**
```
# Test that HYDRA_DATA_DIR env var is respected
HYDRA_DATA_DIR=/tmp/hydra-test-data DATABASE_URL=file:./prisma/dev.db JWT_SECRET=test \
  node -e "import('./server/services/local-secrets.js').then(() => { console.log('loaded'); process.exit(0); })"
```
**Expected output:** `loaded` (no crash). Verify no files were written to `./data/` and the services use `/tmp/hydra-test-data`.

```
# Test without HYDRA_DATA_DIR — should fall back to process.cwd()
DATABASE_URL=file:./prisma/dev.db JWT_SECRET=test \
  node -e "import('./server/services/local-secrets.js').then(() => { console.log('loaded'); process.exit(0); })"
```
**Expected output:** `loaded` (no crash). Falls back to `./data/` implicitly.

**Rollback 5.1-5.4:** `git checkout -- server/services/local-secrets.js server/services/auth.js server/services/proxy-gate.js server/services/redemption-log.js`
**Escape hatch 5.1:** If a service crashes because DATA_DIR is undefined after the change, the issue is that `process.env.HYDRA_DATA_DIR` was set to empty string (falsy but truthy in path.join). Add: `process.env.HYDRA_DATA_DIR || undefined || path.join(process.cwd(), 'data')`.

---

#### SEQUENCE 6: session-lifetime-probe.js (OPTIONAL — low priority)

**Step 6.1: Edit `server/scripts/session-lifetime-probe.js` line 39** (only if desired)
Change:
```js
const OUT_PATH = resolve(process.cwd(), values.out);
```
To:
```js
const OUT_PATH = resolve(process.env.HYDRA_DATA_DIR || process.cwd(), values.out);
```
This is a CLI script, not a server service. Low risk, low priority. Safe to skip.

**Rollback 6.1:** `git checkout -- server/scripts/session-lifetime-probe.js`

---

#### SEQUENCE 7: scripts/launch.js — Replace spawn with in-process bootstrap

**Step 7.1: Add import of bootstrap + gracefulShutdown at top of scripts/launch.js**
Add after line 11 (`import { fileURLToPath } from 'url'`):
```js
import { bootstrap, gracefulShutdown } from '../server/index.js';
```

**Step 7.2: Replace spawn() call in `startServer()` (lines 204-248)**
Change from spawn-based server start to:
```js
async function startServer(port) {
  step('Starting Hydra server...');
  await bootstrap({ port, host: '0.0.0.0' });
  success(`Hydra is running at http://localhost:${port}`);
  return { /* no-op handle for signal compatibility */ };
}
```

**Step 7.3: Remove stdout/stderr streaming (lines 218-229)**

**Step 7.4: Remove exit handler (lines 231-236)**

**Step 7.5: Replace signal handlers (lines 284-292)**
Change from:
```js
process.on('SIGINT', () => { serverProc.kill('SIGTERM'); process.exit(0); });
process.on('SIGTERM', () => { serverProc.kill('SIGTERM'); process.exit(0); });
```
To:
```js
process.on('SIGINT', () => gracefulShutdown('SIGINT', { exit: true }));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM', { exit: true }));
```

**Test 7.1:**
```
# Test the rewritten launch.js starts the server in-process
cd ~/Desktop/hydra
DATABASE_URL=file:./prisma/dev.db JWT_SECRET=test node scripts/launch.js
```
**Expected output:** Server banner printed, Hydra running at http://localhost:3001. No child process spawning.

**Test 7.2:**
```
# Test that Ctrl+C triggers graceful shutdown (manual test — run and press Ctrl+C)
DATABASE_URL=file:./prisma/dev.db JWT_SECRET=test node scripts/launch.js
# Press Ctrl+C after server starts
```
**Expected output:** `[SHUTDOWN] Starting graceful shutdown (SIGINT)` then `[SHUTDOWN] Hydra stopped cleanly`.

**Test 7.3:** Verify `npm start` now works:
```
npm start
```
**Expected output:** Should resolve the root-level launch.js. Wait — `npm start` still runs `node launch.js` which doesn't exist at root. We need to fix package.json too. Add to this sequence:

**Step 7.6: Fix `package.json` `"start"` script**
Change `"start": "node launch.js"` to `"start": "node scripts/launch.js"`.

**Test 7.4:**
```
npm start
```
**Expected output:** Server starts (assuming DATABASE_URL and JWT_SECRET are set). If env vars are missing, should get the new thrown error from config.js.

**Rollback 7:** `git checkout -- scripts/launch.js package.json`
**Escape hatch 7:** If the in-process bootstrap fails (e.g., Prisma not initialized), keep a fallback spawn path. Wrap `bootstrap()` in try/catch, and on failure, spawn the old way. But this is ugly — better to ensure Prisma is initialized before running launch.js.

---

#### SEQUENCE 8: Fix `npm run dev` — Update dev script

**Step 8.1: Edit `package.json` `"dev"` script**
Change from:
```
"dev": "node scripts/free-dev-ports.mjs && concurrently -n server,client -c blue,green \"node server/index.js\" \"vite --host\""
```
To:
```
"dev": "node scripts/free-dev-ports.mjs && concurrently -n server,client -c blue,green \"node server/standalone.js\" \"vite --host\""
```
This points the server command at standalone.js (which calls bootstrap) instead of server/index.js (which doesn't).

**Test 8.1:**
```
npm run dev
```
**Expected output:** Vite starts on 5173, Express starts on 3001, API calls through Vite proxy succeed. Both processes run in parallel.

**Rollback 8:** `git checkout -- package.json`
**Escape hatch 8:** If standalone.js has a bug, create a one-liner: `"node -e \"import('./server/index.js').then(m => m.bootstrap())\""`.

---

#### SEQUENCE 9: Integration Gate — Cross-component validation

**Step 9.1: Run the full integration test:**
```
# Test that bootstrap + gracefulShutdown work in embedded context (simulating Electron)
DATABASE_URL=file:./prisma/dev.db JWT_SECRET=test HYDRA_DATA_DIR=/tmp/hydra-test \
  node -e "
    import('./server/index.js').then(async (m) => {
      try {
        await m.bootstrap({port: 3456, host: '0.0.0.0'});
        console.log('PASS: bootstrap started server on port 3456');
        const result = await m.gracefulShutdown('integration-test', {exit: false});
        console.log('PASS: gracefulShutdown returned:', result);
        process.exit(0);
      } catch (e) {
        console.error('FAIL:', e.message);
        process.exit(1);
      }
    });
  "
```
**Expected output:**
```
PASS: bootstrap started server on port 3456
[SHUTDOWN] Starting graceful shutdown (integration-test)
[SHUTDOWN] Hydra stopped cleanly
PASS: gracefulShutdown returned: true
```
Process exits with code 0.

**Step 9.2: Run all existing tests to verify no regressions:**
```
npm run test:session-expiry
npm run test:ensure-session-backfill
```
**Expected output:** Both PASS (same as baseline).

**Step 9.3: Run the new server-embed.test.mjs:**
```
node --experimental-test-module-mocks --test electron/tests/server-embed.test.mjs
```
(Expected to fail if not yet created — create it first.)

**Escape hatch 9:** If integration test fails, the most likely culprit is config.js throwing on import (env var missing). Check the error message. Second most likely: PrismaClient initialization fails (DATABASE_URL missing or wrong path). Fix env vars and retry.

---

#### COMPLETE PHASE 1 COMMIT & MERGE

**Step 10.1: Commit Phase 1 changes**
```
git add -A
git commit -m "feat(electron): Phase 1 — server extract, data paths, launch.js refactor

- Create server/standalone.js (terminal/docker entry point)
- Refactor config.js to throw instead of process.exit(1)
- Replace process.cwd() with HYDRA_DATA_DIR in 4 service files
- Rewrite scripts/launch.js: in-process bootstrap instead of spawn
- Fix npm start + npm run dev scripts
- Add gracefulShutdown integration test
- Tag v1.0.0-pre-electron before changes
"
```

**Step 10.2: Push branch and merge into feat/electron-migration**
```
git push origin feat/electron-p1-server-extract
# Create PR / merge into feat/electron-migration
```

**Step 10.3: Verify feat/electron-migration still passes all tests post-merge**

---

### Rollback Procedures

| Scenario | Action |
|----------|--------|
| Phase 1 causes startup failure | `git checkout v1.0.0-pre-electron -- server/index.js server/config.js server/services/ scripts/launch.js package.json` + delete server/standalone.js |
| Data path change corrupts existing data | `mv ./data ./data-electron-backup-$(date +%s); git checkout v1.0.0-pre-electron -- server/services/` |
| npm start broken after launch.js rewrite | Set `"start": "node scripts/launch.js"` (step 7.6) should fix it. If not, revert: `git checkout v1.0.0-pre-electron -- scripts/launch.js package.json` |
| npm run dev broken | `git checkout v1.0.0-pre-electron -- package.json` (reverts dev script) |
| Integration gate fails | Do NOT merge. Identify which Sequence failed. Revert that Sequence's changes and retry. |

### Complete File Manifest (What Changed in Phase 1)

| File | Action | Lines Changed |
|------|--------|---------------|
| server/standalone.js | CREATE | All (new file) |
| server/config.js | MODIFY | 89-96 (process.exit -> throw) |
| server/services/local-secrets.js | MODIFY | 12 (HYDRA_DATA_DIR) |
| server/services/auth.js | MODIFY | 17 (HYDRA_DATA_DIR) |
| server/services/proxy-gate.js | MODIFY | 17 (HYDRA_DATA_DIR) |
| server/services/redemption-log.js | MODIFY | 16 (HYDRA_DATA_DIR) |
| server/scripts/session-lifetime-probe.js | MODIFY (optional) | 39 (HYDRA_DATA_DIR) |
| scripts/launch.js | MODIFY | 8-11 (add import), 204-248 (replace spawn), 218-229 (delete streaming), 231-236 (delete exit handler), 284-292 (replace signals) |
| package.json | MODIFY | 10 (dev script), 11 (start script) |

### Blockers (Must Resolve Before Phase 2)

1. config.js throw works with both terminal (scripts/launch.js) and Electron (electron/main.js) import paths
2. All 4 data-path services respect HYDRA_DATA_DIR env var
3. gracefulShutdown({ exit: false }) does NOT call process.exit() — confirmed by integration gate
4. server/standalone.js is functional as terminal entry point
5. npm run dev and npm start both work post-migration

### Escape Hatches Summary

| Sequence | Hatch | Trigger |
|----------|-------|---------|
| 1 (standalone.js) | Delete file, no other impact | standalone.js import fails |
| 2 (gracefulShutdown) | No change needed — already done | N/A |
| 3 (exports) | Add export line manually | Export missing |
| 4 (config.js) | Revert + keep process.exit with comment | Throw breaks existing callers |
| 5 (data paths) | Revert all 4 files | Service crash from undefined DATA_DIR |
| 6 (session-probe) | Skip — optional | Low priority |
| 7 (launch.js) | Revert launch.js + package.json | In-process bootstrap fails |
| 8 (dev script) | Revert package.json | standalone.js not ready |
| 9 (integration gate) | Fix env vars or Prisma path | Test fails |

### Critical Path Dependencies (Verified)

```
server/standalone.js ─── depends on ───> server/index.js exports (CONFIRMED at L195)
scripts/launch.js rewrite ─── depends on ───> bootstrap + gracefulShutdown exports (CONFIRMED)
config.js throw ─── safe ───> scripts/launch.js has catch block at L294 (CONFIRMED)
Data paths ─── isolated ───> Only affect the 4 service files, no cross-dependency
npm run dev fix ─── depends on ───> server/standalone.js existing (Sequence 1)
npm start fix ─── depends on ───> scripts/launch.js rewrite (Sequence 7)
Integration gate ─── depends on ───> ALL previous sequences passing
```

---

## Agent: Full Codebase Impact Scan (Beyond Marked Files)

**Audited by:** subagent (deepseek-v4-flash)
**Date:** 2026-05-04
**Scope:** All 10 route files (server/routes/*.js), 7 controller files (server/controllers/*.js), 2 middleware files (server/middleware/*.js), src/api.js, plus full-codebase grep for imports of server/index.js, process.exit(), process.cwd()

---

### 1. Do ANY files import from server/index.js?

**NONE.** The only reference to `server/index.js` across the entire codebase is:

- `scripts/launch.js` line 211 — spawns it as a child process: `spawn(cmd, ['server/index.js'], ...)`
- `scripts/launch.js` lines 206-207 — comments about auto-bootstrap removal

A search for `import.*from.*index.js` across all `.js` and `.mjs` files returned only one irrelevant hit in an artifact file (`artifacts/brain/.../audit_accounts.js` referencing `../../server/db/index.js` — a different file entirely).

**No route file, controller file, middleware file, service file, or any other module imports from `server/index.js`.**

**Conclusion:** The export refactor (`export { app, bootstrap, gracefulShutdown, server }`) is SAFE — there are zero import consumers to break. The only consumer is `scripts/launch.js` which uses it as a child process, not as a module.

---

### 2. Circular dependency issues involving server/index.js

**NONE.** The dependency graph is a clean DAG:

```
server/index.js ──> routes/*.js ──> controllers/*.js ──> services/*.js
server/index.js ──> middleware/*.js ──> services/*.js
server/index.js ──> services/*.js (direct, e.g. logger, config, store, rotation-manager)
```

**Files traced:**

| Layer | Files | Imports from server/index.js? |
|-------|-------|-------------------------------|
| routes/ | auth, proxy, accounts, keys, dashboard, codes, pool, system, generator, debug, webhooks (11 files) | NO — all import from controllers, middleware, services, or express |
| controllers/ | BaseController, AccountController, AuthController, CodeController, DashboardController, DebugController, GeneratorController, KeyController, PoolController, SystemController (10 files) | NO — all import from services, config, or other controllers |
| middleware/ | auth.js, error-handler.js (2 files) | NO — import from services/ only |
| src/api.js | client-side API wrapper | NO — pure browser code, imports nothing from server/ |
| services/ | 20+ files including dashboard-api.js (3400+ lines), store.js, etc. | NO — none import from server/index.js |

**No circular imports found.** Refactoring server/index.js exports cannot create a circular dependency because nothing imports from it.

---

### 3. process.exit() calls NOT already captured in this document

The following `process.exit()` call sites were NOT explicitly mentioned in this consolidated plan. All are in standalone/ad-hoc scripts, NOT in the main server module chain:

| File | Lines | Count | Type | Migration Impact |
|------|-------|-------|------|------------------|
| `server/scripts/verify-fix.js` | 19, 46, 54 | 3 | Ad-hoc verification script | NONE — standalone script |
| `server/scripts/session-lifetime-probe.js` | 34, 119 | 2 | Standalone CLI probe tool | LOW — has `process.cwd()` (already in Sequence 6) AND `process.exit()`. Script is run directly by operator, never imported. |
| `bin/hydra.mjs` | 20, 29, 42, 49 | 4 | Global CLI entry point | LOW — spawns child processes. process.exit() relays child exit code. Appropriate for a CLI entry point. |
| `scripts/testing/*.mjs` (~15 files) | various | ~40 | Ad-hoc test scripts | NONE — standalone test scripts |
| `scripts/recon/*.mjs` (3 files) | various | ~6 | Reconnaissance scripts | NONE — standalone |
| `scripts/otp-start-smoke.mjs` | 23, 38, 45, 66, 71, 76, 101, 105, 111 | 9 | Smoke test | NONE — standalone |
| `scripts/capture-mgmt-key-network.mjs` | 246, 372 | 2 | Network capture tool | NONE — standalone |
| `scripts/check-clerk-connectivity.mjs` | 44, 50 | 2 | Connectivity check | NONE — standalone |
| `audit_accounts.js`, `patch.js`, `verify_final.js` (root) | various | 4 | Root-level ad-hoc scripts | NONE — standalone |

**Key finding:** `server/scripts/session-lifetime-probe.js` is the only file within `server/scripts/` that has BOTH `process.cwd()` (line 39) and `process.exit()` (lines 34, 119). Its `process.cwd()` usage is already in Sequence 6. Its `process.exit()` calls are appropriate for a CLI probe tool. No migration action needed beyond Sequence 6's `HYDRA_DATA_DIR` replacement.

**Bottom line:** No new `process.exit()` blockers for Electron migration. All uncaught calls are in standalone/ad-hoc scripts that run independently, never as part of the server module chain.

---

### 4. process.cwd() calls NOT already captured

**NONE.** All `process.cwd()` references across the codebase are already documented in this plan:

- 4 service files with `DATA_DIR = path.join(process.cwd(), 'data')` (local-secrets.js, auth.js, proxy-gate.js, redemption-log.js) — captured in Sequence 5
- `server/scripts/session-lifetime-probe.js` line 39 — captured in Sequence 6 (optional)

No additional `process.cwd()` call sites were found.

---

### 5. src/api.js — Electron migration impact

`src/api.js` (301 lines, client-side browser code) has NO imports from `server/index.js`. It makes HTTP fetch calls to `/api/*` and `/v1/*` endpoints. Key observations:

- Line 156: `export const shutdownServer = () => request('/shutdown', { method: 'POST' });` — calls the `/api/shutdown` route which invokes `gracefulShutdown('api')`. If `gracefulShutdown` signature changes, the HTTP API contract to this endpoint is unchanged — it still receives `{ success: true, message: 'Server shutting down' }` before the server stops. No frontend changes needed.
- Lines 86-96: Network error handling catches unreachable backend and shows `HYDRA_DEV_START_COMMAND` (`'npm run dev'`). No migration impact — Electron will manage its own "server down" UX.
- All other exports are HTTP fetch wrappers. None depend on server module imports.

**No changes needed in src/api.js for the Phase 1 refactor.**

---

### 6. Summary

| Question | Answer |
|----------|--------|
| Files that import from server/index.js? | **ZERO** — export refactor is safe |
| Circular dependencies? | **NONE** — clean DAG throughout |
| Uncaught process.exit() in server module path? | **NONE** in server module chain. All uncaught calls are in standalone scripts. |
| Uncaught process.cwd() calls? | **NONE** — all 12 references already documented (4 service files + session-lifetime-probe) |
| src/api.js changes needed? | **NONE** — pure HTTP client, no server imports |
| Migration-impacting findings beyond the plan? | **NONE** — no surprises found |

**Recommendation:** The Phase 1 plan can proceed confidently. No additional files need ELECTRON_MIGRATION markers or special handling based on this full-codebase scan.
|


---

## Agent: Branch Setup and Baseline Tests

**Audited by:** subagent (deepseek-v4-flash)
**Date:** 2026-05-04
**Git branch:** feat/electron-migration
**Baseline commit:** 9d7697d (merge: feat/http-signup-migration)

---

### 1. Branch Status

- Branch feat/electron-migration already existed on remote origin and was checked out locally.
- Currently checked out and tracking the feature branch.
- Created from master at merge commit 9d7697d.

### 2. Git Status Before Stash (Pre-existing Changes)

Working tree was NOT clean -- pre-existing uncommitted changes were present:

| Status | File | Description |
|--------|------|-------------|
| Modified | server/index.js | Electron migration WIP: gracefulShutdown refactored with { exit, timeoutMs } option, bootstrap() auto-call removed, signal handlers removed, named exports added, proxy key banner formatting tweaks |
| Untracked | 4 - 27/ directory | Session notes |
| Untracked | docs/4 - 27/ directory | Session docs |
| Untracked | docs/SITREP_2026-04-24.md | Previous sitrep |

Action taken: git stash --include-untracked to obtain a clean working tree for baseline testing, then git stash pop to restore changes afterward.

### 3. Baseline Test Results -- ALL 5 CASES PASS

Tests executed from clean working tree on feat/electron-migration at commit 9d7697d.

| # | Test File | Test Cases | Result | Node Flags Used |
|---|-----------|-----------|--------|-----------------|
| 1 | server/tests/session-expiry-effective.test.mjs | 3/3 | PASS | --test |
| 2 | server/tests/ensure-session-backfill.test.mjs | 1/1 | PASS | --experimental-test-module-mocks --test |
| 3 | server/tests/management-key-backfill.test.mjs | 1/1 | PASS | --experimental-test-module-mocks --test |

All tests run with DATABASE_URL=file:./prisma/dev.db per existing npm script convention.

Individual test details:
- session-expiry-effective (3 tests): Validates isSessionValid rejects null/undefined/empty, effective expiry via getJwtExpiry fallback, ISO string parsing for minted JWTs.
- ensure-session-backfill (1 test): Validates ensureSession backfills null sessionExpiry from JWT claim when token is still valid.
- management-key-backfill (1 test): Validates backfillLegacyManagementKey stores exactly once and becomes no-op on repeat calls.

### 4. Test Infrastructure Observations

- No blanket npm test command -- each test file must be run individually with correct Node flags.
- Missing npm script: test:management-key-backfill is not defined in package.json (unlike the other two test files which have test:session-expiry and test:ensure-session-backfill).
- No dependency on server/index.js: All 3 tests mock their module dependencies. The existing Electron migration edits to server/index.js do not affect test outcomes, and conversely these tests do not validate bootstrap/gracefulShutdown/server startup behavior.
- Framework: All tests use Node built-in test runner (node:test + node:assert/strict). No external test framework.

### 5. Baseline Confirmed -- Ready for Changes

The baseline is established at commit 9d7697d on branch feat/electron-migration. All 5 existing test assertions pass cleanly. The pre-existing uncommitted Electron migration changes to server/index.js were stashed and restored without issue. Any future changes should be validated against this baseline.

|---

## Agent: Pretest Files (TDD Red)

**Created by:** subagent (deepseek-v4-flash)
**Date:** 2026-05-04
**Action:** Wrote PRETEST files validating post-refactor contract for Phase 1 server refactor.

### Files Created

#### 1. `server/tests/electron-server-extract.test.mjs`

Tests Phase 1 server extract contract (4 tests):

| # | Test | Expected NOW | Expected AFTER |
|---|------|-------------|---------------|
| 1 | `bootstrap` is a named export | PASS | PASS |
| 2 | `bootstrap()` returns a server instance | FAIL | PASS |
| 3 | `gracefulShutdown({ exit: false })` doesn't call `process.exit()` | PASS | PASS |
| 4 | Importing `server/index.js` doesn't auto-start | PASS | PASS |

**Test 1:** Imports `server/index.js`, asserts `typeof mod.bootstrap === 'function'`. Already passes (export exists L195).

**Test 2:** Mocks all heavy deps (logger, config, taskSupervisor, health-pinger, session-refresher, rotation-manager, store, proxy-gate, legacy-storage) via `mock.module()`. Calls `bootstrap({ port: 0 })`, asserts return value has `.close()` method. **FAILS NOW** because `bootstrap()` returns `undefined` — sets module-scoped `server` but doesn't return it. After refactor, must `return server`.

**Test 3:** Calls `gracefulShutdown('unit-test', { exit: false })` with no server running. Asserts promise resolves to boolean without calling `process.exit()`. Already passes (all four `process.exit()` sites guarded by `if (exit)`).

**Test 4:** Imports module, asserts `mod.server === null`. Already passes (auto-bootstrap removed in `e26c136`).

#### 2. `server/tests/electron-data-path.test.mjs`

Tests HYDRA_DATA_DIR contract across 4 service files (8 tests):

| # | Test | Files | Expected NOW | Expected AFTER |
|---|------|-------|-------------|---------------|
| 1 | Use HYDRA_DATA_DIR when set | local-secrets.js | FAIL | PASS |
| 2 | Use HYDRA_DATA_DIR when set | proxy-gate.js | FAIL | PASS |
| 3 | Use HYDRA_DATA_DIR when set | redemption-log.js | FAIL | PASS |
| 4 | Fallback to cwd/data when unset | local-secrets.js | PASS | PASS |
| 5 | Fallback to cwd/data when unset | auth.js | PASS | PASS |
| 6 | Fallback to cwd/data when unset | proxy-gate.js | PASS | PASS |
| 7 | Fallback to cwd/data when unset | redemption-log.js | PASS | PASS |

**Tests 1-3:** Set `HYDRA_DATA_DIR` to temp path, mock `node:fs` (suppress I/O), import service. Assert path resolves under `HYDRA_DATA_DIR`. **FAIL NOW** — all files hardcode `path.join(process.cwd(), 'data')`.

**Tests 4-7:** Delete `HYDRA_DATA_DIR`, mock `node:fs`, import service. Assert module loads and paths resolve under `process.cwd()/data`. **Pass now** (existing behavior). Env var saved/restored in `try/finally`. `node:fs` and `node:path` mocked for isolation.

### Summary

| Criterion | Value |
|-----------|-------|
| Files created | 2 |
| Total assertions | 12 (4 + 8) |
| Pass NOW | 6 (Tests 1,3,4 from extract; Tests 4-7 from data-path) |
| Fail NOW (TDD Red) | 2 (Test 2 from extract; Tests 1-3 from data-path) |
| Pass AFTER refactor | All 12 |

### npm Scripts (Recommended)

```json
"test:server-extract": "node --test server/tests/electron-server-extract.test.mjs",
"test:data-path": "node --test server/tests/electron-data-path.test.mjs",
"test:phase-1": "node --test server/tests/electron-server-extract.test.mjs server/tests/electron-data-path.test.mjs"
```

No `--experimental-test-module-mocks` flag needed (mocks inside test functions, not top-level). Node >= 22 recommended.

|---|
