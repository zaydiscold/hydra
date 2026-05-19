# Electron Troubleshooting Guide

## App won't start / crashes immediately

**Symptom:** Double-click Hydra.app, nothing happens or it flashes and disappears.

**Fixes:**
1. macOS Gatekeeper: Right-click → Open (first time only)
2. Check logs: `~/Library/Logs/Hydra/main.log`
3. Run from terminal: `/Applications/Hydra.app/Contents/MacOS/Hydra` to see console output
4. Verify the package contract without launching the GUI:

```bash
npm run electron:smoke
codesign --verify --deep --strict --verbose=4 release/mac-arm64/Hydra.app
find release/mac-arm64/Hydra.app/Contents/Resources -maxdepth 14 -name '*.app' -print
```

The `find` command should print nothing. Electron helper apps under
`Contents/Frameworks/` are expected, but nested app bundles under
`Contents/Resources/` are not.

### macOS crash report: `RegisterApplication` / `kLSNoExecutableErr`

**Symptom:** macOS shows "Hydra quit unexpectedly" before Hydra logs anything.
The crash report may show `abort()` from `RegisterApplication`, and
`open -W Hydra.app` may report `kLSNoExecutableErr`.

**Likely cause:** the packaged app contained a nested Playwright Chromium
`.app` under `Contents/Resources`. LaunchServices recursively scans app bundles
and can mis-register or reject the outer app when nested bundles are shipped
unpacked in Resources.

**Current packaging fix:** `scripts/prepare-electron-resources.mjs` archives the
target Playwright browser as `build/electron/chromium.zip`, and
`electron-builder.yml` ships that archive as `Contents/Resources/chromium.zip`.
Runtime extracts it under the Hydra data directory before browser automation
launches. Rebuild with:

```bash
npm run electron:build
npm run electron:smoke
```

## "Table does not exist" on first launch

**Symptom:** Prisma errors about missing tables in the database.

**Fix:** Delete the database and restart. The app will create a fresh database.
- **Packaged:** `~/Library/Application Support/Hydra/hydra.db` (macOS), `%APPDATA%/Hydra/hydra.db` (Windows), or `~/.config/hydra/hydra.db` (Linux)
- **Dev:** `./data/hydra.db`

## Prisma cannot find `.prisma/client/default`

**Symptom:** Packaged Electron starts, then crashes or logs an error like:

```text
Cannot find module '.prisma/client/default'
```

**Cause:** Electron Builder's default `node_modules` file matching can filter dotfile directories such as `node_modules/.prisma/`. Prisma's generated client expects that directory to exist next to packaged `node_modules`, so the packaged app cannot load its native query engine.

**Fix:**
1. `electron-builder.yml` keeps `asar: false` so Prisma's normal module lookup works in the packaged app layout.
2. `electron/builders/afterPack.js` copies `node_modules/.prisma` into the packaged app after Electron Builder finishes its pruning pass.
3. The same `afterPack` hook keeps only the native Prisma engine for the target platform and prunes unused Prisma runtime variants.

**Do not re-enable asar casually.** If you re-enable asar, verify Prisma startup in a packaged `.app` and confirm `.prisma/client` plus the target `libquery_engine-*.node` file exist in the final resources layout.

## Playwright can't find Chromium

**Symptom:** Account generation fails with "browserType.launch: Executable doesn't exist"

**Fixes:**
1. Set `HYDRA_PLAYWRIGHT_EXECUTABLE_PATH=/path/to/Chrome` to force a specific browser binary.
2. Set `HYDRA_PLAYWRIGHT_CHANNEL=chrome` to use system Chrome.
3. Set `HYDRA_PLAYWRIGHT_CDP_ENDPOINT=http://127.0.0.1:9222` to connect to an existing Chrome instance for management-key provisioning.
4. In dev: run `npx playwright install chromium`.

The packaged app bundles Chromium via `scripts/prepare-electron-resources.mjs`. At runtime, the app looks for `process.resourcesPath/chromium.zip`, extracts it under the Hydra data directory, then launches the platform-specific Playwright Chromium payload from that extracted location.

## Accounts not showing after Electron launch

**Cause:** Data was migrated from `./data/` on first launch. If you re-ran during development, the dev DB may have been overwritten.

**Fix:**
1. Close Hydra
2. Locate your data dir: `app.getPath('userData')` (also exposed as `HYDRA_DATA_DIR` inside Electron)
   - macOS: `~/Library/Application Support/Hydra/`
   - Windows: `%APPDATA%/Hydra/`
   - Linux: `~/.config/hydra/`
3. Copy your actual data: `cp ./data/hydra.db ~/Library/Application\ Support/Hydra/`
4. Restart

## Port conflict / which port is Electron using?

Packaged Electron uses an OS-assigned loopback port. Dev Electron prefers `127.0.0.1:3001` for easier debugging, then falls back to a random free port if 3001 is busy. The actual port is shown in Diagnostics and native status.

For dev work, use `npm run dev:electron`; it starts Vite and Electron with the correct `VITE_DEV_SERVER_URL`. `HYDRA_PORT` is for standalone server/CLI diagnostics, not an Electron port override.

## Vite dev server not found (dev mode)

`npm run dev:electron` starts Vite itself and passes the selected URL to Electron as `VITE_DEV_SERVER_URL`. If you start Electron manually, start Vite first or set `VITE_DEV_SERVER_URL=http://localhost:<vite-port>`.

## Code signing / notarization

Hydra v1 is unsigned. Mac users must right-click → Open on first launch.
Windows users may see SmartScreen warning → click "More info" → "Run anyway".
Linux AppImage requires `chmod +x` before running.

## Key Paths Reference

| Purpose | Path |
|---------|------|
| **Packaged resources** | `process.resourcesPath` (bundled schema, migrations, Chromium, empty DB) |
| **User data** | `app.getPath('userData')` (hydra.db, local-secrets.json, etc.) |
| **Env override** | `HYDRA_DATA_DIR` (set by `electron/main.js` before server import) |
| **Logs** | `~/Library/Logs/Hydra/main.log` (macOS) / `%APPDATA%/Hydra/logs/` (Windows) |
| **Dev data** | `./data/` (working directory; migrated to userData on first Electron launch) |
