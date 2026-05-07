# Security Review — Hydra Electron App

> **Status (2026-05-06):** Reviewed and processed. No criticals. The two HIGH
> findings (H-01 splash HTML string-concat, H-02 PID interpolation in
> `tasklist`) are not exploitable in practice — the `items[]` array is fully
> hardcoded (no user/external input ever flows into the splash HTML) and
> `execFileSync` does not invoke a shell, so PID-string injection cannot
> become command injection. The lock file lives in `userData`, which already
> requires local write access. The MEDIUM/LOW items are hardening notes
> tracked in the swarm doc; nothing here blocks shipping the desktop app.
> Reasonable for a local-only Electron app — keep this report archived.

**Reviewer:** Senior Security Engineer (automated)  
**Date:** 2026-05-06  
**Scope:** `electron/` main-process code (10 files + 1 dependency)

---

## Executive Summary

The codebase demonstrates **above-average Electron security hygiene**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` on all windows, a proper preload bridge via `contextBridge`, external URL allowlisting, and path validation with `realpathSync` to defeat symlink escapes. No critical remote-code-execution vectors were found. The issues below range from medium-hardening gaps to low informational notes.

**Total findings: 14** — 0 CRITICAL, 2 HIGH, 6 MEDIUM, 6 LOW

---

## File-by-File Findings

---

### 1. `electron/main.js`

#### M-01 · MEDIUM — `VITE_DEV_SERVER_URL` env var used without validation (line 162–164)
```js
const viteUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const url = (isDev && process.env.VITE_DEV_SERVER_URL) ? viteUrl : staticUrl;
```
- **Risk:** If an attacker can set environment variables (e.g. via a `.env` file, compromised CI, or launch-agent injection), they can redirect the main window to an arbitrary URL. In production (`isDev=false`) this path is never taken, but in dev mode any URL is loaded.
- **Fix:** Validate that `VITE_DEV_SERVER_URL` parses to `localhost`/`127.0.0.1` before use.

#### L-01 · LOW — `require('electron')` inside tray menu click handlers (lines 82–83)
```js
{ label: 'Open Logs Folder', click: () => { const { shell } = require('electron'); ... } }
```
- **Risk:** Using CommonJS `require` in an ESM module works in Electron but is fragile. Not a security issue per se, but inconsistent with the rest of the codebase's ESM imports. If a bundler config changes, this silently breaks.

#### L-02 · LOW — `tray._hydraRebuildMenu` monkey-patch (line 91)
- **Risk:** Attaching custom properties to Electron native objects is undocumented and could break on Electron upgrades. Low severity — no direct security impact.

---

### 2. `electron/app/env.js`

#### M-02 · MEDIUM — JWT secret file world-readable if created by older version (lines 126–139)
```js
secret = readFileSync(secretPath, 'utf-8').trim();
// ...
writeFileSync(secretPath, secret, { mode: 0o600 });
chmodSync(secretPath, 0o600);
```
- **Risk:** The code correctly `chmod`s to `0o600` after writing (good). However, between `writeFileSync` (which only applies mode on *creation*) and `chmodSync`, there is a brief TOCTOU window where a file created by an older version without mode restrictions could be read by another user. Additionally, `readFileSync` on line 128 reads the secret *before* any permission check — if the file was world-readable from a prior install, it proceeds silently.
- **Fix:** Consider checking file permissions after reading and warning if they're too open.

#### M-03 · MEDIUM — `setupEnvironment` sets `JWT_SECRET` from file without length validation (line 146)
```js
process.env.JWT_SECRET = secret;
```
- **Risk:** If the secret file is truncated or empty-string (e.g. disk full during write), `secret` could be an empty or very short string. `randomBytes(32).toString('hex')` generates 64 chars, but a read-back is unchecked.
- **Fix:** Validate `secret.length >= 32` after reading; regenerate if too short.

#### L-03 · LOW — Dev-mode hardcoded JWT secret check (line 124)
```js
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'hydra-dev-secret-unsafe') {
```
- **Risk:** The string `'hydra-dev-secret-unsafe'` is a known dev default. If a user accidentally sets this in production, the code correctly regenerates. This is well-handled — informational only.

---

### 3. `electron/app/state.js`

#### M-04 · MEDIUM — External URL allowlist only checks hostname, not path (lines 49–53)
```js
const parsed = new URL(rawUrl);
return parsed.protocol === 'https:' && EXTERNAL_URL_ALLOWLIST.has(parsed.hostname);
```
- **Risk:** `github.com` and `openrouter.ai` are allowed. An attacker who can trigger `openExternalUrl` with a crafted path (e.g. `https://github.com/user/repo/releases/download/malware.exe`) could direct users to download arbitrary files. The allowlist is hostname-only with no path filtering.
- **Fix:** Consider restricting to specific path prefixes or at least logging opened URLs for audit.

#### L-04 · LOW — `showAndFocusMainWindow` respawns window without preload path (line 99)
```js
const fresh = createMainWindow({ show: true });
```
- **Risk:** `createMainWindow` in `windows.js` always sets `preload` internally (line 264 of windows.js), so this is safe. However, the caller doesn't pass `preloadPath` — if `createMainWindow`'s default changed, the preload could be lost. Defense-in-depth suggests passing it explicitly.

---

### 4. `electron/app/windows.js`

#### H-01 · HIGH — Splash window HTML constructed via string concatenation (lines 107–240)
```js
return '<span class="d" style="...'
    + '--c:' + color + ';'
    + ...
    + '">' + item.text + '</span>';
```
- **Risk:** The `items` array (lines 42–82) contains hardcoded strings, so in practice there is no injection vector. However, the *pattern* of building HTML via string concatenation without escaping is inherently fragile. If any `item.text` or `item.color` value were ever sourced from user input, external config, or a translated string, it would become an XSS vector inside the splash's `data:` URL page. The CSP header (`default-src 'self' 'unsafe-inline'`) permits inline scripts, which would make any injection fully exploitable.
- **Fix:** Use a templating approach that escapes HTML entities, or at minimum add a comment asserting the data source is trusted.

#### M-05 · MEDIUM — `setWindowOpenHandler` allows local URLs to open new windows (lines 325–329)
```js
win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedLocalUrl(url)) return { action: 'allow' };
    void openExternalUrl(url);
    return { action: 'deny' };
});
```
- **Risk:** Any navigation to `http://localhost`, `http://127.0.0.1`, or `http://[::1]` is allowed to open a new `BrowserWindow`. If the local Express server has any open-redirect or SSRF vulnerability, a crafted page could spawn new Electron windows pointed at internal services (e.g. `http://127.0.0.1:6379` for Redis). The new window inherits the same `webPreferences` (sandbox=true, contextIsolation=true) which limits damage, but it's still an unexpected surface.
- **Fix:** Consider restricting `setWindowOpenHandler` to only the app's own port (the Express port).

---

### 5. `electron/app/ipc.js`

#### M-06 · MEDIUM — `native:get-paths` exposes full filesystem paths to renderer (lines 40–51)
```js
userData: app.getPath('userData'),
home: app.getPath('home'),
logs: app.getPath('logs'),
```
- **Risk:** If the renderer is compromised (e.g. via a dependency supply-chain attack), the attacker learns the user's home directory, userData path, and log locations. This is reconnaissance data useful for targeted path-traversal or social-engineering attacks. The paths are also available via `native:open-path` so this is somewhat redundant, but minimizing information disclosure is good practice.
- **Fix:** Consider whether the renderer truly needs all these paths, or just `serverUrl`.

#### L-05 · LOW — `registerIpcHandlers` ignores its arguments (line 35 vs internal calls)
```js
export function registerIpcHandlers({ windowURL, onHideWindow, onQuitApp } = {}) {
```
- **Risk:** `windowURL` is accepted as a parameter but line 55 also reads `getWindowURL()` from state. The `native:get-paths` handler uses the stale `windowURL` closure value (line 48) while `native:get-status` uses the live getter. This inconsistency could leak a stale/incorrect URL. Not a security issue, but a correctness bug that could confuse debugging.

---

### 6. `electron/app/shutdown.js`

No significant security findings. The shutdown logic is defensive:
- `kill()` wrapped in try/catch (line 19)
- Tray destruction guarded by `isDestroyed()` check (line 53)
- Graceful shutdown has a 3s timeout (line 61)

---

### 7. `electron/app/schemaSync.js`

#### H-02 · HIGH — `execFileSync('tasklist', ...)` with PID interpolation (line 110)
```js
const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { ... });
```
- **Risk:** The `pid` value comes from a lock file on disk (`readLockPayload`). If an attacker can write to the lock file (e.g. via a path-traversal or symlink in userData), they could inject arbitrary strings into the `tasklist` filter argument. `execFileSync` does NOT invoke a shell, so command injection is not possible — but the crafted filter string could cause `tasklist` to hang or produce unexpected output that `out.includes(String(pid))` misparses, potentially breaking lock logic.
- **Severity justification:** Downgraded from CRITICAL because `execFileSync` avoids shell interpretation. The lock file is in `userData` which requires local write access (already game-over).

#### M-07 · MEDIUM — Migration lock file created with `wx` flag but no file-mode restriction (line 141)
```js
const fd = openSync(lockPath, 'wx');
writeSync(fd, `${process.pid}:${Date.now()}`);
```
- **Risk:** The lock file is created world-readable (umask-dependent). On a multi-user system, another user could read the PID and timestamp. This is low-impact since the PID is not secret, but consistent with the `0o600` pattern used elsewhere.
- **Fix:** Use `openSync(lockPath, 'wx', 0o600)`.

#### L-06 · LOW — `sqlite3` CLI invoked with `dbPath` (line 172)
```js
execFileSync('sqlite3', [dbPath, 'PRAGMA wal_checkpoint(TRUNCATE);'], { ... });
```
- **Risk:** `dbPath` is derived from `app.getPath('userData')` which is system-controlled. `execFileSync` does not use a shell. Safe in practice.

---

### 8. `electron/preload.js`

No security findings. The preload is exemplary:
- Uses `contextBridge.exposeInMainWorld` (not `window.` assignment)
- Only exposes `ipcRenderer.invoke` calls (no `send`, no `on` leak except the controlled `onNavigate`)
- No `ipcRenderer` methods exposed directly to renderer

#### Note on `onNavigate` (line 67–69)
```js
onNavigate: (callback) => {
    ipcRenderer.on('navigate', (_event, path) => callback(path));
},
```
- The `path` argument comes from main process (`mw.webContents.send('navigate', '/settings')` in main.js:181). This is trusted data. No listener cleanup is exposed, which could cause memory leaks if called repeatedly, but not a security issue.

---

### 9. `electron/menus/appMenu.js`

No security findings. The menu is standard Electron boilerplate. All external URLs go through `openExternalUrl` which validates against the allowlist.

---

### 10. `electron/builders/afterPack.js`

No security findings. This is a build-time script that runs during packaging, not at runtime. It copies files and prunes unused binaries. The `cpSync` filter logic is deterministic and doesn't process untrusted input.

---

### 11. `electron/app/path-allowlist.js` (dependency of ipc.js)

Good implementation:
- `realpathSync` resolves symlinks before comparison (defeats symlink escapes)
- Returns `false` on any resolution error (fail-closed)
- Checks both equality and `startsWith(root + path.sep)` (prevents prefix collisions like `/home/user` matching `/home/username`)

No findings.

---

## Summary Table

| ID | Severity | File | Line(s) | Description |
|----|----------|------|---------|-------------|
| H-01 | HIGH | windows.js | 107–240 | Splash HTML built via string concat; XSS-safe only because data is hardcoded |
| H-02 | HIGH | schemaSync.js | 110 | PID from lock file interpolated into `execFileSync` args |
| M-01 | MEDIUM | main.js | 162–164 | `VITE_DEV_SERVER_URL` env var loaded without validation |
| M-02 | MEDIUM | env.js | 126–139 | JWT secret file TOCTOU on permission hardening |
| M-03 | MEDIUM | env.js | 146 | JWT secret read without length validation |
| M-04 | MEDIUM | state.js | 49–53 | External URL allowlist is hostname-only, no path restriction |
| M-05 | MEDIUM | windows.js | 325–329 | `setWindowOpenHandler` allows any local-port URL |
| M-06 | MEDIUM | ipc.js | 40–51 | Full filesystem paths exposed to renderer |
| M-07 | MEDIUM | schemaSync.js | 141 | Lock file created world-readable |
| L-01 | LOW | main.js | 82–83 | `require('electron')` in ESM module |
| L-02 | LOW | main.js | 91 | Monkey-patching native Tray object |
| L-03 | LOW | env.js | 124 | Hardcoded dev JWT secret string (well-handled) |
| L-04 | LOW | state.js | 99 | Respawn window doesn't pass preloadPath explicitly |
| L-05 | LOW | ipc.js | 35, 48, 55 | Stale vs live URL inconsistency in IPC handlers |

---

## Positive Observations

1. **Sandboxing is correct**: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` on every window.
2. **Preload bridge is minimal**: Only `ipcRenderer.invoke` + one controlled `on` listener. No raw IPC exposed.
3. **Path allowlist uses `realpathSync`**: Defeats symlink escape attacks.
4. **External URL allowlist**: Only `https:` to two known hostnames.
5. **Single-instance lock**: Prevents dual-process races.
6. **Shutdown is defensive**: `try/catch` around every teardown step, timeout on graceful shutdown.
7. **Disk space pre-check**: Warns before writing on low-disk systems.
8. **SQLite header verification**: Catches corrupt DB copies early.
9. **`devTools: isDev`**: DevTools disabled in production builds.

---

*Report generated by automated security review. No changes were made to the codebase.*
