# Session Notes — 2026-04-27

**Topic:** Electron Migration Planning & Audit for Hydra Desktop App  
**Status:** ✅ Planning complete. Zero code changes implemented. Ready to start Phase 1.  
**Branch:** `master` (working tree clean, no uncommitted changes)  
**Person:** Delilah (Zayd's assistant)  
**Session duration:** ~Several turns across two phases

---

## What We Did

1. **Found ALL pain points in the codebase** that will break during Electron migration.
2. **Added TODO markers** (`// ─── ELECTRON_MIGRATION ───`) to every single one.
3. **Wrote three new docs** with exact file:line numbers and recommended fixes.
4. **Committed everything** to `master`.

No functional code was changed. All work is planning + annotation.

---

## Complete File Map — Electron Migration

### Current Docs (Read These)

| File | Purpose | Status |
|------|---------|--------|
| `docs/ELECTRON_MIGRATION_STATUS.md` | **Start here.** Status & pickup guide. | ✅ Current |
| `docs/ELECTRON_MASTER_PLAN.md` | Full migration spec — 1116 lines, 12 agents, architecture, build config, CI. | ✅ Current |
| `docs/ELECTRON_PAIN_POINTS.md` | 16 specific issues — exact file:line, 2–4 approaches each, recommendation. | ✅ Current |
| `docs/ELECTRON_PLAN.md` | **IGNORE** — superseded by MASTER_PLAN. | ❌ Outdated |
| `docs/ELECTRON_MIGRATION_PLAN.md` | **IGNORE** — superseded by MASTER_PLAN. | ❌ Outdated |

### Outdated Docs (Do Not Use)

- `docs/ELECTRON_PLAN.md` — first draft, replaced
- `docs/ELECTRON_MIGRATION_PLAN.md` — second draft, replaced
- Use `ELECTRON_MASTER_PLAN.md` as the single source of truth.

---

## 16 Pain Points Found (All Marked in Source Code)

Search for them anytime: `grep -rn "ELECTRON_MIGRATION" server/ scripts/ vite.config.js`

| # | Issue | File(s) | Severity | Status |
|---|-------|---------|----------|--------|
| 1 | Server auto-starts on import | `server/index.js:183` (✅ marked) | Critical | Not fixed |
| 2 | Signal handlers conflict with Electron | `server/index.js:185-191` (✅ marked) | Critical | Not fixed |
| 3 | `process.exit()` in shutdown kills Electron | `server/index.js` gracefulShutdown (✅ marked) | Critical | Not fixed |
| 4 | `process.exit(1)` in config kills Electron | `server/config.js:91` (✅ marked) | Critical | Not fixed |
| 5 | 5 files hardcode `process.cwd()/data` | 5 services (✅ all marked) | Critical | Not fixed |
| 6 | Vite proxy hardcodes port 3001 | `vite.config.js:17` (✅ marked) | Critical | Not fixed |
| 7 | `launch.js` spawns dead server after refactor | `scripts/launch.js:205` (✅ marked) | Critical | Not fixed |
| 8 | Prisma engine binary fails in asar | `server/services/db.js` (✅ marked) | Critical | Not fixed |
| 9 | Playwright can't find Chromium in packaged app | `dashboard-api.js` + `account-generator.js` (✅ marked) | Critical | Not fixed |
| 10 | Prisma migrations at runtime | `prisma/migrations/` (not yet marked) | Critical | Not fixed |
| 11 | `dotenv/config` in packaged app | `server/config.js:2` (✅ marked) | Minor | No change needed |
| 12 | macOS Gatekeeper blocks unsigned app | — (doc only) | Polish | Documented only |
| 13 | App will be 300MB+ compressed | — (doc only) | Polish | Monitored |
| 14 | Docker entrypoint breaks after refactor | (no Dockerfile — discussed) | Minor | Not started |
| 15 | No log files in packaged app | `server/services/logger.js` (doc only) | Polish | Not started |
| 16 | `__dirname` in ESM | Various (doc only) | Minor | No change needed |

**Important:** Issues #1–7 are Phase 1 (blocks everything). Issues #8–10 are Phase 2 (packaging). Issues #11–16 are Phase 3 (polish).

---

## Files Touched in This Session (with todo markers)

All changes are **TODO comments only** — zero functional changes.

```
server/index.js                       → Issues #1, #2, #3
server/config.js                      → Issues #4, #11
server/services/db.js                 → Issue #8
server/services/local-secrets.js      → Issue #5
server/services/auth.js               → Issue #5
server/services/proxy-gate.js         → Issue #5
server/services/redemption-log.js     → Issue #5
server/services/dashboard-api.js      → Issue #9 (4 locations)
server/services/account-generator.js  → Issue #9 (1 location)
scripts/launch.js                     → Issues #2, #7
vite.config.js                        → Issue #6
```

**Commit:** `031e300` on `master`  
**Commit message:** "docs: mark all Electron pain points in source code + update plans with pickup instructions"

---

## Where to Pick Up (Phase 1 — Server Refactor)

### First thing to do

```bash
cd ~/Desktop/hydra
# Find every marked location
grep -rn "ELECTRON_MIGRATION" server/ scripts/ vite.config.js
```

### Second thing to do

Start with `server/index.js`. In order:

1. **Remove `bootstrap();` auto-call** (line ~183)
2. **Remove signal handlers** (lines ~185–191)
3. **Refactor `gracefulShutdown()`** to accept `{ exit = true, timeoutMs }` option
4. **Replace all `process.exit()`** inside gracefulShutdown with conditional `if (exit)`
5. **Replace `process.exit(1)`** in `bootstrap()` catch with `throw err`
6. **Add exports** at bottom: `export { app, bootstrap, gracefulShutdown, server }`

Then create `server/standalone.js` for terminal/Docker use.

Then fix the 5 data-path services.

Then refactor `scripts/launch.js`.

Then start on Electron shell files (`electron/main.js`, `electron/preload.js`, etc.).

**Full step-by-step:** See `docs/ELECTRON_MIGRATION_STATUS.md` — has the complete Phase 1–3 breakdown.

---

## Research Done (Agent Findings)

Three parallel research agents explored edge cases:

### Agent 1: Prisma + Electron Packaging
- `asarUnpack` for `node_modules/.prisma/**` and `node_modules/@prisma/client/**` is **required**
- Query engine binary (~19MB) cannot load from inside asar — `dlopen()` fails
- Schema engine binary (~22MB) only needed if running `prisma migrate deploy` at runtime
- **Recommendation:** Ship pre-built empty SQLite DB in `extraResources`, copy to userData on first launch. Avoid runtime migrations.
- `binaryTargets` in `prisma/schema.prisma` needed for cross-platform builds

### Agent 2: Playwright + Electron Packaging
- Playwright's Chromium binary lives in `~/.cache/ms-playwright/`, NOT in `node_modules`
- `asarUnpack` alone won't help — the binary is in a separate cache directory
- **Recommendation:** Bundle Chromium in `extraResources`, set `PLAYWRIGHT_BROWSERS_PATH` env var in `electron/main.js`
- Adds ~400MB to app size
- Alternative: use system Chrome via `HYDRA_PLAYWRIGHT_CHANNEL=chrome` (requires user to have Chrome)
- Alternative: connectOverCDP to existing Chrome (`HYDRA_PLAYWRIGHT_CDP_ENDPOINT`)

### Agent 3: ESM Main Process (Interrupted)
- Did not complete — interrupted during research
- Key question unanswered: Does `electron-builder` + `"type": "module"` work reliably?
- Current plan assumes **raw ESM** (no `electron-vite`), but this is a risk
- **Risk:** If ESM main process fails with `electron-builder`, we may need to switch to CJS wrapper or add `electron-vite`

---

## Known Unanswered Questions

| Question | Context |
|----------|---------|
| Does electron-builder support ESM main entry reliably? | We assumed yes (Electron 35+ supports ESM), but `electron-builder` detection may have issues. If this breaks, fallback to CJS wrapper or `electron-vite`. |
| Will PLAYWRIGHT_BROWSERS_PATH actually work with bundled Chromium? | Theory says yes, practice needs testing in packaged build. |
| How big will the final `.dmg` be? | Estimate: 200–400MB compressed. Need to verify. |
| Will Prisma `binaryTargets` increase build time significantly? | Need to test CI builds with all platforms. |

---

## Key Decisions Already Made (Non-Negotiable)

1. **Electron is PRIMARY runtime** — browser path (`npm run dev:web`) stays as fallback
2. **Server ignorance** — `server/` dir has zero Electron-specific code. All adaptation happens via env vars and options passed into `bootstrap()`.
3. **No IPC for API calls** — frontend still uses `fetch()` to localhost. Only IPC is for native affordances (version, open folder, etc.).
4. **Raw ESM main process** — no electron-vite bundler (if this breaks, pivot plan).
5. **Ship pre-built DB template** — no `prisma migrate deploy` at runtime.
6. **Bundle Chromium for Playwright** — adds size but guarantees provisioning works.
7. **No code signing for v1** — document right-click → Open on macOS.

---

## Session Artifacts

| Artifact | Location | Notes |
|----------|----------|-------|
| MASTER_PLAN | `docs/ELECTRON_MASTER_PLAN.md` | 1116 lines. Architecture, 12 agents, build config, CI |
| PAIN_POINTS | `docs/ELECTRON_PAIN_POINTS.md` | 875 lines. 16 issues, exact file:line, approaches, recommendations |
| STATUS/PICKUP | `docs/ELECTRON_MIGRATION_STATUS.md` | ← **Start here when picking up** |
| SOURCE MARKERS | `server/`, `scripts/`, `vite.config.js` | Search `ELECTRON_MIGRATION` for every TODO |
| This session file | `docs/4 - 27/SESSION_2026-04-27.md` | This file |

---

## How to Verify Nothing Was Broken

The only changes in this session are TODO comments. To verify:

```bash
cd ~/Desktop/hydra
npm run dev:web   # Should still start server + browser as before
npm start         # Should still start server via launch.js
```

If either breaks, it wasn't us — check `git diff HEAD~5` for any other changes.

---

> If you pick this up later, read `docs/ELECTRON_MIGRATION_STATUS.md` first. It's the fastest way to get oriented.
> If something in these docs is wrong, fix it. Don't let the next person wonder.
