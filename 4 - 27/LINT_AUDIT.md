# LINT + Technical Debt Audit

**Generated:** 2026-05-05  
**Branch:** feat/electron-migration  
**Project:** Hydra (~/Desktop/hydra)

---

## 1. ESLint Results

**Command:** `npx eslint .`  
**Exit Code:** 0 (clean)  
**Warnings:** 0  
**Errors:** 0  

**Coverage (eslint.config.js):**
- `src/**/*.{js,jsx}` — Browser/React config (react-hooks, react-refresh, no-unused-vars)
- `server/**/*.js`, `scripts/**/*.js` — Node config (no-unused-vars, no-undef)
- Ignore patterns: `dist`

**NOT covered by lint:**
- `electron/**/*.js` — not in any `files` block
- `*.mjs` files — not matched by `.js` glob
- `bin/hydra.mjs` — same
- `vite.config.js` — only matched if under `server/` or `src/`
- `eslint.config.js` — itself not linted
- `patch.js`, `verify_final.js`, `audit_accounts.js` — root-level .js not matched
- Remotion video files (`.ts`, `.tsx`) — no TypeScript eslint config
- `prisma.config.ts` — no TypeScript eslint config

---

## 2. Technical Debt Pattern Search

### 2.1 `console.log` — 1,514 total occurrences across 60 files

| File | Count |
|------|-------|
| `scripts/testing/test-documentation.mjs` | 121 |
| `scripts/testing/test-account-crud.mjs` | 78 |
| `scripts/testing/test-trpc-routes.mjs` | 77 |
| `scripts/recon/analyze-ui.mjs` | 77 |
| `scripts/recon/emergency-reprovision.mjs` | 72 |
| `scripts/testing/test-rest-endpoints.mjs` | 72 |
| `scripts/recon/capture-network-enhanced.mjs` | 65 |
| `scripts/recon/emergency-relogin.mjs` | 60 |
| `scripts/recon/check-all-sessions.mjs` | 55 |
| `scripts/testing/test-restart-persistence.mjs` | 54 |
| `scripts/testing/test-session-validation.mjs` | 51 |
| `scripts/recon/refresh-and-provision.mjs` | 47 |
| `scripts/testing/test-trpc-cookies-post.mjs` | 47 |
| `scripts/testing/test-server-action-deep-dive.mjs` | 46 |
| `scripts/testing/test-trpc-cookies-refresh.mjs` | 42 |
| `scripts/testing/test-playwright-capture.mjs` | 41 |
| `scripts/testing/test-server-action.mjs` | 40 |
| `scripts/testing/test-http-comprehensive.mjs` | 39 |
| `scripts/testing/test-account-verify.mjs` | 37 |
| `scripts/testing/test-server-action-focus.mjs` | 36 |
| `scripts/recon/request-based-provision.mjs` | 35 |
| `scripts/testing/test-trpc-cookies.mjs` | 34 |
| `scripts/testing/security-test-cookies.mjs` | 29 |
| `scripts/testing/security-test-api.mjs` | 28 |
| `scripts/recon/capture-network.mjs` | 26 |
| `scripts/recon/analyze-api.mjs` | 25 |
| `scripts/recon/check-credentials.mjs` | 19 |
| `scripts/testing/security-test-merge.mjs` | 16 |
| `scripts/recon/get-session-full.mjs` | 12 |
| `scripts/recon/get-session.mjs` | 11 |
| `scripts/audit_accounts.js` | 8 |
| `scripts/recon/integration-gate.mjs` (4 - 27/) | 8 |
| `server/tests/debug-test.mjs` | 8 |
| `artifacts/.../audit_accounts.js` | 7 |
| `scripts/recon/gen-emails.mjs` | 6 |
| `server/scripts/verify-fix.js` | 6 |
| `scripts/check-clerk-connectivity.mjs` | 5 |
| `scripts/generate-icons.mjs` | 5 |
| `server/scripts/session-lifetime-probe.js` | 5 |
| `scripts/recon/get-session-for-capture.mjs` | 4 |
| `scripts/recon/get_selectors.cjs` | 4 |
| `scripts/build-empty-db.mjs` | 4 |
| `scripts/testing/debug-test.mjs` | 4 |
| `electron/utils/migrateLegacyData.js` | 4 |
| `scripts/launch.js` | 3 |
| `scripts/free-dev-ports.mjs` | 2 |
| `scripts/testing/test-session-e2e.mjs` | 2 |
| `scripts/testing/test-trpc.mjs` | 2 |
| `scripts/testing/test-session-deep.mjs` | 2 |
| `scripts/testing/test-session-refresh.mjs` | 2 |
| `scripts/otp-start-smoke.mjs` | 2 |
| `server/tests/electron-api-integration.test.mjs` | 2 |
| `scripts/check-accounts-dump.mjs` | 2 |
| `server/services/dashboard-api.js` | 3 |
| `server/standalone.js` | 1 |
| `server/services/auth.js` | 1 |
| `server/tests/phase1-backward-compat.test.mjs` | 1 |
| `electron/main.js` | 1 |
| `electron/builders/afterPack.js` | 1 |
| `patch.js` | 1 |
| `bin/hydra.mjs` | 1 |
| `scratch/reset-pass.js` | 1 |
| `scripts/testing/automated-test.js` | 1 |
| `scripts/testing/complete-and-test.js` | 1 |

**Notable:** Most `console.log` usage is in test/script files intended for CLI output. Production server code is mostly clean (only 3 in `dashboard-api.js`, 1 in `auth.js`, 1 in `standalone.js`).

### 2.2 `TODO` — 11 occurrences across 8 files

| File | Line | Content |
|------|------|---------|
| `vite.config.js` | 17 | `// TODO: PAIN_POINTS.md #6 — In Electron dev mode...` |
| `server/services/local-secrets.js` | 8 | `// TODO: PAIN_POINTS.md #5 — Replace process.cwd() with:` |
| `server/services/proxy-gate.js` | 13 | `// TODO: PAIN_POINTS.md #5 — Replace process.cwd() with:` |
| `server/services/dashboard-api.js` | 2214 | `// TODO: PAIN_POINTS.md #9 — chromium.launch() won't find browser binary...` |
| `server/services/dashboard-api.js` | 3188 | `// TODO: PAIN_POINTS.md #9 — Same Playwright binary issue...` |
| `server/services/dashboard-api.js` | 3415 | `// TODO: PAIN_POINTS.md #9 — Same Playwright binary issue...` |
| `server/services/auth.js` | 13 | `// TODO: PAIN_POINTS.md #5 — Replace process.cwd() with:` |
| `server/services/redemption-log.js` | 12 | `// TODO: PAIN_POINTS.md #5 — Replace process.cwd() with:` |
| `server/services/db.js` | 5 | `// TODO: PAIN_POINTS.md #8 — PrismaClient loads a native query engine...` |
| `server/index.js` | 115 | `// TODO: PAIN_POINTS.md #3 — gracefulShutdown calls process.exit()...` |
| `server/services/account-generator.js` | 125 | `// TODO: PAIN_POINTS.md #9 — Same Playwright binary issue...` |

**Category breakdown:**
- #5 (process.cwd() replacement): 4 files (local-secrets.js, proxy-gate.js, auth.js, redemption-log.js)
- #9 (Playwright binary in Electron): 3 files (dashboard-api.js ×2, account-generator.js)
- #8 (Prisma native query engine): 1 file (db.js)
- #3 (gracefulShutdown): 1 file (index.js)
- #6 (Electron dev mode): 1 file (vite.config.js)

### 2.3 `FIXME` — 0 occurrences

### 2.4 `HACK` — 0 occurrences

### 2.5 `XXX` — 0 occurrences

### 2.6 `workaround` — 0 occurrences

### 2.7 `@ts-ignore` — 0 occurrences

### 2.8 `any` type (TypeScript files) — 0 occurrences

TypeScript files found: `prisma.config.ts`, Remotion project files (7 .ts/.tsx files). None use the `any` type.

---

## 3. Electron ESM Import Consistency

**Files in `electron/` directory:**
- `electron/main.js` — uses `import` ✓
- `electron/preload.js` — uses `import` ✓
- `electron/menus/appMenu.js` — uses `import` ✓
- `electron/builders/afterPack.js` — uses `import` ✓
- `electron/utils/migrateLegacyData.js` — uses `import` ✓
- `electron/tests/main-process.test.mjs` — uses `import` ✓

**Verdict:** All Electron files use consistent ESM imports (`import` syntax). No `require()` calls found in Electron source files. The only mention of "require" in `electron/preload.js` is a comment explaining that no require() leaks into the renderer. **PASS**

---

## 4. Trailing Whitespace & Missing Newlines

### 4.1 Trailing Whitespace — 68 files affected

Files with trailing whitespace on one or more lines:

**src/ (React frontend):**
- `src/pages/AccountDetail.jsx`
- `src/pages/PoolManager.jsx`
- `src/pages/Vault.jsx`
- `src/pages/Dashboard.jsx`
- `src/pages/BulkAuthWizard.jsx`
- `src/pages/Traffic.jsx`
- `src/pages/CodeRedemption.jsx`
- `src/api.js`
- `src/App.jsx`
- `src/hooks/useBulkAuth.js`
- `src/hooks/useMetrics.js`
- `src/components/SummaryCard.jsx`
- `src/components/AccountRow.jsx`
- `src/components/ScrambleText.jsx`
- `src/components/KeyRow.jsx`
- `src/components/EmailLinkTab.jsx`
- `src/components/ErrorBoundary.jsx`
- `src/components/RegisterKeyModal.jsx`
- `src/components/AddAccountModal.jsx`
- `src/components/AttachSignInModal.jsx`

**server/ (backend):**
- `server/utils/cookie-utils.js`
- `server/services/rotation-manager.js`
- `server/services/dashboard-api.js`
- `server/services/store.js`
- `server/services/management-key-store.js`
- `server/services/clerk-auth.js`
- `server/controllers/KeyController.js`
- `server/controllers/PoolController.js`
- `server/controllers/AuthController.js`
- `server/controllers/AccountController.js`
- `server/controllers/BaseController.js`
- `server/controllers/DashboardController.js`
- `server/index.js`
- `server/scripts/verify-fix.js`

**scripts/ (utilities, tests, recon):**
- `scripts/recon/check-all-sessions.mjs`
- `scripts/recon/request-based-provision.mjs`
- `scripts/recon/get-session.mjs`
- `scripts/recon/get_selectors.cjs`
- `scripts/recon/get-session-full.mjs`
- `scripts/recon/analyze-ui.mjs`
- `scripts/recon/analyze-api.mjs`
- `scripts/recon/capture-network-enhanced.mjs`
- `scripts/launch.js`
- `scripts/testing/test-trpc-routes.mjs`
- `scripts/testing/test-server-action.mjs`
- `scripts/testing/test-session-validation.mjs`
- `scripts/testing/test-server-action-focus.mjs`
- `scripts/testing/security-test-merge.mjs`
- `scripts/testing/security-test-api.mjs`
- `scripts/testing/test-restart-persistence.mjs`
- `scripts/testing/test-account-crud.mjs`
- `scripts/testing/test-playwright-capture.mjs`
- `scripts/testing/complete-and-test.js`
- `scripts/testing/test-trpc-cookies.mjs`
- `scripts/testing/test-trpc-cookies-post.mjs`
- `scripts/testing/test-trpc-cookies-refresh.mjs`
- `scripts/testing/test-http-comprehensive.mjs`
- `scripts/testing/test-rest-endpoints.mjs`
- `scripts/testing/automated-test.js`
- `scripts/testing/test-documentation.mjs`
- `scripts/testing/test-server-action-deep-dive.mjs`
- `scripts/testing/security-test-cookies.mjs`

**Other:**
- `eslint.config.js`
- `patch.js`
- `verify_final.js`
- `audit_accounts.js`
- `artifacts/brain/.../audit_accounts.js`
- `videos/remotion-project/src/Composition.tsx`

### 4.2 Missing Final Newline — 0 files

All JS/TS source files have a trailing newline. **PASS**

---

## 5. Summary

| Check | Result |
|-------|--------|
| ESLint (configured scope) | ✅ 0 errors, 0 warnings |
| ESLint coverage gaps | ⚠️ electron/, .mjs files, root .js, .ts files not linted |
| `console.log` | ⚠️ 1,514 occurrences (mostly in test/script files) |
| `TODO` | ⚠️ 11 (all reference PAIN_POINTS.md) |
| `FIXME` | ✅ 0 |
| `HACK` | ✅ 0 |
| `XXX` | ✅ 0 |
| `workaround` | ✅ 0 |
| `@ts-ignore` | ✅ 0 |
| `any` type (TS files) | ✅ 0 |
| Electron ESM consistency | ✅ All `import` — no `require()` in source |
| Trailing whitespace | ⚠️ 68 files affected |
| Missing final newlines | ✅ 0 files |

### Key Findings

1. **ESLint scope is too narrow** — Only `src/**/*.{js,jsx}`, `server/**/*.js`, and `scripts/**/*.js` are linted. Missing: `electron/` (6 files), `.mjs` files (many), root `.js` files (4), and all TypeScript files (8).

2. **1,514 console.log calls** — Heavily concentrated in scripts/ and tests/ (intentional CLI output). Production server code has only ~5 scattered console.log calls.

3. **11 TODO references to PAIN_POINTS.md** — Six distinct pain points (#3, #5, #6, #8, #9) need resolution for the Electron migration.

4. **68 files with trailing whitespace** — Widespread across src/, server/, scripts/, and config files.

5. **Electron ESM is clean** — All electron/ files consistently use `import` syntax.
