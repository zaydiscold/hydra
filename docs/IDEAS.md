# Hydra — Running Plan & Ideas

> **What this is:** the single canonical "what's not done yet" file.
>
> **What this isn't:** a place for pure history. Items move OUT once they
> ship. Items move IN when they're tracked but not yet built. Pure historical
> plans were removed once their actionable work shipped.
>
> **Last update:** 2026-05-18 — post docs/plan consolidation and code-health pass.

---

## 📅 Planned — actionable, scoped, ready to execute

### P0 — Most leverage per hour

#### 0. Splash → password fold (Pica-style "Continue" button)

Pica's onboarding does the falling-letters intro then transitions to a single solid card with a **Continue** button — no separate window. Currently Hydra runs the splash, dismisses, then opens a separate "Unlock Hydra" password window. Two windows = two visual contexts.

**Direction:** keep the splash window alive after the 10 s intro; replace the inner card's progress bar with a **password input + Continue button**. On submit, run the existing unlock flow inline. Only on success destroy the splash and open the main window. Fewer hand-offs, more cohesive feel.

**Files to touch:**
- `electron/app/windows.js` — splash inner card grows a form on a state flip
- `electron/main.js` — defer destroying splash until auth IPC succeeds
- `electron/preload.js` — expose `auth:login` IPC for the splash card
- `electron/app/ipc.js` — wire to the existing `/api/auth/login` server route
- `src/App.jsx` — when invoked from splash flow, skip the auth-screen state and jump straight to dashboard

ETA: ½ day. Risk: medium — auth currently lives in renderer; splash is a separate render context. Cleanest path is splash POSTs to the embedded server directly via `fetch('http://127.0.0.1:<port>/api/auth/login')` and reads the JWT before destroying itself.

---

#### 1. Auto-update via `electron-updater`

Without this every fix dies on the user's hard drive.

- Add `electron-updater` to deps; init in `electron/main.js` after window shown
- GitHub Releases as feed (free, signed)
- "Restart to update" toast when an update is staged
- Gate behind `app.isPackaged` so dev builds don't hit Releases
- ETA: 1 afternoon

#### 2. Drop bundled Chromium → lazy-download on first bulk-auth use

Chromium is **~330 MB / 54 % of the DMG**. Bulk-auth wizard is the only path that needs it. Move from `extraResources` to a one-time `playwright install chromium` triggered when the user clicks "Bulk OTP" for the first time. DMG drops from 272 MB to ~280 MB → ~70 MB after the rest of the app shrinks proportionally.

- Touch: `electron-builder.yml` (drop the chromium extraResource), `scripts/prepare-electron-resources.mjs` (no-op the chromium copy unless `HYDRA_BUNDLE_CHROMIUM=1`), `src/pages/BulkAuthWizard.jsx` (first-run install dialog with progress)
- ETA: ½ day

### P1 — Fast follow-ons

#### 3. CI release pipeline

Single tag → three signed binaries.

- `.github/workflows/release.yml` triggered on `v*` tag push
- Matrix: macos-latest, windows-2022, ubuntu-22.04
- Secrets: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, future `CSC_LINK` (Windows)
- Build with `electron-builder --publish never`, run package smoke, then upload verified artifacts to the release
- ETA: 1 day end-to-end

#### 4. Windows Hello biometric

`electron/app/biometric.js` is currently macOS-only. The `windows-hello` npm package wraps `UserConsentVerifier`. Linux: still skip.

- ETA: ½ day Windows-side; ½ day cross-platform smoke

### P2 — Polish + plumbing

- **Settings → "Check for updates"** action surfacing the auto-updater state
- **macOS dark/light mode** — A4 added a `prefers-color-scheme: light` query but it's not battle-tested end-to-end; full audit + Settings toggle (Auto / Light / Dark) → persist via `nativeTheme.themeSource`
- **Renderer crashes → log file** — replace `console.log` in renderer with a `client-logger.js` IPC pipe so renderer crashes show up in the log file users can email
- **`server/scripts/`, `scratch/`, `videos/`** — likely-trash directories at repo root; needs an audit pass (videos/ is 13 MB; mgmt-keys-page.html already moved; other root-level junk?)
- **`docs/ARCHITECTURE_DEEP_DIVE.md` is 503 lines** — overlaps with PROJECT_STRUCTURE in places. A future consolidation pass could halve it without losing anything; currently held for separate session.
- **`hydra accounts add` / `hydra accounts add --bulk`** — terminal account creation remains the main useful CLI gap. Keep it dry-run/progress-event friendly and reuse the documented Clerk FAPI + Playwright fallback path rather than creating a new auth lane.
- **`mcp-hydra`** — optional wrapper around curated Hydra commands/API-agent routes so Claude Code/Cursor can use fleet management as native tools. Keep this private/local; do not publish Hydra's private API surface.

### P3 — Strategic / moat features

- **Encrypted DB backups + restore UI** — schedule "every N days, write `hydra-backup-YYYY-MM-DD.db.enc` to `~/Documents/Hydra Backups/`" + a Restore button in Settings
- **iCloud / CloudKit sync (macOS)** for power users running fleet across machines
- **Marketing site** at hydra.app — single-page with screenshot + 3 features + auto-link to latest GitHub Release
- **Native onboarding telemetry** — anonymous "users completed step N" funnel (only if user opted into telemetry)

---

## 🧹 Maintenance debt being tracked

| Issue | Where | Severity |
|-------|-------|----------|
| 36 raw `console.log/warn/error` in `electron/app/` | scattered | low; redirected to file logger via setupLogging |

---

## 📚 Reference (do not re-derive when picking up)

- **Bridge contract:** see `CLAUDE.md` § "Renderer ↔ Native Bridge" — adding an IPC requires touching `ipc.js`, `preload.js`, `src/lib/native.js`, plus a CLAUDE.md note if user-visible
- **Result envelope:** `{ok: true, data}` / `{ok: false, error, code?}` everywhere in API + IPC — last outlier (`/api/shutdown`) was fixed 2026-05-06
- **Splash duration constants** must stay in lockstep — `SPLASH_MIN_VISIBLE_MS` in `electron/main.js` paired with `fillbar` keyframe in `electron/app/windows.js`
- **Process model:** Electron main owns Express child via in-process import; loopback-only port; never expose beyond 127.0.0.1
