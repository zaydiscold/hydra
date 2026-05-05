# Electron Migration Status

**Last updated:** 2026-05-05
**Status:** Implemented — production-ready for development builds and CI-verified packaging

## Current State

Hydra runs as a first-class Electron desktop application. The Electron shell handles startup, data paths, schema sync, Chromium provisioning, and graceful shutdown — no terminal or browser required for normal operation.

### What's Implemented

| Layer | Status | Details |
| --- | --- | --- |
| **Main process** (`electron/main.js`) | ✓ | Express server bootstrap, data-path pins, splash window, IPC bridge, tray icon, single-instance lock |
| **Preload bridge** (`electron/preload.js`) | ✓ | Context-isolated `window.hydraNative` with `getVersion`, `getPaths`, `getStatus`, `openPath`, `platform`, `hideWindow`, `quitApp` |
| **Server entry** (`server/standalone.js`) | ✓ | Terminal/server mode preserved for headless/CLI use |
| **Packaging config** (`electron-builder.yml`) | ✓ | macOS DMG (arm64), Windows NSIS (x64), Linux AppImage + deb (x64) |
| **Resource preparation** (`scripts/prepare-electron-resources.mjs`) | ✓ | Builds empty SQLite DB + bundles platform-specific Playwright Chromium to `build/electron/` |
| **Empty DB builder** (`scripts/build-empty-db.mjs`) | ✓ | Generates `data/empty-hydra.db` (Prisma `db push` with sqlite3 fallback) |
| **Smoke tests** (`scripts/smoke-electron-package.mjs`) | ✓ | Verifies Prisma engine, migrations, empty DB, bundled Chromium, and DB query capacity in packaged output |
| **Schema self-heal** (`server/lib/db-self-heal.js`) | ✓ | Idempotent ALTER TABLE / CREATE INDEX replay — no Prisma CLI needed in packaged app |
| **Per-install JWT** (at `userData/jwt-secret`) | ✓ | Auto-generated 32-byte hex secret on first launch, persisted with `0o600` permissions |
| **Empty DB copy** (from `resourcesPath/data/empty-hydra.db`) | ✓ | Pre-initialized SQLite copied to `userData/hydra.db` on first launch |
| **Bundled Chromium** (at `resourcesPath/chromium/`) | ✓ | Platform-specific Playwright browser bundled via `extraResources` |
| **Legacy data migration** (`electron/utils/migrateLegacyData.js`) | ✓ | One-shot migration from `./data/` to Electron `userData` |
| **afterPack hook** (`electron/builders/afterPack.js`) | ✓ | Copies `.prisma/client` into packaged `node_modules`, prunes unused engine variants |
| **Code signing config** | ✓ | `hardenedRuntime: true`, entitlements plist, `gatekeeperAssess: false` (verification skipped) |

### npm Scripts

| Script | Purpose |
| --- | --- |
| `npm run preview:electron` | Build production frontend + launch in Electron |
| `npm run dev:electron` | Concurrent Vite dev server + Electron (hot-reload) |
| `npm run electron:prepare` | Run `scripts/prepare-electron-resources.mjs` (empty DB + Chromium bundle) |
| `npm run electron:build` | Full build chain: `npm run build` → `electron:prepare` → electron-builder |
| `npm run electron:smoke` | Run `scripts/smoke-electron-package.mjs` against unpacked `release/` artifact |

### Documentation Map

| Doc | Use |
| --- | --- |
| `docs/ELECTRON_MIGRATION_STATUS.md` | **This file** — current operational status |
| `docs/ELECTRON_TROUBLESHOOTING.md` | Runtime and build troubleshooting |
| `docs/PACKAGING.md` | Single source for packaging flow, scripts, Chromium bundling, Prisma, code signing |
| `docs/ELECTRON_MASTER_PLAN.md` | Historical architecture plan (no longer actively maintained) |
| `docs/2026-04-27/ELECTRON_PAIN_POINTS.md` | Historical issue audit (no longer actively maintained) |

### Known Gaps / Next Actions

The implementation is complete and tested in development. The following should be verified before a public release:

1. [ ] Run `npm run electron:smoke` against a fresh build on macOS, Windows, and Linux.
2. [ ] Launch the packaged `.app` / `.exe` / `.AppImage` on a clean machine with no Node.js installed.
3. [ ] Verify Playwright provisioning path works using the bundled Chromium.
4. [ ] Test fresh install, legacy `./data` migration, restart, and no second-copy behavior.
5. [ ] Sign macOS build with an Apple Developer certificate before public distribution.
6. [ ] Validate Windows NSIS build on a clean Windows VM (SmartScreen).
7. [ ] Record artifact sizes after the next build.
