# Electron Troubleshooting Guide

## App won't start / crashes immediately

**Symptom:** Double-click Hydra.app, nothing happens or it flashes and disappears.

**Fixes:**
1. macOS Gatekeeper: Right-click → Open (first time only)
2. Check Electron logs: `~/Library/Logs/Hydra/main.log`
3. Run from terminal: `/Applications/Hydra.app/Contents/MacOS/Hydra` to see console output
4. Check the JWT secret: `~/Library/Application Support/Hydra/jwt-secret` — if it's empty or corrupted, delete it and restart (it will be auto-generated)

## "Table does not exist" on first launch

**Symptom:** Prisma errors about missing tables in the database.

**Fix:** Delete `~/Library/Application Support/Hydra/hydra.db` and restart. The app will copy the bundled empty database (`resourcesPath/data/empty-hydra.db`) on next launch, and the schema self-healer will replay any pending migrations.

## Prisma cannot find `.prisma/client/default`

**Symptom:** Packaged Electron starts, then crashes or logs an error like:
```text
Cannot find module '.prisma/client/default'
```

**Cause:** Electron Builder's default `node_modules` file matching filters dotfile directories such as `node_modules/.prisma/`.

**Current fix (already in place):**
- `electron-builder.yml` keeps `asar: false` so Prisma's normal module lookup works.
- `files` section explicitly includes `**/node_modules/.prisma/**/*` and `**/node_modules/@prisma/**/*`.
- `asarUnpack` ensures Prisma native binaries are extracted outside the asar for dlopen().
- `electron/builders/afterPack.js` copies `.prisma/client` into the packaged app and prunes all but the target platform's native engine binary.

**Do not remove `asar: false` casually.** If you re-enable asar, verify Prisma startup in a packaged `.app` and confirm `.prisma/client` plus the target `libquery_engine-*.node` file exist in the final resources layout.

## Playwright can't find Chromium (packaged app)

**Symptom:** Account generation fails with "browserType.launch: Executable doesn't exist"

**Fixes (in order of reliability):**

1. **Packaged app** — `npm run electron:prepare` bundles Chromium from Playwright's cache into `build/electron/chromium/`. At runtime `process.resourcesPath/chromium/` is scanned by `server/lib/playwright-browser.js` (`resolveBundledChromium()`). If missing, run `npm run electron:prepare` and rebuild.

2. **Force a specific binary:**
   ```bash
   HYDRA_PLAYWRIGHT_EXECUTABLE_PATH=/path/to/Chrome
   ```

3. **Use system Chrome:**
   ```bash
   HYDRA_PLAYWRIGHT_CHANNEL=chrome
   ```

4. **Attach to running Chrome instance (for debugging):**
   ```bash
   HYDRA_PLAYWRIGHT_CDP_ENDPOINT=http://127.0.0.1:9222
   ```

5. **Dev mode** — run `npx playwright install chromium`.

## Accounts not showing after Electron launch

**Cause:** Data was migrated from `./data/` on first launch. If you re-ran during development, the dev DB may have been overwritten by the empty DB copy.

**Fix:**
1. Close Hydra
2. Copy your actual data:
   ```bash
   cp ./data/hydra.db ~/Library/Application\ Support/Hydra/
   ```
3. Restart

## Per-install JWT secret issues

**Symptom:** Server crashes or returns 401 errors in the packaged app.

**Fix:** The JWT secret is auto-generated on first launch and stored at `~/Library/Application Support/Hydra/jwt-secret`. If you need to reset:
1. Close Hydra
2. Delete `~/Library/Application Support/Hydra/jwt-secret`
3. Restart — a new 32-byte hex secret will be generated

**Note:** This resets all existing JWT tokens. You'll need to re-authenticate.

## Schema not up to date after upgrade

**Symptom:** Column-not-found errors after updating Hydra to a version with new migrations.

**Fix:** The app auto-detects schema changes via a content hash of `schema.prisma` + migration SQL (stored in `userData/.schema-version`). On mismatch it runs the self-healer (`server/lib/db-self-heal.js`) which idempotently applies `ALTER TABLE ADD COLUMN` and `CREATE INDEX` statements.

If the self-healer still fails:
1. Close Hydra
2. Delete `~/Library/Application Support/Hydra/.schema-version`
3. Delete `~/Library/Application Support/Hydra/hydra.db` (data loss — backup first)
4. Restart — the empty DB will be re-copied and schema marked as current

## Code signing / notarization

Hydra v1 is unsigned. The `electron-builder.yml` config has `hardenedRuntime: true` and entitlements, but no Apple Developer certificate is configured.

| Platform | Workaround |
| --- | --- |
| macOS | Right-click → Open on first launch |
| Windows | SmartScreen → "More info" → "Run anyway" |
| Linux | AppImage requires `chmod +x` |

To enable signing: set `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables with your Apple Developer certificate before running `npm run electron:build`.

## Port conflict (3001 already in use)

Hydra binds to port 3001 by default. Change it:
```bash
PORT=3002 npx electron .
```
Or set `HYDRA_PORT` in your environment.

## Vite dev server not found (dev mode)

`npm run dev:electron` requires Vite running on port 5173. Run `npm run dev` in a separate terminal first, or use `npm run preview:electron` for the production build path.

## Packaged app size too large

**Default limit:** 900 MB (configurable via `HYDRA_MAX_PACKAGED_APP_MB`).

The largest contributors are:
1. **Chromium bundle** (~200-300 MB per platform) — only the platform-specific payload is copied by `prepare-electron-resources.mjs`
2. **Electron framework** (~200 MB)
3. **Prisma engine** (~20 MB for one platform)

If the app exceeds the limit, check for stray devDependencies in the packaged output or prune docs/tests.

## Debugging tips

- **Enable verbose logging:** Set `DEBUG=electron*` or use the `electron-log` console transport.
- **Check logs folder:** `~/Library/Logs/Hydra/main.log`
- **Check data folder:** `~/Library/Application Support/Hydra/`
- **Run unpacked:** Use `ELECTRON_APP_RESOURCES=/path/to/Hydra.app/Contents/Resources node scripts/smoke-electron-package.mjs` to test the resource contract.
