# Packaging

Single source for Hydra Electron packaging pipeline, artifacts, and smoke testing.

## Quick Start

```bash
# Full build pipeline
npm run electron:build

# Smoke test the result
npm run electron:smoke
```

## Signing & Notarization (macOS)

Hydra ships an `afterSign` hook (`electron/builders/notarize.cjs`) that submits the freshly-signed `.app` to Apple's notary service automatically. Notarization is what eliminates the "Hydra cannot be opened because the developer cannot be verified" Gatekeeper warning on first launch.

**Required for signed/notarized builds:**

```bash
# 1. Apple Developer Program membership ($99/yr) and a Developer ID Application
#    certificate installed in your Keychain.
# 2. App-specific password from https://appleid.apple.com → Security.
# 3. Uncomment the `mac.identity` line in electron-builder.yml (set to the
#    Common Name of your cert, e.g. "Developer ID Application: Your Name (ABCDE12345)").
# 4. Export these env vars before `npm run electron:build`:

export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"
npm run electron:build
```

**Verify the result:**

```bash
codesign -dvv release/mac-arm64/Hydra.app                    # signature info
spctl --assess --verbose=4 release/mac-arm64/Hydra.app       # gatekeeper accepts
xcrun stapler validate release/mac-arm64/Hydra.app           # notarization stapled
```

**Skipping (local dev / unsigned builds):** if any of the three env vars are missing, the hook prints a warning and the build still completes — the resulting `.app` just isn't notarized. Set `HYDRA_SKIP_NOTARIZE=1` to silence the warning.

**Windows code-signing:** see the commented `certificateFile` / `certificatePassword` block in `electron-builder.yml`. We don't yet ship a signed Windows installer; this is tracked in `docs/ROADMAP_NEXT.md`.


## Pipeline Steps

### 1. `npm run build` (Vite)

Builds the React frontend into `dist/`. Uses `vite.config.js` with `base: './'` so assets resolve correctly under `file://` and dynamic-port origins in the packaged app.

### 2. `npm run electron:prepare`

Runs `scripts/prepare-electron-resources.mjs`. Produces:

- **`build/electron/data/empty-hydra.db`** — empty SQLite database (see [Empty DB](#empty-db))
- **`build/electron/chromium/`** — platform-specific Playwright Chromium payload (see [Chromium Bundling](#chromium-bundling))

These are consumed by `electron-builder`'s `extraResources` config.

### 3. `electron-builder`

Runs from `electron-builder.yml`. Produces platform artifacts in `release/`:

| Platform | Artifact |
|----------|----------|
| macOS (arm64) | `release/mac-arm64/Hydra.app` → DMG |
| Windows (x64) | `release/win-unpacked/` → NSIS installer |
| Linux (x64) | `release/linux-unpacked/` → AppImage |

**Key config decisions:**
- `asar: false` — required for Prisma's native module resolution (`.prisma/client` dotfile directory).
- `afterPack: ./electron/builders/afterPack.js` — copies `.prisma/client` into the packaged app and keeps only the target platform's Prisma engine binary.
- `extraResources` — ships `prisma/schema.prisma`, `prisma/migrations/`, empty DB, and bundled Chromium into `process.resourcesPath`.
- Files pattern intentionally omits `node_modules/**/*` to let electron-builder use its production-pruned default ruleset. Only `.prisma` and `@prisma` are explicitly included.

## Chromium Bundling

`scripts/prepare-electron-resources.mjs`:

1. Reads the Playwright Chromium revision from `node_modules/playwright-core/browsers.json`.
2. Searches standard Playwright browser cache locations for that revision.
3. If not found, runs `npx playwright install chromium` to fetch it. The full `playwright` package is an optional dependency for this install/prepare path; runtime automation imports `playwright-core`.
4. Copies the platform-specific Chrome payloads (`chrome-mac`, `chrome-win`, `chrome-linux`, `chrome-mac-arm64`) into `build/electron/chromium/`.
5. At runtime, the app looks under `process.resourcesPath/chromium/` for the bundled browser.

## Prisma Engine (afterPack Hook)

`electron/builders/afterPack.js` runs after electron-builder finishes its pruning pass:

1. Copies `node_modules/.prisma/client/` into the packaged `node_modules` layout.
2. Filters to keep only the **native engine binary** for the target platform+arch (e.g., `libquery_engine-darwin-arm64.dylib.node` for macOS ARM).
3. Drops foreign engine binaries, WASM variants, and edge-runtime files.
4. Prunes unused `@prisma/client/runtime/` files (browser, edge, React Native, source maps).
5. Verifies the expected engine binary exists in the final layout.

This avoids ~80 MB of unnecessary native binaries while keeping Prisma functional.

## Empty DB

`scripts/build-empty-db.mjs` generates `data/empty-hydra.db`:

1. Runs `npx prisma db push` against a temporary database to create all tables from the schema (empty, no rows).
2. Falls back to a raw SQL bootstrap if Prisma push fails.
3. Copies the result to `data/empty-hydra.db` and cleans up temporary files.

On first launch, `electron/utils/migrateLegacyData.js` copies this empty DB to the user's data directory (or migrates existing `./data/` if present).

## Code Signing

Hydra v1 is **unsigned**. The `electron-builder.yml` config specifies `hardenedRuntime: true` and `gatekeeperAssess: false` for macOS. Entitlements are at `desktop/entitlements.mac.plist`.

To sign for distribution:
1. Set `mac.identity` in `electron-builder.yml` or use `CSC_LINK` / `CSC_KEY_PASSWORD` env vars.
2. For notarization: set `mac.notarize` with Apple credentials.

## Smoke Tests

```bash
npm run electron:smoke
```

`scripts/smoke-electron-package.mjs` validates the unpacked package contract without launching a GUI:

1. Finds the unpacked `release/` directory (macOS `.app/Contents/Resources`, or `linux-unpacked/resources`, or `win-unpacked/resources`).
2. Asserts: `prisma/schema.prisma`, `prisma/migrations/`, `data/empty-hydra.db` exist in resources.
3. Asserts: Prisma query engine binary exists in `.prisma/client/`.
4. Asserts: Bundled Chromium exists under `resources/chromium/`.
5. Asserts: Package size is under `HYDRA_MAX_PACKAGED_APP_MB` (default 900 MB). The current macOS ARM smoke path is roughly 49 MB.
6. Opens the empty DB with PrismaClient and runs `SELECT 1` to confirm it's valid.

## Artifact Output

All build artifacts land in `release/`:

```
release/
├── Hydra-1.0.0-arm64.dmg          # macOS DMG installer
├── Hydra-1.0.0-arm64-mac.zip      # macOS zip (auto-generated)
├── mac-arm64/
│   └── Hydra.app/                 # Unpacked macOS app
├── Hydra Setup 1.0.0.exe          # Windows NSIS installer
├── win-unpacked/                  # Unpacked Windows app
├── Hydra-1.0.0.AppImage           # Linux AppImage
└── linux-unpacked/                # Unpacked Linux app
```
