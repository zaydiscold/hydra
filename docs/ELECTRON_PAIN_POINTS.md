# Electron Pain Points & Approaches

**Companion to** [ELECTRON_MASTER_PLAN.md](./ELECTRON_MASTER_PLAN.md)
**Created:** 2026-04-21
**Purpose:** Every trap, hangup, and broken thing in the codebase that will bite us during Electron migration. Multiple approaches for each. Exact file paths and line numbers.

---

## How to Read This

Each section = one pain point. Format:
- **Where:** exact file(s) and line(s)
- **What:** what's currently there
- **Why it breaks:** what goes wrong in Electron
- **Approaches:** ranked A (simplest) → C (most robust)
- **Recommended:** the one we should go with

---

## 1. Server Auto-Starts on Import

**Where:** `server/index.js` line 183
**What:**
```js
bootstrap();
```
Called at module load time. `import('./server/index.js')` immediately starts the Express server on port 3001, prints the banner, and registers signal handlers.

**Why it breaks:**
- `electron/main.js` needs to SET env vars (DATABASE_URL, HYDRA_DATA_DIR) BEFORE importing the server (server reads env at load time via `config.js`)
- If server auto-starts, it reads env vars too early → Prisma gets wrong DATABASE_URL → can't find database
- `electron/main.js` can't control the port — server binds 3001 before we can pass `{ port: 33100 }`

**Approaches:**

**(A) Remove auto-call, export bootstrap()**
- Remove line 183 (`bootstrap();`)
- Remove lines 185-191 (signal handlers)
- Add `export { bootstrap, gracefulShutdown, app }` at bottom
- Create `server/standalone.js` that imports and calls `bootstrap()` for terminal use
- **Downside:** `node server/index.js` no longer works standalone

**(B) Guard with import.meta check**
```js
// Only bootstrap if run directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap();
}
```
- **Downside:** Fragile. `import.meta.url` behaves differently in ESM vs CJS. In asar-packaged Electron, `file://${process.argv[1]}` might not match.

**(C) Guard with env var**
```js
if (!process.env.HYDRA_EMBEDDED) {
  bootstrap();
}
```
- `electron/main.js` sets `process.env.HYDRA_EMBEDDED = '1'` before importing server
- Server skips auto-start
- **Downside:** Extra env var. `launch.js` doesn't set it, so server still auto-starts for terminal path.

**RECOMMENDED: Approach A** — Cleanest. No conditional logic. `server/index.js` becomes purely importable. Terminal path uses `server/standalone.js`.

**Changes needed:**
| File | Line | Change |
|------|------|--------|
| `server/index.js` | 183 | DELETE `bootstrap();` |
| `server/index.js` | 185-191 | DELETE signal handlers block |
| `server/index.js` | end of file | ADD `export { app, bootstrap, gracefulShutdown, server }` |
| NEW `server/standalone.js` | — | CREATE minimal wrapper that imports + calls bootstrap |
| `scripts/launch.js` | 205 | Change `server/index.js` → `server/standalone.js` in spawn |

---

## 2. Signal Handlers Conflict with Electron

**Where:**
- `server/index.js` lines 185-189
- `scripts/launch.js` lines 273-281

**What:**
```js
// server/index.js
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });

// scripts/launch.js
process.on('SIGINT', () => { serverProc.kill('SIGTERM'); process.exit(0); });
process.on('SIGTERM', () => { serverProc.kill('SIGTERM'); process.exit(0); });
```

**Why it breaks:**
- Electron has its own signal handling (`app.on('before-quit')`, `app.on('window-all-closed')`)
- If server also registers SIGINT/SIGTERM handlers, both fire → double shutdown → potential crashes
- `gracefulShutdown()` currently calls `process.exit(0)` unconditionally → kills Electron main process instantly, bypassing Electron's cleanup
- On macOS, Cmd+Q sends SIGTERM → Electron's `before-quit` fires AND server's SIGTERM handler fires → race condition

**Approaches:**

**(A) Remove signal handlers from server, keep in standalone.js**
- Delete lines 185-191 from `server/index.js`
- Add signal handlers to `server/standalone.js` (terminal path)
- Add signal handlers to `electron/main.js` (Electron path)
- Each caller handles its own lifecycle
- **Downside:** Need to remember to register handlers in every consumer

**(B) Make gracefulShutdown accept options for exit behavior**
```js
async function gracefulShutdown(source, { exit = true, timeoutMs = 5000 } = {}) {
  // ... cleanup ...
  if (exit) process.exit(0);
}
```
- Standalone.js calls `gracefulShutdown('SIGINT')` (exit=true)
- Electron calls `gracefulShutdown('before-quit', { exit: false })` (no exit)
- **Downside:** Signal handlers still registered globally → still conflict

**(C) Approach A + B combined** (what Master Plan proposes)
- Remove ALL signal handlers from `server/index.js`
- Make `gracefulShutdown()` accept `{ exit: boolean }` option
- `server/standalone.js` registers SIGINT/SIGTERM and calls `gracefulShutdown('SIGINT', { exit: true })`
- `electron/main.js` registers `before-quit` and calls `gracefulShutdown('before-quit', { exit: false })`

**RECOMMENDED: Approach C** — Both concerns addressed.

**Changes needed:**
| File | Line | Change |
|------|------|--------|
| `server/index.js` | 185-191 | DELETE signal handlers |
| `server/index.js` | gracefulShutdown fn | ADD `{ exit = true }` option, conditionally call `process.exit()` |
| NEW `server/standalone.js` | — | CREATE with signal handlers that call `gracefulShutdown(..., { exit: true })` |
| `scripts/launch.js` | 273-281 | DELETE (standalone.js handles it) |

---

## 3. `gracefulShutdown()` Calls `process.exit()` Unconditionally

**Where:** `server/index.js` — gracefulShutdown function (need to read full fn to find exact lines)

**What:** The current `gracefulShutdown()` function calls `process.exit(0)` or `process.exit(1)` in multiple places:
- On successful server close
- On timeout
- When server is null

**Why it breaks:**
- In Electron, `process.exit()` kills the ENTIRE app — main process, all renderer windows, everything
- Electron needs to run its own cleanup (close windows, remove tray, save window state) AFTER server shuts down
- If server's `gracefulShutdown()` calls `process.exit(0)`, Electron's `before-quit` handler never finishes

**Approaches:**

**(A) Remove all `process.exit()` calls from gracefulShutdown**
- Return boolean (success/failure) or throw errors
- Let caller decide when to exit
- **Downside:** Terminal users expect the process to exit after shutdown

**(B) Add `exit` option (Master Plan approach)**
```js
async function gracefulShutdown(source, { exit = true, timeoutMs = 5000 } = {}) {
  // ... cleanup ...
  server.close((err) => {
    if (err && exit) process.exit(1);
    if (!err && exit) process.exit(0);
    resolve(!err);
  });
  setTimeout(() => {
    if (exit) process.exit(1);
    resolve(false);
  }, timeoutMs).unref();
}
```
- Default `exit: true` preserves existing behavior for terminal path
- Electron passes `{ exit: false }` and handles cleanup itself

**RECOMMENDED: Approach B** — Backward compatible.

**Changes needed:**
| File | Change |
|------|--------|
| `server/index.js` | Refactor `gracefulShutdown()` to accept `{ exit, timeoutMs }` |

---

## 4. `process.exit(1)` in `server/config.js`

**Where:** `server/config.js` line 91
**What:**
```js
} catch (err) {
  console.error('Invalid environment variables:', err.issues ?? err.errors ?? err);
  process.exit(1);
}
```
Runs at MODULE LOAD TIME (inside the try/catch wrapping `configSchema.parse()`).

**Why it breaks:**
- `config.js` is imported by `server/index.js`
- If any required env var is missing (DATABASE_URL, JWT_SECRET, etc.), `process.exit(1)` fires immediately
- In Electron, this kills the entire app with no error dialog, no recovery, no chance to show the user what went wrong
- The user sees the app just... disappear. No feedback.

**Approaches:**

**(A) Don't touch config.js, set all env vars BEFORE importing server**
- `electron/main.js` sets DATABASE_URL, JWT_SECRET, NODE_ENV, PORT before `await import('../server/index.js')`
- Config validation passes because all vars are set
- If something is missing, it's a developer error (caught during dev)
- **Downside:** If we miss a var, the user gets a silent crash

**(B) Wrap the import in try/catch, show dialog**
```js
// electron/main.js
try {
  const { bootstrap } = await import('../server/index.js');
  await bootstrap({ ... });
} catch (err) {
  dialog.showErrorBox('Hydra Failed to Start', err.message);
  app.quit();
}
```
- Catches the import error (config validation happens at import time)
- Shows native OS error dialog
- **Downside:** The error message will be about "invalid environment variables" — not very user-friendly

**(C) Convert config.js to export a factory function**
```js
// server/config.js
export function loadConfig(env = process.env) {
  return configSchema.parse(env);
}
export let config = null;
try { config = loadConfig(); } catch { /* skip if env not set yet */ }
```
- `electron/main.js` can call `loadConfig()` explicitly after setting env vars
- Gets clear validation errors before server bootstrap
- **Downside:** More invasive refactor. Every file that imports `config` needs updating.

**RECOMMENDED: Approach A + B** — Set env vars first (A), wrap import in try/catch (B). Minimal changes.

**Changes needed:**
| File | Change |
|------|--------|
| `electron/main.js` | Set all env vars BEFORE `await import('../server/index.js')` |
| `electron/main.js` | Wrap import + bootstrap in try/catch, show `dialog.showErrorBox()` |

---

## 5. Five Files Use `process.cwd()/data` for Data Paths

**Where:**
| File | Line | Current Code |
|------|------|--------------|
| `server/services/local-secrets.js` | 7 | `const DATA_DIR = path.join(process.cwd(), 'data');` |
| `server/services/auth.js` | 12 | `const DATA_DIR = path.join(process.cwd(), 'data');` |
| `server/services/proxy-gate.js` | 12 | `const DATA_DIR = join(process.cwd(), 'data');` |
| `server/services/redemption-log.js` | 11 | `const DATA_DIR = join(process.cwd(), 'data');` |
| `server/scripts/session-lifetime-probe.js` | 39 | `const OUT_PATH = resolve(process.cwd(), values.out);` |

**Why it breaks:**
- In a packaged Electron app, `process.cwd()` is unpredictable — often `/` or the app bundle's Contents/MacOS/ directory
- Data would be written to wrong locations (or fail with permission errors)
- Multiple files creating `./data/` in random locations

**Approaches:**

**(A) All files read `process.env.HYDRA_DATA_DIR`**
```js
const DATA_DIR = process.env.HYDRA_DATA_DIR || path.join(process.cwd(), 'data');
```
- Each file does the same pattern
- Fallback to `process.cwd()/data` preserves terminal behavior
- `electron/main.js` sets `process.env.HYDRA_DATA_DIR` before importing server

**(B) Create a shared `server/services/paths.js` utility**
```js
// server/services/paths.js
import path from 'node:path';
export function getDataDir() {
  return process.env.HYDRA_DATA_DIR || path.join(process.cwd(), 'data');
}
```
- Each file imports `getDataDir` from `paths.js`
- Single source of truth
- **Downside:** More files to change

**(C) Pass dataDir through bootstrap() options**
```js
// server/index.js
async function bootstrap(options = {}) {
  process.env.HYDRA_DATA_DIR = options.dataDir || process.env.HYDRA_DATA_DIR || path.join(process.cwd(), 'data');
  // ... rest ...
}
```
- `electron/main.js` calls `bootstrap({ dataDir: app.getPath('userData') })`
- `server/standalone.js` calls `bootstrap()` (uses default)
- **Downside:** Services still read env at module load time — bootstrap sets env AFTER services load? Need careful import order.

**RECOMMENDED: Approach A** — Simplest, exactly the same pattern everywhere, minimal new code.

**Changes needed:**
| File | Line | Change |
|------|------|--------|
| `server/services/local-secrets.js` | 7 | `const DATA_DIR = process.env.HYDRA_DATA_DIR \|\| path.join(process.cwd(), 'data');` |
| `server/services/auth.js` | 12 | Same pattern |
| `server/services/proxy-gate.js` | 12 | Same pattern |
| `server/services/redemption-log.js` | 11 | Same pattern |
| `server/scripts/session-lifetime-probe.js` | 39 | Same pattern (optional, it's a CLI tool) |

---

## 6. Vite Proxy Hardcodes Port 3001

**Where:** `vite.config.js` lines 15-24
**What:**
```js
proxy: {
  '/api': { target: 'http://localhost:3001', changeOrigin: true },
  '/v1':  { target: 'http://localhost:3001', changeOrigin: true },
},
```

**Why it breaks (in Electron dev):**
- Electron dev workflow: Vite runs on 5173, Electron opens window loading `http://localhost:5173`
- Frontend calls `/api/...` → Vite proxies to `http://localhost:3001`
- But Electron's Express starts on port 33100+ (random free port), NOT 3001
- Result: all API calls fail with connection refused

**Approaches:**

**(A) Force Express to port 3001 in Electron dev mode**
```js
// electron/main.js
if (isDev) {
  const expressPort = 3001; // Match Vite proxy
  await bootstrap({ port: expressPort, ... });
}
```
- Simplest. No frontend changes.
- **Downside:** Port 3001 might already be in use. Need error handling.

**(B) Make Vite proxy configurable via env var**
```js
// vite.config.js
const apiTarget = process.env.HYDRA_API_URL || 'http://localhost:3001';
proxy: {
  '/api': { target: apiTarget, changeOrigin: true },
  '/v1':  { target: apiTarget, changeOrigin: true },
},
```
- Set `HYDRA_API_URL=http://localhost:33100` in Electron dev
- **Downside:** Vite reads env at startup. Can't set it AFTER Vite starts. Need to set it before `concurrently` starts Vite.

**(C) Inject API base URL into renderer via preload**
```js
// electron/preload.js
contextBridge.exposeInMainWorld('hydraEnv', {
  apiBaseUrl: `http://localhost:${expressPort}`,
});
// src/api.js
const BASE = window.hydraEnv?.apiBaseUrl || '';
fetch(`${BASE}/api/...`);
```
- **Downside:** Requires changing `src/api.js` — the frontend is "supposed to be untouched"

**(D) Dynamic port + restart Vite proxy**
Not practical. Vite proxy config is read once at startup.

**RECOMMENDED: Approach A** — Force port 3001 in dev. If occupied, show error dialog. It's a dev tool, not production.

**Changes needed:**
| File | Change |
|------|--------|
| `electron/main.js` | In dev mode, use `port: 3001` instead of random port |
| `electron/main.js` | If port 3001 is in use, show `dialog.showErrorBox()` and quit |

---

## 7. `launch.js` Spawns Server as Child Process

**Where:** `scripts/launch.js` line 205
**What:**
```js
const serverProc = spawn(cmd, ['server/index.js'], {
  cwd: __dirname,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
  env: { ...process.env, NODE_ENV: 'production' },
});
```
Also lines 273-281 (signal handlers that kill serverProc on SIGINT/SIGTERM).

**Why it breaks:**
- After Agent A removes auto-bootstrap from `server/index.js`, `spawn('node', ['server/index.js'])` will exit immediately (nothing to run)
- `launch.js` also does `npx prisma migrate deploy` (line 157) which won't work in packaged Electron (no npx, no prisma CLI in production)

**Approaches:**

**(A) Update launch.js to import bootstrap() directly**
```js
// scripts/launch.js
import { bootstrap } from '../server/index.js';
await bootstrap({ port, host: '0.0.0.0' });
```
- No more child process. No more spawn.
- **Downside:** `launch.js` becomes a thin wrapper. Its signal handling needs to import `gracefulShutdown` too.

**(B) Create server/standalone.js, update launch.js to spawn it**
```js
// server/standalone.js
import { bootstrap, gracefulShutdown } from './index.js';
await bootstrap({ port: parseInt(process.env.PORT || '3001'), host: '0.0.0.0' });
process.on('SIGINT', () => gracefulShutdown('SIGINT', { exit: true }));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM', { exit: true }));
```
```js
// scripts/launch.js
spawn('node', ['server/standalone.js'], ...);
```
- **Downside:** Still spawns a child process, but it's intentional (launch.js is a CLI orchestrator, not a library)

**(C) Approach B but launch.js imports standalone.js directly**
No child process at all.
- **Downside:** launch.js's stdout prefixes (`[server]`) become useless

**RECOMMENDED: Approach A** — Simpler for terminal path. `launch.js` imports bootstrap, calls it, handles signals directly. Drop the child process pattern.

**Changes needed:**
| File | Change |
|------|--------|
| `scripts/launch.js` | Import `bootstrap, gracefulShutdown` from `../server/index.js` |
| `scripts/launch.js` | Replace `spawn('node', ['server/index.js'])` with `await bootstrap({ port })` |
| `scripts/launch.js` | Replace signal handlers with `gracefulShutdown('SIGINT', { exit: true })` |
| `scripts/launch.js` | Remove child process stdout/stderr streaming (not needed anymore) |

---

## 8. Prisma in Packaged Electron App

**Where:**
- `server/services/db.js` (PrismaClient instantiation)
- `prisma/schema.prisma` (schema definition)
- `prisma/migrations/` (5 migration files)

**What:**
```js
// server/services/db.js
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
export const prisma = new PrismaClient();
```

**Why it breaks:**
- Prisma loads native query engine binary via `require('libquery_engine-darwin-arm64.dylib.node')`
- This binary is at `node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node`
- Inside asar, `dlopen()` cannot load binaries from read-only archives
- Also: `DATABASE_URL` is read from env at `PrismaClient()` construction time
- If `DATABASE_URL` isn't set yet, Prisma uses default (`file:./dev.db`) → wrong database

**Approaches:**

**(A) asarUnpack for Prisma + set DATABASE_URL before import**
```yaml
# electron-builder.yml
asarUnpack:
  - node_modules/@prisma/client/**
  - node_modules/.prisma/**
  - node_modules/@prisma/engines/**  # for migrations if needed
```
```js
// electron/main.js
process.env.DATABASE_URL = `file:${path.join(USER_DATA, 'hydra.db')}`;
// ... then import server ...
```

**(B) Ship pre-built empty SQLite database in extraResources**
```yaml
# electron-builder.yml
extraResources:
  - from: ./prisma/template.db
    to: ./prisma/template.db
```
```js
// electron/main.js
const dbPath = path.join(USER_DATA, 'hydra.db');
if (!existsSync(dbPath)) {
  copyFileSync(path.join(process.resourcesPath, 'prisma', 'template.db'), dbPath);
}
```
- No `prisma migrate deploy` needed at runtime
- **Downside:** Need to maintain the template.db file. Schema changes require rebuilding template.

**(C) Use better-sqlite3 instead of Prisma**
- Eliminates native binary dependency entirely
- better-sqlite3 has a C++ addon but `asarUnpack` works reliably
- **Downside:** Massive rewrite. All queries rewritten. Prisma's type safety lost.

**RECOMMENDED: Approach A** — Standard pattern. Prisma's own docs recommend `asarUnpack`. The binary is already there, just needs to be on real filesystem.

**Additional requirement — binaryTargets in schema.prisma:**
```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "darwin-arm64", "darwin-x64", "linux-x64", "windows-x64"]
}
```
Without this, `prisma generate` only builds for current platform. CI builds on all three platforms need the engines for each.

**Changes needed:**
| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `binaryTargets` to generator block |
| `electron-builder.yml` | Add `asarUnpack` entries for Prisma |
| `electron/main.js` | Set `DATABASE_URL` env var before importing server |

---

## 9. Playwright in Packaged Electron App

**Where:**
- `server/services/dashboard-api.js` lines 2213-2222 (chromium.launch)
- `server/services/dashboard-api.js` line 3182 (chromium.launch)
- `server/services/dashboard-api.js` line 3405 (chromium.launch)
- `server/services/account-generator.js` line 93 (chromium.launch)

**Why it breaks:**
- Playwright downloads Chromium to `~/.cache/ms-playwright/` (Linux) or `~/Library/Caches/ms-playwright/` (macOS)
- In a packaged app, Playwright's JS code can't find the browser binary
- Even with `asarUnpack`, Playwright browsers aren't in `node_modules` — they're in the cache
- `chromium.launch()` throws `Executable doesn't exist`

**Approaches:**

**(A) Set PLAYWRIGHT_BROWSERS_PATH=0 + include browsers in extraResources**
```yaml
# electron-builder.yml
extraResources:
  - from: ./browsers/
    to: ./browsers
```
```js
// electron/main.js
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'browsers');
}
```
Build script:
```bash
PLAYWRIGHT_BROWSERS_PATH=./browsers npx playwright install chromium
```
- Adds ~400MB to app size (Chromium binary)
- Works reliably

**(B) Use system Chrome via HYDRA_PLAYWRIGHT_CHANNEL**
- Already supported in `config.js` (line 34)
- User sets `HYDRA_PLAYWRIGHT_CHANNEL=chrome` in their .env
- Playwright launches system Chrome instead of bundled Chromium
- **Downside:** Requires user to have Chrome installed. Not zero-config.

**(C) Use HYDRA_PLAYWRIGHT_CDP_ENDPOINT (connectOverCDP)**
- Already supported in `config.js` (line 40)
- User launches Chrome with `--remote-debugging-port=9222`
- Playwright connects to existing Chrome instance
- **Downside:** Manual setup. Not suitable for production distribution.

**(D) Make Playwright provisioning optional in v1**
- If Playwright can't launch, fall back to manual key pasting
- Most users paste management keys manually anyway
- **Downside:** Reduces automation. But acceptable for v1.

**RECOMMENDED: Approach A + D** — Bundle Chromium (A) for auto-provisioning. If launch fails, show error message and fall back to manual mode (D). This is the pragmatic v1 approach.

**Changes needed:**
| File | Change |
|------|--------|
| `electron-builder.yml` | Add `extraResources` for browsers |
| `electron/main.js` | Set `PLAYWRIGHT_BROWSERS_PATH` before importing server |
| Build scripts | Add `npx playwright install chromium` step |
| `server/services/dashboard-api.js` | Wrap `chromium.launch()` in try/catch, throw descriptive error |

---

## 10. `dotenv/config` in Packaged App

**Where:** `server/config.js` line 2
**What:**
```js
import 'dotenv/config';
```

**Why it breaks:**
- `dotenv/config` reads `.env` from `process.cwd()` at import time
- In packaged Electron, `process.cwd()` is often `/` or `Contents/MacOS/`
- There's no `.env` file in the packaged app (it's a dev-only file)
- `dotenv` silently ignores missing files — so it doesn't crash
- BUT: if `.env` doesn't exist and env vars aren't set via `process.env`, validation fails → `process.exit(1)` (see issue #4)

**Approaches:**

**(A) Leave dotenv in, it's harmless**
- `dotenv/config` silently ignores missing `.env`
- `electron/main.js` sets all env vars before import
- Config validation passes
- **No changes needed** for this one

**(B) Remove dotenv, rely entirely on electron/main.js env setting**
- Delete `import 'dotenv/config'` from config.js
- All env vars must be set externally (via .env for dev, via main.js for Electron)
- **Downside:** Terminal users lose .env auto-loading. They'd need `source .env` or manual exports.

**RECOMMENDED: Approach A** — Leave it. It's harmless. The fallback behavior is correct.

**Changes needed:** None.

---

## 11. `__dirname` in ESM Main Process

**Where:** Various files use `__dirname`
- `scripts/launch.js` line 14
- `scripts/testing/*.mjs` files
- `scripts/recon/request-based-provision.mjs`

**What:**
```js
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
```

**Why it might break:**
- In a packaged Electron app, `import.meta.url` returns `file:///Applications/Hydra.app/Contents/Resources/app.asar/electron/main.js`
- `dirname(fileURLToPath(...))` returns `/Applications/Hydra.app/Contents/Resources/app.asar/electron/`
- This is fine for loading files inside the asar (preload.js is co-located)
- But it breaks if you try to write to this path (asar is read-only)
- `path.join(__dirname, '..', 'dist')` returns `.../app.asar/dist` which is inside asar — this works for serving static files

**Approaches:**

**(A) Keep current pattern, it works**
- `__dirname` via `import.meta.url` is standard ESM
- Electron handles asar paths transparently
- Just don't WRITE to `__dirname`

**(B) Use `app.getAppPath()` in Electron**
- More explicit
- Returns path to app directory (inside asar in prod, project root in dev)
- **Downside:** More verbose, need conditional logic

**RECOMMENDED: Approach A** — It works. Don't fix what isn't broken.

**Changes needed:** None.

---

## 12. macOS Code Signing & Gatekeeper

**Current state:** No signing configured.

**Why it matters:**
- macOS Gatekeeper blocks unsigned apps by default
- Users see: "cannot be opened because the developer cannot be verified"
- Only workaround: right-click → Open (every time, not just first launch)
- Windows has similar issues with SmartScreen

**Approaches:**

**(A) Document right-click → Open workaround (v1)**
- Add to README
- Acceptable for developer tools and early users
- Free

**(B) Apple Developer ID ($99/year)**
- Sign app with `electron-builder` + Developer ID certificate
- Users can open without right-click
- Needed for notarization (mandatory on macOS 10.15+)
- **Downside:** Cost + process (Apple Developer Program enrollment)

**(C) Self-signed certificate (free but limited)**
- Generate self-signed cert
- Sign app
- Users still need to bypass Gatekeeper on first launch (but less scary warning)
- **Downside:** Still triggers Gatekeeper

**RECOMMENDED: Approach A for v1, B for v2** — Document the workaround now. Budget $99/year for later.

**Changes needed:**
| File | Change |
|------|--------|
| `README.md` | Add "First Launch on macOS" section with right-click instruction |
| `desktop/entitlements.mac.plist` | CREATE with basic entitlements (prepare for future signing) |

---

## 13. App Size & Distribution

**Current deps (heavy):**
| Package | Size | Role |
|---------|------|------|
| `playwright` + Chromium | ~400MB | Browser automation |
| `@prisma/client` + engines | ~50MB | Database |
| `electron` itself | ~150MB | Shell |
| `node_modules` total | ~600MB+ | Everything |

**Why it matters:**
- DMG/exe will be 200-400MB compressed (600MB+ uncompressed)
- Users expect desktop apps to be under 100MB
- Playwright alone is 400MB

**Approaches:**

**(A) Ship everything, accept large size (v1)**
- Pragmatic. Getting it working > making it small.
- Most modern Electron apps are 150-300MB
- Compression helps (DMG/zip)

**(B) Make Playwright optional (lazy download)**
- Don't bundle Chromium
- On first provision attempt, download Chromium to userData
- **Downside:** First provision is slow. Need download progress UI.

**(C) Separate Playwright into a plugin/extension**
- Core app is small
- Playwright automation is a separate download
- **Downside:** Complex architecture. Not worth it for v1.

**RECOMMENDED: Approach A** — Ship it fat. Optimize later. Electron apps are big. Deal with it.

**Changes needed:** None for now. Monitor build size.

---

## 14. Docker Compatibility After Server Refactor

**Current state:** No Docker files found in the repo. But the plan mentions Docker support. If it exists (or if users run in Docker), the server refactor must not break it.

**Why it breaks:**
- Docker typically runs `node server/index.js` as the entrypoint
- After removing auto-bootstrap, this does nothing
- Docker expects signal forwarding (SIGTERM → graceful shutdown)

**Approaches:**

**(A) Create server/standalone.js for Docker**
```dockerfile
CMD ["node", "server/standalone.js"]
```
- `standalone.js` imports bootstrap + handles signals
- Same as terminal path

**(B) Keep Docker entrypoint in launch.js**
```dockerfile
CMD ["node", "scripts/launch.js"]
```
- `launch.js` already handles deps check, migration, build, server start
- Works in Docker if Node is available
- **Downside:** launch.js does too much for Docker (browser open, build check)

**RECOMMENDED: Approach A** — Clean entrypoint. Docker shouldn't use launch.js.

**Changes needed:**
| File | Change |
|------|--------|
| NEW `server/standalone.js` | Entry point for non-Electron use (Docker, terminal) |

---

## 15. Logger Writes to Console Only

**Where:** `server/services/logger.js` — verified as console-only.

**Why it might matter:**
- In packaged Electron, users can't see console output
- If something goes wrong, no log file to share for debugging
- `electron-log` package solves this

**Approaches:**

**(A) Keep console-only for v1**
- Works fine in dev (you see console)
- In production, add `electron-log` later
- **Downside:** Hard to debug user issues

**(B) Add electron-log now**
```js
import log from 'electron-log';
// Configure to write to app.getPath('logs')
```
- Minimal setup
- Auto-rotates logs
- Users can share log files for debugging

**RECOMMENDED: Approach B** — Add electron-log. It's 5 lines of config and saves hours of debugging later.

**Changes needed:**
| File | Change |
|------|--------|
| `package.json` | Add `electron-log` to dependencies |
| `electron/main.js` | Configure electron-log on startup |
| `server/services/logger.js` | (optional) Use electron-log transports |

---

## 16. Prisma `migrate deploy` in Packaged App

**Current state:** `scripts/launch.js` line 157 runs `npx prisma migrate deploy` at startup.

**Why it breaks in Electron:**
- Packaged app has no `npx` command
- `prisma` CLI may not be in `node_modules` (it's a devDep)
- Even if included, `prisma migrate deploy` needs the schema engine binary

**Approaches:**

**(A) Ship pre-built empty database**
- Run migrations at build time
- Ship empty `template.db` in `extraResources`
- On first launch, copy template to userData
- No runtime migration needed

**(B) Include prisma CLI as a production dep + run migrate at startup**
```js
// electron/main.js
import { execSync } from 'child_process';
execSync('npx prisma migrate deploy', { cwd: app.getAppPath() });
```
- Works if prisma is in dependencies (not devDeps)
- Needs asarUnpack for prisma/engines/ (schema engine binary)
- **Downside:** Slower startup. Schema engine adds ~22MB.

**(C) Bundle SQL migration files + apply manually**
- Ship migration SQL files
- On startup, check `_prisma_migrations` table
- Apply pending migrations via raw SQL
- **Downside:** Complex. Prisma's migration format isn't simple SQL.

**RECOMMENDED: Approach A for v1** — Ship template database. Simplest, fastest, most reliable.

**Changes needed:**
| File | Change |
|------|--------|
| Build scripts | Run `prisma migrate deploy` to create template.db |
| `electron-builder.yml` | Add template.db to extraResources |
| `electron/main.js` | Copy template to userData on first launch if db doesn't exist |

---

## Summary: Critical Path

All 16 issues ranked by dependency:

```
1.  Server auto-start (Issue #1)          — BLOCKS EVERYTHING
2.  Signal handlers (Issue #2)            — BLOCKS ELECTRON LIFECYCLE  
3.  process.exit in shutdown (Issue #3)   — BLOCKS ELECTRON LIFECYCLE
4.  process.exit in config (Issue #4)     — BLOCKS ELECTRON STARTUP
5.  Data paths (Issue #5)                 — BLOCKS DATA PERSISTENCE
6.  Vite proxy port (Issue #6)            — BLOCKS ELECTRON DEV LOOP
7.  launch.js refactor (Issue #7)         — BLOCKS TERMINAL PATH
8.  Prisma in asar (Issue #8)             — BLOCKS DATABASE IN ELECTRON
9.  Playwright in asar (Issue #9)         — BLOCKS KEY PROVISIONING
10. Prisma migrations (Issue #16)         — BLOCKS FIRST LAUNCH
11. Logger (Issue #15)                    — IMPROVES DEBUGGING
12. App size (Issue #13)                  — MONITOR
13. Code signing (Issue #12)              — DOCUMENT FOR LATER
14. Docker (Issue #14)                    — IF DOCKER EXISTS
15. dotenv (Issue #10)                    — NO CHANGES NEEDED
16. __dirname (Issue #11)                 — NO CHANGES NEEDED
```

Issues 1-7 are Phase 1 (server refactor).
Issues 8-10 are Phase 2 (packaging).
Issues 11-16 are Phase 3 (polish).

---

**Next step:** Greenlight and I'll start dispatching agents for Issues 1-7 (the critical path).
