# Packaging

Single source for Hydra Electron packaging pipeline, artifacts, and smoke testing.

## Quick Start

```bash
# Full build pipeline
npm run electron:build

# Smoke test the result
npm run electron:smoke

# Open the packaged macOS app for GUI dogfood through LaunchServices
npm run electron:open:mac-arm64
```

On macOS, the default target is a zip artifact. Sandboxed agent environments
cannot start the `hdiutil` helper (`hdiejectd`) required for DMG creation, so
the default local build path avoids DMG. For release machines outside that
sandbox, run:

```bash
npm run electron:build:dmg
```

Platform-specific release machines can also run:

```bash
npm run electron:build:mac-arm64 # Apple Silicon Mac zip
npm run electron:build:mac-x64   # Intel Mac zip, including 2019 Intel Macs
npm run electron:build:win     # Windows runner: NSIS x64
npm run electron:build:linux   # Linux runner: AppImage x64
```

Run the Intel Mac target on an Intel Mac or an Intel GitHub runner. The packaged
browser payload is architecture-specific: Apple Silicon machines normally only
have Playwright's `chrome-mac-arm64` cache, while the Intel package needs
`chrome-mac`.

The same target-cache rule applies to Windows and Linux release artifacts.
`HYDRA_BUILD_TARGET=win32-x64` needs a `chrome-win` Playwright payload, so a
local macOS cross-build is not enough unless `PLAYWRIGHT_BROWSERS_PATH` points
at a cache that already contains the Windows payload. Build Windows installers
on a Windows runner/machine, and Linux AppImages on a Linux runner/machine.

For local macOS artifact construction only, a Windows cache can be staged into
`/private/tmp` from Playwright's Chrome-for-Testing URL for the current
`playwright-core/browsers.json` Chromium version, then passed through
`PLAYWRIGHT_BROWSERS_PATH`. On this sandbox the normal Windows resource-edit
path fails in Wine (`wineserver: Can't check in server_mach_port`), so the
local proof artifact used:

```bash
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/hydra-pw-cross \
ELECTRON_CACHE=/private/tmp/hydra-electron-cache \
ELECTRON_BUILDER_CACHE=/private/tmp/hydra-electron-builder-cache \
npx electron-builder --win nsis --x64 -c.win.signAndEditExecutable=false

HYDRA_BUILD_TARGET=win32-x64 npm run electron:smoke
```

That proves the Windows package resources and NSIS artifact shape, but final
Windows acceptance still requires installing and launching on Windows.

For Zayd's Intel home machine:

```bash
npm run electron:build:home-intel
```

That script transfers a clean source snapshot to `ssh home` in small chunks,
assembles it under `$HOME/Desktop/hydra` by default, then runs
`npm run electron:build:mac-x64`,
`HYDRA_BUILD_TARGET=darwin-x64 npm run electron:smoke`, and
`codesign --verify --deep --strict` on the Intel Mac. Existing remote checkouts
are moved to `$HOME/Desktop/hydra-remote-backups/hydra-<timestamp>`
instead of being deleted, and the finished x64 zip/blockmap are copied back into
the local `release/` directory. It intentionally excludes `data/`, `.env*`,
`node_modules/`, `videos/`, and local build outputs.

For GitHub Actions, use `macos-14`/`macos-15` for arm64 builds and
`macos-15-intel` for Intel x64 builds. GitHub's hosted runner reference lists
the Intel and arm64 macOS labels separately; do not rely on `macos-latest` when
the output architecture matters.

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

**Windows code-signing:** see the commented `certificateFile` / `certificatePassword` block in `electron-builder.yml`. We don't yet ship a signed Windows installer; this is tracked in `docs/IDEAS.md`.

## CI / Release

- `.github/workflows/ci.yml` runs `npm run lint`, `npm test`, `npm run gate`, and `npm run build` on PRs and pushes to `master`.
- `.github/workflows/electron-smoke.yml` builds and smoke-tests macOS, Windows, and Linux package contracts on every PR.
- `.github/workflows/release.yml` runs on `v*.*.*` tags, builds the macOS zip, Windows NSIS installer, and Linux AppImage with `electron-builder --publish never`, runs `npm run electron:smoke`, then uploads the verified artifacts to the GitHub Release with `gh release upload`.


## Pipeline Steps

### 1. `npm run build` (Vite)

Builds the React frontend into `dist/`. Uses `vite.config.js` with `base: './'` so assets resolve correctly under `file://` and dynamic-port origins in the packaged app.

### 2. `npm run electron:prepare`

Runs `scripts/prepare-electron-resources.mjs`. Produces:

- **`build/electron/data/empty-hydra.db`** — empty SQLite database (see [Empty DB](#empty-db))
- **`build/electron/chromium.zip`** — zipped platform-specific Playwright Chromium payload (see [Chromium Bundling](#chromium-bundling))

These are consumed by `electron-builder`'s `extraResources` config.

### 3. `electron-builder`

Runs from `electron-builder.yml`. Produces platform artifacts in `release/`:

| Platform | Artifact |
|----------|----------|
| macOS (arm64) | `release/mac-arm64/Hydra.app` → zip by default; DMG via `npm run electron:build:dmg` |
| macOS Intel (x64) | `release/mac/Hydra.app` → zip via `npm run electron:build:mac-x64` |
| Windows (x64) | `release/win-unpacked/` → NSIS installer |
| Linux (x64) | `release/linux-unpacked/` → AppImage |

**Key config decisions:**
- `asar: false` — required for Prisma's native module resolution (`.prisma/client` dotfile directory).
- `afterPack: ./electron/builders/afterPack.js` — copies `.prisma/client` into the packaged app and keeps only the target platform's Prisma engine binary.
- `extraResources` — ships `prisma/schema.prisma`, `prisma/migrations/`, empty DB, and bundled Chromium archive into `process.resourcesPath`.
- Files pattern intentionally omits `node_modules/**/*` to let electron-builder use its production-pruned default ruleset. Only `.prisma` and `@prisma` are explicitly included.

## Chromium Bundling

`scripts/prepare-electron-resources.mjs`:

1. Reads the Playwright Chromium revision from `node_modules/playwright-core/browsers.json`.
2. Searches standard Playwright browser cache locations for that revision.
3. If not found, runs `npx playwright install chromium` to fetch it. The full `playwright` package is an optional dependency for this install/prepare path; runtime automation imports `playwright-core`.
4. Copies only the platform-specific Chrome payload (`chrome-mac`, `chrome-win`, `chrome-linux`, or `chrome-mac-arm64`) into `build/electron/chromium/`.
5. Archives that payload as `build/electron/chromium.zip` and removes the unpacked staging directory so nested `.app` bundles are not embedded inside Hydra's macOS app bundle.
6. At runtime, the app reads `process.resourcesPath/chromium.zip`, extracts it into `HYDRA_DATA_DIR/chromium`, then launches Chromium from that extracted user-data location.

Set `HYDRA_BUILD_TARGET` when preparing resources for a release target:

| Target | Required Chromium payload |
| --- | --- |
| `darwin-arm64` | `chrome-mac-arm64` |
| `darwin-x64` | `chrome-mac-x64` or `chrome-mac` |
| `win32-x64` | `chrome-win` |
| `linux-x64` | `chrome-linux` |

If the target payload is missing, the prepare script fails before
`electron-builder` runs and prints the target runner/machine that should build
that artifact.

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

1. Finds the unpacked `release/` directory for `HYDRA_BUILD_TARGET` first
   (`mac-arm64`, `mac`, `linux-unpacked`, or `win-unpacked`), then falls back
   to the newest unpacked resources directory only when no target is supplied.
2. Asserts: `prisma/schema.prisma`, `prisma/migrations/`, `data/empty-hydra.db` exist in resources.
3. Asserts: Prisma query engine binary exists in `.prisma/client/`.
4. Asserts: Bundled Chromium exists as `resources/chromium.zip`, contains a platform executable, and matches `HYDRA_BUILD_TARGET` when that target is supplied.
5. Asserts: the packaged shell is structurally valid without launching a GUI.
   On macOS this includes `Info.plist`, `PkgInfo`,
   `CFBundleExecutable=Hydra`, `CFBundlePackageType=APPL`,
   `CFBundleIdentifier=com.zayd.hydra`, main/helper executables, no nested
   `.app` bundles under `Contents/Resources`, and packaged window source that
   uses the native AppKit frame (`frame: useNativeMacChrome`) without
   `titleBarStyle` or `trafficLightPosition` overrides; on Windows/Linux this
   includes the main executable.
6. Asserts: the distributable artifact exists and is non-empty. For macOS zips it also inspects zip contents for `Hydra.app/Contents/MacOS/Hydra`; for Linux it verifies the AppImage is executable.
7. Asserts: Package size is under `HYDRA_MAX_PACKAGED_APP_MB` (default 900 MB).
8. Opens the empty DB with PrismaClient and runs `SELECT 1` to confirm it's valid.

This is still a package contract, not GUI acceptance. Window movement,
traffic-light controls, menus, tray behavior, live account flows, and visual
screenshots must be dogfooded in the packaged Electron app after code-level
checks are exhausted.

For macOS GUI dogfood, use:

```bash
npm run electron:open:mac-arm64
```

That command calls `open -n release/mac-arm64/Hydra.app`. Do not spawn
`release/mac-arm64/Hydra.app/Contents/MacOS/Hydra` directly for GUI acceptance;
direct executable launches can abort during macOS application registration and
do not represent the normal packaged app launch path.

Use `docs/PACKAGED_ELECTRON_DOGFOOD.md` for the final acceptance checklist.
That runbook is the source of truth for packaged Electron-only dogfood,
live-flow evidence, Windows installer launch, Docker runtime, and the
screenshot-last rule. Chrome, `vite preview`, localhost browser tabs, and
browser-only screenshots do not close packaged-app release blockers.

## Artifact Output

All build artifacts land in `release/`:

```
release/
├── Hydra-1.0.0-mac-arm64.zip      # macOS zip artifact
├── Hydra-1.0.0-mac-arm64.dmg      # macOS DMG from electron:build:dmg
├── mac-arm64/
│   └── Hydra.app/                 # Unpacked macOS app
├── Hydra-1.0.0-win-x64.exe        # Windows NSIS installer
├── win-unpacked/                  # Unpacked Windows app
├── Hydra-1.0.0-linux-x64.AppImage # Linux AppImage
└── linux-unpacked/                # Unpacked Linux app
```
