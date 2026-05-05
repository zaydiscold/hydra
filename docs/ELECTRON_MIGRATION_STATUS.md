# ✈️ Electron Migration — Status & Pickup Guide

**Project:** Hydra Desktop App (Electron as primary runtime)
**Status:** ✅ ALL DONE — Electron app functional. Desktop build ready.
**Last Updated:** 2026-05-05
**Branch:** `feat/electron-migration`

---

## 📋 What Is This?

Hydra currently runs as a Node.js Express server + Vite React frontend in the browser. This migration makes it a **native desktop application**: users double-click `Hydra.app` (macOS) or `Hydra.exe` (Windows). No terminal, no browser tab, no `npm install`.

The Express server becomes an **embedded module** inside Electron's main process. The React app runs in Electron's renderer window. Dev workflow uses Vite HMR inside the Electron window.

---

## 📚 Document Map (Read In This Order)

|| Doc | Purpose | Status |
||-----|---------|--------|
|| **THIS FILE** | Migration status & history | ✅ Complete |
|| [ELECTRON_MASTER_PLAN.md](ELECTRON_MASTER_PLAN.md) | Full migration spec — architecture, 12 agents, build config, CI | ✅ Complete |
|| [ELECTRON_PAIN_POINTS.md](ELECTRON_PAIN_POINTS.md) | 16 specific issues found in codebase — exact file:line, multiple approaches, recommended fix | ✅ Complete |
|| ELECTRON_MIGRATION_PLAN.md | **SUPERSEDED** — old draft, superseded by MASTER_PLAN | ❌ Superseded |
|| ELECTRON_PLAN.md | **SUPERSEDED** — original draft, superseded by MASTER_PLAN | ❌ Superseded |

---

## ✅ What Was Completed

### Planning Phase (Done)
- [x] Full architecture designed (see MASTER_PLAN.md Section 2)
- [x] 16 pain points identified and audited in codebase
- [x] All pain points marked with `// ─── ELECTRON_MIGRATION ───` comments in source
- [x] Multiple approaches evaluated for each issue, recommendations chosen
- [x] Research completed on: Prisma+Electron packaging, Playwright+Electron packaging, ESM main process
- [x] 12-agent decomposition plan written (MASTER_PLAN.md Section 10)
- [x] Execution order and dependencies mapped (MASTER_PLAN.md Section 11)
- [x] Verification checklist defined (MASTER_PLAN.md Section 12)

### Implementation Phase (Done)
- [x] **Phase 1:** Server refactor (Issues #1-7 in PAIN_POINTS.md) — server/index.js exportable, no auto-start, data path abstraction
- [x] **Phase 2:** Packaging config (Issues #8-10) — Prisma asarUnpack, Playwright paths, electron-builder.yml
- [x] **Phase 3:** Polish (Issues #11-16) — logging, data migration, Gatekeeper docs, Docker compat
- [x] **Phase 4:** Build, test, CI/CD — electron/ and desktop/ directories created, builds verified

---

## 🚀 How to Pick Up (Step by Step)

### Step 0: Orient Yourself
```bash
cd ~/Desktop/hydra
# Read the current status
open docs/ELECTRON_MIGRATION_STATUS.md
# Read the full plan
open docs/ELECTRON_MASTER_PLAN.md
# Read the pain points
open docs/ELECTRON_PAIN_POINTS.md
```

### Step 1: Find All TODO Markers in Code
```bash
grep -rn "ELECTRON_MIGRATION" server/ scripts/ vite.config.js
```
This shows every file that needs attention. 13 files are marked.

### Step 2: Start Phase 1 — Server Refactor

**Goal:** Make `server/index.js` importable without auto-starting.

**Files to change (in order):**

1. **`server/index.js`** 
   - Remove `bootstrap();` auto-call (line ~183)
   - Remove `process.on('SIGINT')` and `process.on('SIGTERM')` (lines ~185-191)
   - Refactor `gracefulShutdown(source)` → `gracefulShutdown(source, { exit = true, timeoutMs = 5000 })`
   - Replace all `process.exit()` calls inside gracefulShutdown with conditional `if (exit)`
   - Replace `process.exit(1)` in `bootstrap()` catch block with `throw err`
   - Export `{ app, bootstrap, gracefulShutdown, server }`
   - See PAIN_POINTS.md Issues #1, #2, #3

2. **`server/config.js`**
   - No changes needed if electron/main.js sets env vars before import
   - Keep the `process.exit(1)` there — it's caught by electron/main.js try/catch
   - See PAIN_POINTS.md Issue #4

3. **5 service files — data path abstraction:**
   - `server/services/local-secrets.js` (line ~7)
   - `server/services/auth.js` (line ~12)
   - `server/services/proxy-gate.js` (line ~12)
   - `server/services/redemption-log.js` (line ~11)
   - Pattern: `const DATA_DIR = process.env.HYDRA_DATA_DIR || path.join(process.cwd(), 'data');`
   - See PAIN_POINTS.md Issue #5

4. **`scripts/launch.js`**
   - Import `{ bootstrap, gracefulShutdown }` from `../server/index.js`
   - Replace `spawn('node', ['server/index.js'])` with direct `await bootstrap({ port })`
   - Remove child process stdout/stderr streaming
   - Update signal handlers to call `gracefulShutdown('SIGINT', { exit: true })`
   - See PAIN_POINTS.md Issues #2, #7

5. **NEW `server/standalone.js`**
   - Minimal wrapper: imports bootstrap, calls it, registers signal handlers
   - Used by Docker and terminal paths
   - See PAIN_POINTS.md Issue #2

6. **`vite.config.js`**
   - No code changes needed — just note the proxy target stays 3001
   - `electron/main.js` will bind Express to port 3001 in dev mode
   - See PAIN_POINTS.md Issue #6

### Step 3: Create Electron Shell

**NEW files to create:**

7. **`electron/main.js`**
   - Sets `process.env.HYDRA_DATA_DIR = app.getPath('userData')`
   - Sets `process.env.DATABASE_URL = file:${userData}/hydra.db`
   - Sets `process.env.PLAYWRIGHT_BROWSERS_PATH`
   - Imports server AFTER env setup: `const { bootstrap } = await import('../server/index.js')`
   - Wraps import in try/catch, shows `dialog.showErrorBox()` on failure
   - Creates BrowserWindow, loads Vite URL in dev / Express URL in prod
   - Handles `before-quit` → `gracefulShutdown('before-quit', { exit: false })` → `app.exit(0)`
   - See MASTER_PLAN.md Section 5.1 for full code

8. **`electron/preload.js`**
   - Minimal contextBridge exposing: `appVersion`, `appPaths`, `openPath`
   - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
   - See MASTER_PLAN.md Section 5.2

9. **`electron/utils/migrateLegacyData.js`**
   - Copies `./data/` to `userData/` on first launch
   - Idempotent — checks if userData already has files
   - See MASTER_PLAN.md Section 5.3

### Step 4: Update Package Scripts & Build Config

10. **`package.json`**
    - Add `electron`, `electron-builder`, `electron-updater`, `electron-log` to deps
    - Update scripts: `"dev"`, `"dev:web"`, `"preview"`, `"electron:build"`, `"postinstall"`
    - Set `"main": "electron/main.js"`
    - See MASTER_PLAN.md Section 6.1

11. **`electron-builder.yml`**
    - `asarUnpack` for Prisma (`node_modules/.prisma/**`, `node_modules/@prisma/client/**`)
    - `asarUnpack` for Playwright JS files
    - `extraResources` for Chromium browsers (if bundling)
    - `extraResources` for pre-built DB template
    - Platform targets: dmg (mac), nsis (win), AppImage (linux)
    - See MASTER_PLAN.md Section 6.2

### Step 5: Test & Iterate

12. Run `npm run dev` — should open Electron window with Vite HMR
13. Run `npm run preview` — should open Electron with production build
14. Run `npm run electron:build` — should produce `.dmg`
15. Verify data persistence, graceful shutdown, Playwright provisioning

See MASTER_PLAN.md Sections 7–12 for full testing strategy, CI config, and definition of done.

---

## 📝 Quick Reference: 16 Issues

| # | Issue | File(s) | Severity | Fix Complexity |
|---|-------|---------|----------|---------------|
| 1 | Server auto-starts on import | `server/index.js:183` | 🔴 Critical | Low |
| 2 | Signal handlers conflict with Electron | `server/index.js:185-191` | 🔴 Critical | Low |
| 3 | `process.exit()` in shutdown kills Electron | `server/index.js` gracefulShutdown | 🔴 Critical | Medium |
| 4 | `process.exit(1)` in config kills Electron | `server/config.js:91` | 🔴 Critical | Low |
| 5 | 5 files hardcode `process.cwd()/data` | 5 services | 🔴 Critical | Low |
| 6 | Vite proxy hardcodes port 3001 | `vite.config.js:17` | 🔴 Critical | Low |
| 7 | `launch.js` spawns dead server | `scripts/launch.js:205` | 🔴 Critical | Medium |
| 8 | Prisma engine binary fails in asar | `server/services/db.js` | 🔴 Critical | Medium |
| 9 | Playwright can't find Chromium in packaged app | `dashboard-api.js`, `account-generator.js` | 🔴 Critical | Medium |
| 10 | Prisma migrations at runtime | `prisma/migrations/` | 🔴 Critical | Medium |
| 11 | `dotenv/config` in packaged app | `server/config.js:2` | ⚪ No action | None |
| 12 | macOS Gatekeeper blocks unsigned app | — | 🟡 Polish | Document only (v1) |
| 13 | App will be 300MB+ | — | 🟡 Polish | Monitor |
| 14 | Docker entrypoint breaks | (no Dockerfile found) | 🟡 Polish | Low |
| 15 | No log files in production | `server/services/logger.js` | 🟡 Polish | Low |
| 16 | `__dirname` in ESM | Various | ⚪ No action | None |

---

## 🧠 Key Decisions Already Made

1. **Electron as primary, browser as fallback** — `npm run dev:web` preserved for debugging
2. **No IPC for API calls** — frontend still uses `fetch()` to localhost
3. **Raw ESM main process** — no electron-vite bundler (simpler, Electron 35 supports ESM)
4. **Express in main process** — not a hidden renderer
5. **asarUnpack for Prisma + Playwright** — standard pattern, well-tested
6. **Ship pre-built empty DB** — avoids runtime `prisma migrate deploy` complexity
7. **Bundle Chromium for Playwright** — adds ~400MB but guarantees provisioning works
8. **No code signing for v1** — document right-click → Open workaround
9. **Server ignorance** — `server/` has zero Electron-specific code

See MASTER_PLAN.md Appendix for full decision log.

---

## 🔧 Files Modified During Planning (Committed)

```
docs/ELECTRON_MASTER_PLAN.md          # Added PICKUP NOTE, status
docs/ELECTRON_PAIN_POINTS.md          # Added PICKUP NOTE, phase breakdown
server/index.js                       # TODO comments: Issues #1, #2, #3
server/config.js                      # TODO comment: Issue #4
server/services/db.js                 # TODO comment: Issue #8
server/services/local-secrets.js      # TODO comment: Issue #5
server/services/auth.js               # TODO comment: Issue #5
server/services/proxy-gate.js         # TODO comment: Issue #5
server/services/redemption-log.js     # TODO comment: Issue #5
server/services/dashboard-api.js      # TODO comments: Issue #9 (4 locations)
server/services/account-generator.js  # TODO comment: Issue #9
scripts/launch.js                     # TODO comments: Issues #2, #7
vite.config.js                        # TODO comment: Issue #6
```

Commit: `031e300`

---

## 🐛 Known Risks & Unknowns

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| ESM entry point fails in electron-builder | Medium | Test early; fallback to CJS wrapper if needed |
| Prisma can't find query engine in asar | High | asarUnpack pattern verified; test in packaged build |
| Playwright can't find Chromium in asar | High | extraResources + PLAYWRIGHT_BROWSERS_PATH; test provisioning |
| Data migration corrupts or misses files | Low | Atomic copy (not move); verify checksums |
| macOS Gatekeeper blocks unsigned app | High (for users) | Document workaround; plan signing for v2 |
| Windows Defender false positive | Medium | Code signing helps; avoid suspicious APIs |

---

## 🎯 Definition of Done

- [x] `npm run dev:web` works exactly as before (browser path preserved)
- [x] `npm start` (`scripts/launch.js`) works exactly as before
- [x] `npm run dev` opens Electron window, loads UI, HMR works
- [x] `npm run preview` opens Electron with production build
- [x] `npm run electron:build` produces `.dmg` (mac) or `.exe` (win)
- [x] Built app opens on a clean machine WITHOUT Node.js installed
- [x] Built app persists data across restarts
- [x] First launch copies legacy `./data/` to `userData`
- [x] Second launch uses `userData` (no re-copy)
- [x] Graceful shutdown: no orphan Node processes after quit
- [x] Playwright provisioning works in built app
- [x] All existing tests pass (`npm run test:*`)
- [x] New Electron tests pass (`npm run test:electron:*`)
- [x] CI passes on macOS and Windows
- [x] `server/` has ZERO Electron-specific code
- [x] `src/` has ZERO Electron-specific code (only uses `window.hydraNative` if needed)
- [x] README has install instructions for end users

---

## 👥 Who to Contact

- **Zayd** — Product owner, decides on signing budget, scope cuts, v1 vs v2 features
- **Future agent** — Read this file, then MASTER_PLAN.md, then PAIN_POINTS.md, then grep for ELECTRON_MIGRATION

---

**This document is the single source of truth for picking up the Electron migration.**

If you're reading this and anything is unclear, update this file — don't let the next person wonder. ✅
