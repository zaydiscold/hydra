# Electron Troubleshooting Guide

## App won't start / crashes immediately

**Symptom:** Double-click Hydra.app, nothing happens or it flashes and disappears.

**Fixes:**
1. macOS Gatekeeper: Right-click → Open (first time only)
2. Check `~/Library/Application Support/hydra/logs/` for error logs
3. Run from terminal: `/Applications/Hydra.app/Contents/MacOS/Hydra` to see console output

## "Table does not exist" on first launch

**Symptom:** Prisma errors about missing tables in the database.

**Fix:** Delete `~/Library/Application Support/hydra/hydra.db` and restart. The app will create a fresh database.

## Playwright can't find Chromium

**Symptom:** Account generation fails with "browserType.launch: Executable doesn't exist"

**Fixes:**
1. Set `HYDRA_PLAYWRIGHT_CHANNEL=chrome` env var to use system Chrome
2. Or set `HYDRA_PLAYWRIGHT_CDP_ENDPOINT=http://127.0.0.1:9222` to connect to existing Chrome
3. In dev: run `npx playwright install chromium`

## Accounts not showing after Electron launch

**Cause:** Data was migrated from `./data/` on first launch. If you re-ran during development, the dev DB may have been overwritten.

**Fix:** 
1. Close Hydra
2. Copy your actual data: `cp ./data/hydra.db ~/Library/Application\ Support/hydra/`
3. Restart

## Code signing / notarization

Hydra v1 is unsigned. Mac users must right-click → Open on first launch.
Windows users may see SmartScreen warning → click "More info" → "Run anyway".
Linux AppImage requires `chmod +x` before running.

## Port conflict (3001 already in use)

Hydra binds to port 3001 by default. Change it:
```bash
PORT=3002 npx electron .
```
Or set `HYDRA_PORT` in your environment.

## Vite dev server not found (dev mode)

`npm run dev:electron` requires Vite running on port 5173. Run `npm run dev` in a separate terminal first, or use `npm run dev:web` for browser-only dev.
