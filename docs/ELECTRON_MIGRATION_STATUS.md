# Electron Migration Status

**Last updated:** 2026-05-06
**Status:** Implemented in-tree; current local validation passed

## Summary

Hydra is now a native desktop application running on Electron. The migration code is implemented in-tree and the current macOS ARM local validation path passes build, lint, Electron tests, gate, and package smoke checks. Cross-platform installers remain configured, but each release still needs a platform-specific build and launch pass before calling it release-proven.

### What was done

- **Electron shell** — `electron/main.js` boots the embedded Express server, manages BrowserWindow lifecycle, and provides a minimal IPC bridge via `electron/preload.js` with context isolation.
- **Server embeddable** — `server/standalone.js` preserves the terminal/server entry point. The Express server (`server/index.js`) exports `bootstrap()` and `gracefulShutdown()` for embedders without auto-running.
- **Data migration** — First Electron launch migrates legacy `./data/` to the platform-native `app.getPath('userData')` directory via `electron/utils/migrateLegacyData.js`. The `HYDRA_DATA_DIR` env var is set before any server import.
- **Prisma & native modules** — `electron-builder.yml` disables asar so Prisma's native query engine resolves normally. The `afterPack` hook (`electron/builders/afterPack.js`) copies the generated `.prisma/client` into the packaged app and prunes foreign engine binaries.
- **Playwright Chromium** — runtime code imports `playwright-core`; the full `playwright` package is dev-only for installing/finding the browser payload during `electron:prepare`. `scripts/prepare-electron-resources.mjs` locates the Chromium revision and copies the platform payload into `build/electron/chromium/` for `electron-builder` `extraResources`.
- **Empty DB** — `scripts/build-empty-db.mjs` generates an empty SQLite database (`data/empty-hydra.db`) from the Prisma schema, shipped with the app for first-launch instant setup.
- **Packaging** — `npm run electron:build` runs `vite build` → `electron:prepare` → `electron-builder`. Output lands in `release/`.
- **Smoke tests** — `npm run electron:smoke` validates the unpacked package contract (Prisma engine, migrations, empty DB, bundled Chromium, package size).
- **Dev loop** — `npm run dev:electron` runs Vite HMR inside the Electron window for development.
- **Runtime hardening and perf** — packaged JWT secrets are generated per install and rechecked on boot, CORS is loopback/allowlist based, gzip compresses static responses, `vite` targets Chromium 120, schema hash work uses async reads, and `cheerio` / `electron-log` are no longer runtime dependencies.

### Current Validation

| # | Item | Status |
|---|------|--------|
| 1 | `npm run lint` | ✅ local pass |
| 2 | `npm run build` | ✅ local pass |
| 3 | `npm run test:electron` | ✅ local pass |
| 4 | Focused Electron/server compatibility tests | ✅ local pass |
| 5 | `npm run gate` | ✅ 12/12 local pass |
| 6 | `npm run electron:smoke` | ✅ local macOS ARM package contract pass |
| 7 | Packaged app creates/reads accounts and survives restart with data intact | Needs manual release pass |
| 8 | Packaged app runs browser UI provisioning path | Needs live account release pass |
| 9 | macOS DMG, Windows NSIS, and Linux AppImage installers | Configured; verify per target before release |
| 10 | CI coverage for build and smoke path | Not asserted by this doc |

## Documentation Map

| Doc | Purpose |
|-----|---------|
| `docs/ELECTRON_MIGRATION_STATUS.md` | This file — current status |
| `docs/ELECTRON_MASTER_PLAN.md` | Historical architecture decisions and original plan |
| `docs/ELECTRON_TROUBLESHOOTING.md` | Runtime/build troubleshooting guide |
| `docs/PACKAGING.md` | Packaging pipeline and artifact details |
