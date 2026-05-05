# Electron Migration Status

**Last updated:** 2026-05-05  
**Status:** Implemented in-tree, not release-proven  
**Scope of this file:** Current state, remaining risks, and next actions. The original planning docs remain historical context.

## Current State

Hydra now has an Electron shell and packaging path, but this should not be treated as "done" until the packaged app is tested on target platforms.

Implemented:

- `electron/main.js` starts the embedded Express server after setting Electron data-path environment variables.
- `electron/preload.js` exposes a small `window.hydraNative` bridge with context isolation and no renderer Node access.
- `server/standalone.js` preserves the terminal/server entry point.
- `package.json` includes Electron scripts: `preview:electron`, `dev:electron`, `electron:prepare`, `electron:build`, and `electron:smoke`.
- `electron-builder.yml` exists for macOS DMG, Windows NSIS, and Linux AppImage packaging.
- `scripts/prepare-electron-resources.mjs` prepares the empty SQLite DB and Playwright Chromium payload for packaging.
- Electron-specific tests exist under `electron/tests/` and `server/tests/electron-*.test.mjs`.

Not verified in this cleanup:

- No build, smoke test, or packaged-app launch was run as part of this doc update.
- Existing uncommitted Electron implementation changes in `electron-builder.yml`, `electron/main.js`, `package.json`, and `scripts/prepare-electron-resources.mjs` were not modified here.

## Documentation Map

| Doc | Status | Use |
| --- | --- | --- |
| `docs/ELECTRON_MIGRATION_STATUS.md` | Current | Short operational status and remaining risk list |
| `docs/ELECTRON_MASTER_PLAN.md` | Historical plan | Architecture decisions and original verification checklist |
| `docs/2026-04-27/ELECTRON_PAIN_POINTS.md` | Historical audit | Original issue inventory and rationale |
| `docs/ELECTRON_TROUBLESHOOTING.md` | Current support doc | Runtime/build troubleshooting |

## Remaining Risks

| Risk | Current read | Next action |
| --- | --- | --- |
| ESM Electron entry point | `package.json` points to `electron/main.js` and the project is ESM. This is implemented, but packaged launch still needs proof. | Run `npm run preview:electron` and launch a built app from `release/`. |
| Prisma in packaged app | `asar` is currently disabled and `.prisma` / `@prisma` are explicitly included. This avoids the original asar failure mode but increases package surface. | Run DB read/write smoke tests in the packaged app on macOS and Windows. |
| Playwright Chromium in packaged app | `electron:prepare` copies the platform Chromium payload into `build/electron/chromium`, and builder copies it to resources. The runtime lookup still needs end-to-end validation. | From a packaged app, run the provisioning path that launches Playwright. |
| Data migration | `migrateLegacyData.js` exists and Electron sets `HYDRA_DATA_DIR`, but first-launch migration still needs fixture-backed verification. | Test fresh install, legacy `./data` migration, restart, and no second-copy behavior. |
| Unsigned macOS app | Gatekeeper will block or warn for normal users. | Keep troubleshooting instructions current; add code signing before public distribution. |
| Windows Defender / trust | Unsigned local proxy apps can be flagged. | Validate the NSIS build on a clean Windows VM; plan signing if distribution widens. |
| CI and cross-platform builds | Scripts/config exist, but this file has no evidence that macOS, Windows, and Linux builds pass in CI. | Add or verify CI runs `electron:build` and a smoke launch per platform. |
| Release size | Chromium plus Electron will be large. `electron-builder` pruning is configured by omission of broad `node_modules` globs. | Record actual artifact sizes after the next build. |

## Actionable Verification Checklist

Run these before calling the migration release-ready:

1. `npm run preview:electron` opens the production UI and API calls work.
2. `npm run electron:build` produces the expected platform artifact.
3. `npm run electron:smoke` passes against the built artifact.
4. Packaged app can create/read accounts and survives restart with data intact.
5. Packaged app can run the Playwright provisioning path.
6. Fresh Electron launch migrates legacy `./data` once and then uses Electron `userData`.
7. Built macOS and Windows apps are launched on clean machines without repo-local Node assumptions.
8. CI coverage is confirmed for the build and smoke path.

## Definition of Done

The Electron migration is done only when the checklist above passes and the results are recorded with dates, platform, artifact path, and any known limitations.
