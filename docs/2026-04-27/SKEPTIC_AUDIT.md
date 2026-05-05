# SKEPTIC_AUDIT.md — Electron Migration Bug Hunt

> Date: 2026-04-27 | Scope: `electron/main.js`, `preload.js`, `utils/migrateLegacyData.js`, `builders/afterPack.js`, `builders/entitlements.mac.plist`, `menus/appMenu.js`, `server/index.js`, `server/standalone.js`
> Severity legend: 🔴 CRITICAL | 🟠 HIGH | 🟡 MEDIUM | 🔵 LOW

---

## 🔴 CRITICAL — Will cause runtime failure or data loss

### 1. [main.js:69-73] Dual bootstrap code path — confusing, fragile, error-prone

```js
const port = isDev ? 3001 : await server.bootstrap({ port: 33100, silent: false }).then(s => s.address().port);
if (isDev) { await server.bootstrap({ port, silent: false }); }
```

In dev mode: the ternary short-circuits → `port=3001`, bootstrap is called on line 72.
In prod mode: `port` is the result of `bootstrap().then(s => s.address().port)` — bootstrap is called on line 69.
**Risk**: If someone edits the ternary later (e.g., changing to dynamic port selection), bootstrap could be called twice in dev (EADDRINUSE) or not at all. The two branches do identical work but diverge at different lines. Refactor to a single `if/else` or `await server.bootstrap(...)` call, then derive `port` from the result.

### 2. [main.js:109-118] `activate` handler hardcodes port 3001, missing error handling

```js
mainWindow.loadURL('http://localhost:3001');
```
In production mode, the server runs on port 33100 (line 69). The `activate` handler always tries to load `localhost:3001`, which won't be listening. **The returned promise is unhandled** — this is a floating unhandled rejection.

Additionally, the window created here:
- Has no `show: false` (inconsistent with the main window on line 91)
- Has no `ready-to-show` listener
- Has no error handler for `loadURL`

### 3. [preload.js:13-17] IPC handlers registered in preload but NEVER registered in main.js

```js
// preload.js exposes:
appVersion: () => ipcRenderer.invoke('native:get-version'),
appPaths: () => ipcRenderer.invoke('native:get-paths'),
openPath: (targetPath) => ipcRenderer.invoke('native:open-path', targetPath),
```

**There are ZERO `ipcMain.handle()` calls in `electron/main.js`** (confirmed by searching the entire codebase — the handlers exist only in DESIGN PLANS, not in actual code). Every call to `hydraNative.appVersion()`, `hydraNative.appPaths()`, or `hydraNative.openPath()` from the renderer will produce an **unhandled promise rejection** because Electron throws `No handler registered for 'native:get-version'`.

### 4. [server/index.js:72-74] `/api/shutdown` in Electron mode kills the entire app

```js
app.post('/api/shutdown', requireUnlocked, (req, res) => {
  res.json({ success: true, message: 'Server shutting down' });
  void gracefulShutdown('api');  // exits=TRUE by default → process.exit(0)
});
```

When `HYDRA_EMBEDDED=1`, calling `/api/shutdown` triggers `gracefulShutdown` with default `exit: true`, which calls `process.exit(0)` — **killing the entire Electron process instantly**. The TODO on line 115-119 acknowledges this but is unfixed. Furthermore, `res.json()` may not flush before `process.exit()` runs, so the HTTP response may be truncated.

### 5. [server/index.js:52-56] CSP `default-src 'self'` blocks inline scripts and styles

```js
if (process.env.HYDRA_EMBEDDED) {
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
  });
}
```

`default-src 'self'` means:
- `script-src` defaults to `'self'` → **no inline `<script>` blocks allowed**
- `style-src` defaults to `'self'` → **no inline `<style>`, no `style="..."` attributes**
- `connect-src` defaults to `'self'` → **no WebSocket connections** (Vite HMR uses WebSocket)
- No `img-src` → external images blocked
- No `font-src` → external fonts blocked

If the SPA uses ANY inline scripts/styles (common with Vite builds, CSS-in-JS, or framework wrappers), they will be silently blocked. In dev mode with Vite HMR, the WebSocket connection to `localhost:5173` will be blocked. No `'unsafe-inline'` or nonce/hash-based exemptions exist anywhere in the project.

---

## 🟠 HIGH — Will cause failure in certain conditions

### 6. [migrateLegacyData.js:23-26] Arbitrary 4096-byte threshold for skipping migration

```js
if (existsSync(userDB) && statSync(userDB).size > 4096) {
```

A valid but small database (e.g., brand new installation with minimal data) under 4KB will be **re-migrated every launch** even though it's already in userData. This causes unnecessary file copies and could overwrite user data with stale legacy data.

### 7. [migrateLegacyData.js:29-44] All sync I/O operations are unguarded

Every `mkdirSync`, `copyFileSync`, `readdirSync`, `statSync` call can throw with any filesystem error:
- **Permissions**: userData dir is read-only
- **Disk full**: mid-copy failure
- **Locked file**: another process holds the legacy DB
- **Race**: directory deleted between `existsSync` check and `readdirSync` (TOCTOU)

None of these have individual error handling. Any throw propagates to `main.js:35` and is silently swallowed as `"Legacy data migration skipped"`.

### 8. [migrateLegacyData.js:11-14] Synchronous I/O blocks the main thread

In `firstLaunchSetup`, `migrateIfNeeded()` runs all fs operations synchronously before `app.whenReady()` resolves. If the legacy directory has many files (secrets, proxy-gate, logs), the UI thread is blocked for hundreds of milliseconds or more. The window can't even start constructing until this completes.

### 9. [main.js:42] `npx` is assumed available — no fallback

```js
execSync('npx prisma db push --skip-generate', { ... });
```

If `npx` is not installed (minimal Node.js install, Docker image, PATH issue), this throws. The error is caught and logged as a warning (`"Schema sync failed"`), but **the database schema won't be updated**. This means new columns/tables added in code migrations would silently not exist, causing SQL errors at runtime.

Fix: Check `npx` availability first, or bundle prisma as a direct dependency and use `node_modules/.bin/prisma`.

### 10. [main.js:69] `s.address()` can be null in edge cases

```js
await server.bootstrap({ port: 33100, silent: false }).then(s => s.address().port)
```

`server.address()` returns `null` if the server is not listening (e.g., closed between listen callback and address() call). In practice this shouldn't happen, but a race condition in Node's internal event ordering could cause a `TypeError: Cannot read properties of null`.

### 11. [standalone.js:37] Unhandled promise rejection from `main()`

```js
main();  // async, returns a Promise — never caught
```

If `bootstrap()` throws AND `gracefulShutdown('bootstrap-error')` itself throws (e.g., inside the catch block on line 33), the promise from `main()` rejects unhandled. Node will print `UnhandledPromiseRejectionWarning`.

### 12. [afterPack.js:13] Cross-compilation platform detection is wrong

```js
const platform = packager.platform?.nodeName || process.platform;
```

Falls back to `process.platform` (the build machine's platform) when `packager.platform` is undefined. If cross-compiling (e.g., building for Windows on macOS), this selects the wrong Prisma engine binary.

### 13. [server/index.js:177-179] `rotationManager.reload()` errors silently downgraded

```js
rotationManager.reload().catch(err => {
  logger.warn(`[POOL] Eager load failed (no accounts yet?): ${err.message}`);
});
```

Any error — database corruption, connection failure, permission denied — is downgraded to a warning with the assumption "no accounts yet". Real errors are hidden from the user.

---

## 🟡 MEDIUM — Degraded behavior or subtle bugs

### 14. [main.js:120-133] `before-quit` re-entrant async IIFE

```js
app.on('before-quit', (event) => {
  event.preventDefault();
  (async () => {
    ...
    app.exit(0);
  })();
});
```

- `event.preventDefault()` is called every time — if `before-quit` fires multiple times (e.g., user mashes Cmd+Q), each creates a new IIFE.
- `shutdownInFlight` in gracefulShutdown prevents duplicate work, but the IIFEs stack up.
- Multiple calls to `app.exit(0)` are idempotent but the pattern is fragile.
- The async IIFE is fire-and-forget — the event handler returns immediately, Electron may not wait for the async work.

**Better pattern**: Use a single async function, guard with a `shuttingDown` boolean at the Electron level, and use `event.preventDefault()` only once.

### 15. [server/index.js:154-158] Shutdown timeout uses `unref()` — may not fire

```js
setTimeout(() => {
  logger.warn('[SHUTDOWN] Forced exit after timeout');
  if (exit) process.exit(1);
  resolve(false);
}, timeoutMs).unref();
```

`unref()` means if the Node event loop would otherwise be empty (e.g., all handles closed), the timeout is **cancelled** and `process.exit(1)` never fires. The process hangs indefinitely. This is intentional for clean shutdown, but if the server hangs during close, the process will never exit (in Electron mode this means the window closes but the process lingers).

### 16. [main.js:76] Hardcoded Vite dev server URL

```js
const url = isDev ? 'http://localhost:5173' : `http://localhost:${port}`;
```

If the Vite dev server is configured to use a different port, HTTPS, or a different host, this URL is wrong. Should read from `process.env.VITE_DEV_SERVER_URL` or a config file.

### 17. [preload.js:16] `platform` exposed at module load time, not runtime

```js
platform: process.platform,
```

`process.platform` is captured once when preload.js is first evaluated. If the platform could theoretically change (it can't on macOS, but on some Linux configurations this is mutable), the cached value would be stale. Minor, but the other methods are lazy (function calls) while this is eager.

### 18. [server/index.js:99-108] SPA catch-all doesn't log errors

```js
res.sendFile(join(distPath, 'index.html'), (err) => {
  if (err) { next(); }
});
```

If `index.html` doesn't exist (e.g., before first production build), the error is silently passed to `next()` with no log. The user sees a generic 404 with no indication that `dist/index.html` is missing.

### 19. [appMenu.js:64] Redundant dynamic import

```js
click: async () => {
  const { shell } = await import('electron');
  await shell.openExternal('https://github.com/zaydiscold/hydra');
},
```

`electron` is already imported at the top of the file (`import { app, Menu } from 'electron'`). Adding `shell` to that import would avoid a wasteful dynamic import on every menu click.

### 20. [server/index.js:43-45] Trust proxy not set in dev with HYDRA_EMBEDDED

```js
if (process.env.NODE_ENV === 'production' || process.env.HYDRA_DOCKERIZED === '1') {
  app.set('trust proxy', 1);
}
```

If Electron is running in dev mode behind a reverse proxy (e.g., system-wide ad-blocker proxy), rate limiting will see all requests from the proxy IP and may lock out all users. The comment acknowledges this but no fix is applied.

---

## 🔵 LOW — Code quality, observability, edge cases

### 21. [entitlements.mac.plist] Missing `com.apple.security.cs.disable-library-validation`

Prisma native binaries are dynamically loaded at runtime. On some macOS configurations with hardened runtime, `disable-library-validation` is needed for JIT-compiled native modules. If the app crashes on launch with a code-signing error, this is likely the cause.

### 22. [afterPack.js:20] Assumes `unpacked` directory is sibling of `appOutDir`

```js
const unpackDir = path.join(appOutDir, '..', 'unpacked');
```

This depends on electron-builder's internal directory layout, which varies by platform and configuration. Should use `packager.getResourcesDir(appOutDir)` or read the actual unpacked path from build config.

### 23. [main.js:16-17] `__dirname` and `isDev` are computed but could be stale

```js
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
```

These are captured once at module load time. Since the main process module is a singleton, this is fine — but if the module were reloaded (e.g., via `require()` cache clearing), they'd be wrong.

### 24. [standalone.js:17-18] Side-effect mutation of `process.env.PORT`

```js
process.env.PORT = String(port);
```

This mutates the global environment. If any other module reads `process.env.PORT` later (e.g., config.js), this is a latent side-effect coupling. Works in practice but is implicit.

### 25. [migrateLegacyData.js:48-57] Symlinks in legacy data followed silently

```js
const files = readdirSync(LEGACY_DIR);
for (const file of files) {
  ...
  if (statSync(src).isFile()) { copyFileSync(src, dest); }
}
```

If any file in the legacy directory is a symlink pointing outside the data directory, `copyFileSync` will copy the target (not the link), which could exfiltrate sensitive files from other locations.

---

## Summary Table

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | 🔴 CRITICAL | main.js:69-73 | Dual bootstrap code path — brittle, risk of double-bootstrap or missed bootstrap |
| 2 | 🔴 CRITICAL | main.js:116 | Activate handler hardcodes port 3001, no error handling |
| 3 | 🔴 CRITICAL | preload.js + main.js | IPC handlers exposed but NEVER registered — renderer calls fail silently |
| 4 | 🔴 CRITICAL | server/index.js:72-74 | /api/shutdown calls process.exit() in Electron mode, kills the app |
| 5 | 🔴 CRITICAL | server/index.js:52-56 | CSP default-src 'self' blocks inline scripts/styles/WebSocket |
| 6 | 🟠 HIGH | migrateLegacyData.js:23 | Arbitrary 4KB threshold triggers false re-migrations |
| 7 | 🟠 HIGH | migrateLegacyData.js:29-44 | All sync I/O unguarded — TOCTOU, permissions, disk-full |
| 8 | 🟠 HIGH | migrateLegacyData.js | Sync I/O blocks main thread on first launch |
| 9 | 🟠 HIGH | main.js:42 | npx assumed installed — missing npx silently skips schema sync |
| 10 | 🟠 HIGH | main.js:69 | s.address() null risk |
| 11 | 🟠 HIGH | standalone.js:37 | Unhandled promise rejection from main() |
| 12 | 🟠 HIGH | afterPack.js:13 | Cross-compilation uses wrong platform's Prisma engine |
| 13 | 🟠 HIGH | server/index.js:177-179 | rotationManager errors silently downgraded |
| 14 | 🟡 MEDIUM | main.js:120-133 | before-quit re-entrant async IIFE |
| 15 | 🟡 MEDIUM | server/index.js:154-158 | unref() may prevent forced exit on hang |
| 16 | 🟡 MEDIUM | main.js:76 | Hardcoded Vite dev URL |
| 17 | 🟡 MEDIUM | preload.js:16 | Eager platform capture |
| 18 | 🟡 MEDIUM | server/index.js:103 | Missing SPA error logging |
| 19 | 🔵 LOW | appMenu.js:64 | Redundant dynamic import |
| 20 | 🔵 LOW | server/index.js:43-45 | Trust proxy not set in dev |
| 21 | 🔵 LOW | entitlements.mac.plist | Missing disable-library-validation for native modules |
| 22 | 🔵 LOW | afterPack.js:20 | Fragile unpacked path assumption |
| 23 | 🔵 LOW | main.js:16-17 | Module-level constants |
| 24 | 🔵 LOW | standalone.js:17-18 | Side-effect env mutation |
| 25 | 🔵 LOW | migrateLegacyData.js:48-57 | Symlink following in legacy data |

## Per-Question Answers

### (1) Does migrateLegacyData handle the case where userData path doesn't exist?
**Partly yes.** On line 30 it calls `mkdirSync(userData, { recursive: true })` which creates the directory. However, if `mkdirSync` fails (permissions, disk full, read-only filesystem), the error is **unhandled** and propagates to main.js's generic catch block as `"Legacy data migration skipped"`. There is also a TOCTOU race: the `existsSync`/`statSync` checks happen before `mkdirSync`, and the directory could be created/deleted between checks.

### (2) Does firstLaunchSetup handle npx being missing?
**No.** The `execSync('npx prisma db push ...')` on line 42 will throw ENOENT if `npx` is not in PATH. The error is caught and logged as `"Schema sync failed"`, but the database schema is **silently left unsynced**. New migrations will not run, and the app may encounter SQL errors from missing columns/tables at runtime.

### (3) Is there a race window between server start and window.loadURL?
**Yes, but only in production mode.** The production path is:
```js
const port = await server.bootstrap(...).then(s => s.address().port);
// ... window creation ...
await mainWindow.loadURL(`http://localhost:${port}`);
```
`server.bootstrap()` awaits `app.listen()`'s callback, so the server is definitely listening when `loadURL` runs. In dev mode, `loadURL('http://localhost:5173')` targets the Vite dev server independently — no race with the Express server.

**However**, there IS a race between `s.address()` returning a valid object and `.port` being accessed (Finding #10). Also, if the server starts on port 33100 but the OS is ephemeral-port-exhausted, the listen callback fires but the socket isn't fully ready — extremely unlikely but theoretically possible.

### (4) What happens if port 3001 is taken?
**In dev mode** (port 3001): `server.bootstrap()` will call `app.listen(3001, ...)`. Express throws `EADDRINUSE`, which is rejected by the Promise wrapper on line 207 (`s.on('error', reject)`). This propagates to the try/catch on line 98, which shows an error dialog and exits.

**In production mode** (port 33100): Same behavior — `EADDRINUSE` causes an error dialog.

**No retry logic or port fallback exists.** If the port is taken, the app fails to start.

### (5) Does CSP break any inline scripts/styles the SPA needs?
**Almost certainly yes.** The CSP is `default-src 'self'` which:
- Blocks all inline `<script>` blocks and `eval()` — many SPAs use inline scripts for initialization
- Blocks all inline `<style>` tags and `style="..."` attributes — CSS-in-JS, styled-components, and Tailwind's JIT mode inject inline styles
- Blocks WebSocket connections — Vite dev server's HMR uses WebSocket
- Blocks `data:` URIs — some loaders use data URIs for images/fonts

No `'unsafe-inline'`, nonce, or hash-based exemptions exist. The SPA will load blank or broken. No `index.html` exists in the project yet, so this hasn't been caught.

### (6) Does before-quit handle re-entrant calls?
**Partially.** The `before-quit` handler itself is **not** re-entrancy-guarded at the Electron level. If `before-quit` fires multiple times (Cmd+Q spam), each fires a new async IIFE. The inner `gracefulShutdown()` call has a `shutdownInFlight` flag that prevents duplicate work, returning `true` immediately. Then `app.exit(0)` is called by each IIFE — idempotent but wasteful. The real concern is that `event.preventDefault()` is called every time, and the first IIFE's `app.exit(0)` might race against the second IIFE's `await gracefulShutdown(...)`.

**Recommended fix**: Guard with a module-level `let shuttingDown = false` in main.js:
```js
app.on('before-quit', (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  // ... async shutdown ...
});
```
