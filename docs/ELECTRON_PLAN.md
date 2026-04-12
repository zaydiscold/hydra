# Electron Distribution Plan

**Status:** Not started | **Priority:** P1 (after Docker) | **Estimated effort:** half day
**Progression:** Docker (`DOCKER_PLAN.md`) → GitHub + ghcr.io → Electron (this)
**Dependency:** Requires Docker's static-file-serving server change first

## Goal
Hydra as a native desktop app — `.dmg` (Mac), `.exe` (Windows). Double-click install, no terminal, no browser URL bar. Frontend and backend live in one process, close together.

## Why Electron after Docker (not before)
- Docker validates the production build works in isolation first
- If you go Electron first, you debug "does my production build work?" AND "is Electron configured right?" simultaneously
- The shared server change (static file serving) is simpler to test in Docker
- Docker is 1-2hrs; Electron is a half day — Docker gives you a shippable thing faster
- Docker stays useful for technical users and CI even after Electron exists

## Why Electron
- Electron = Chromium + Node.js in one binary
- Your React frontend renders in a native window (no browser chrome, no `localhost:3001` in the URL bar)
- Express server runs inside the same process — closing the window kills everything
- User sees "Hydra" in their dock/taskbar with a custom icon
- SQLite + encrypted configs stay local on disk — no cloud anything

## Architecture
```
Electron main process (Node.js)
  ├── starts Express server on random free port (avoids conflicts)
  ├── runs Prisma migrations on startup
  ├── opens BrowserWindow → http://localhost:{port}
  ├── tray icon (optional) for background operation
  └── on window close → graceful shutdown of Express + cleanup
```

## Files to Create

### 1. `electron/main.js` — main process
- Import and start Express server from `server/index.js`
- Find a free port (avoid hardcoded 3001 — user might have something there)
- Create `BrowserWindow` pointing to `http://localhost:{port}`
- Window config: ~1200x800, resizable, custom title "Hydra", icon
- On `window-all-closed`: graceful shutdown
- On `before-quit`: cleanup Express server, close DB connections

### 2. `electron/preload.js` — security bridge
- Minimal: expose `process.platform` and app version to renderer
- Context isolation enabled (Electron security best practice)
- No need for IPC bridge initially — frontend talks to backend via HTTP (same as now)

### 3. `electron-builder.yml` — packaging config
```yaml
appId: com.hydra.app
productName: Hydra
directories:
  output: release/
mac:
  target: dmg
  icon: assets/icon.icns
  category: public.app-category.utilities
win:
  target: nsis
  icon: assets/icon.ico
linux:
  target: AppImage
files:
  - dist/**/*          # Vite-built frontend
  - server/**/*        # Express backend
  - prisma/**/*        # Schema + migrations
  - electron/**/*      # Electron entry points
  - node_modules/**/*  # Dependencies (electron-builder prunes dev deps)
  - package.json
```

### 4. `assets/icon.icns` + `assets/icon.ico`
App icon for Mac/Windows. Can generate from a single PNG with `electron-icon-builder`.

## Dependencies to Add
```json
{
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0"
  }
}
```

## package.json Scripts
```json
{
  "main": "electron/main.js",
  "scripts": {
    "electron:dev": "NODE_ENV=development electron .",
    "electron:build": "npm run build && electron-builder --publish never",
    "electron:build:mac": "npm run build && electron-builder --mac",
    "electron:build:win": "npm run build && electron-builder --win"
  }
}
```

## Server Changes Required (shared with Docker)

### Static file serving in production
Same change as Docker plan — `express.static('dist')` + SPA fallback. This is why Docker-first isn't wasted work: both need this.

### Dynamic port binding
Instead of hardcoded 3001, Express should accept a port parameter:
```js
// server/index.js
function startServer(port = process.env.PORT || 3001) { ... }
module.exports = { startServer };
```
Electron's `main.js` calls `startServer(freePort)` and passes the port to `BrowserWindow.loadURL`.

## Additional Considerations

### Dev mode with hot reload
- `electron:dev` should start Vite dev server (port 5173) AND Electron
- BrowserWindow loads `http://localhost:5173` in dev, `http://localhost:{port}` in production
- Use `electron-reload` or `concurrently` for HMR

### Data directory
- Electron provides `app.getPath('userData')` — platform-specific: `~/Library/Application Support/Hydra` (Mac), `%APPDATA%/Hydra` (Win)
- SQLite DB + encrypted configs go here (not `process.cwd()/data`)
- Set `DATABASE_URL=file:{userData}/dev.db` before Prisma init

### Auto-updater (skip for v1)
- `electron-updater` can check GitHub Releases for new versions
- Not needed initially — users manually download new `.dmg`/`.exe`
- Add later when release cadence justifies it

### Menu bar
- Minimal: File (Quit), Edit (Copy/Paste/Undo), View (Toggle DevTools, Reload)
- No File→Open, no Save — everything is automatic

### Security
- `contextIsolation: true` (default in modern Electron)
- `nodeIntegration: false` in renderer (frontend can't access Node APIs directly)
- No remote URLs loaded — only localhost
- CSP header restricting to `self` + localhost

### Code signing (optional, recommended for Mac)
- Without signing: Mac shows "unidentified developer" warning, user must right-click → Open
- With signing: needs Apple Developer account ($99/year)
- Can skip initially, add when distribution is wider

## Relationship to Docker
- Docker and Electron are complementary, not competing
- Docker: for technical users, CI, server deployments, dev environments
- Electron: for end-users who want a desktop app
- Both share: production build, static file serving, startup migrations
- Docker stays useful even after Electron ships

## Implementation Notes (Minimal Changes Required)

### Minimal Code Changes for Electron (beyond shared Docker changes)
1. **`server/index.js:135-168`** — Export `startServer()` and `bootstrap()` instead of auto-calling `bootstrap()`. Add `module.exports = { startServer, bootstrap }` at end of file. Electron's `main.js` calls `startServer(freePort)` instead of auto-bootstrapping on import.
2. **`server/index.js:149`** — Replace hardcoded `config.PORT` with passed-in port parameter: `function startServer(port = process.env.PORT || 3001)`. Electron passes a random free port.
3. **`electron/main.js`** (CREATE) — ~50 lines. Import `startServer` from `server/index.js`, find free port via `net.createServer()`, open BrowserWindow.
4. **`electron/preload.js`** (CREATE) — ~15 lines. Expose `process.platform` + app version via `contextBridge`.
5. **`electron-builder.yml`** (CREATE) — Config as shown above in "Files to Create" section.
6. **`package.json`** — Add `"main": "electron/main.js"`, add 4 scripts (`electron:dev`, `electron:build`, etc.), add `electron` + `electron-builder` to devDependencies.

### No-Change Items
- **Static file serving** — Already implemented at `server/index.js:80-94` (express.static + SPA fallback). Both Docker and Electron use this. No change needed.
- **Prisma migrations** — Same `prisma db push` logic as Docker, called from `electron/main.js` instead of `docker-entrypoint.sh`.
- **Data directory** — Use `app.getPath('userData')` in Electron vs `/app/data` in Docker. Set `DATABASE_URL` dynamically before Prisma init.

### Docker-First vs Electron-First Comparison

| Aspect | Docker-First (Recommended) | Electron-First |
|--------|---------------------------|----------------|
| **Ship time** | 1-2 hrs | 4+ hrs (half day) |
| **Production validation** | Docker forces production build testing first | Must debug build + Electron simultaneously |
| **Shared prerequisite** | Static file serving (already done at `server/index.js:80-94`) | Same — but untested without Docker |
| **User reach** | Technical users, CI, servers immediately | End-users want desktop app |
| **Rollback risk** | Low — container isolation | Medium — native installer + OS quirks |
| **Debugging surface** | Single container, reproducible | Per-OS: Mac .dmg signing, Windows NSIS, Linux AppImage |
| **Post-Docker value** | Docker stays useful for CI/servers even after Electron | Docker still needed later anyway |
| **Signal handling** | `init: true` handles zombies automatically | Electron handles lifecycle natively |
| **Playwright** | Needs `--no-sandbox` + Playwright Docker image | Electron bundles Chromium; Playwright still needs separate install |

**Recommendation:** Docker-first is the correct order. It validates the production build in isolation, ships faster, and the static-file-serving change (the only shared prerequisite) is simpler to test in a container. Electron can then be built on top of a known-working production build.

---

## Verification
1. `npm run electron:dev` — native window opens, dashboard works, hot reload works
2. `npm run electron:build` — produces `.dmg` (or `.exe`)
3. Install `.dmg` on a clean Mac — app opens, create account, proxy works
4. Close window — confirm Express server + Node process fully exit (no orphan processes)
5. Reopen — data persists from previous session
6. Test on machine WITHOUT Node installed — must work (Electron bundles its own Node)
