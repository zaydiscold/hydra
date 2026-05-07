# Hydra — Running Plan & Ideas

> **What this is:** the single canonical "what's not done yet" file. Combines
> the previous `ROADMAP_NEXT.md` plus actionable items extracted from the
> 2026-04-27 sprint archive and historical plan docs that haven't shipped.
>
> **What this isn't:** a place for pure history. Items move OUT once they
> ship. Items move IN when they're tracked but not yet built. Pure historical
> plans live in `docs/_archive/`.
>
> **Last update:** 2026-05-06 — post end-to-end wiring + bug pass.

---

## ✅ Recently shipped (2026-05-06)

| What | Where |
|------|-------|
| Splash min-visible 6.8 s → 7 s | `electron/main.js` `SPLASH_MIN_VISIBLE_MS`, `electron/app/windows.js` `fillbar` keyframe |
| Renderer Result-type wrapper | `src/lib/native.js` |
| Startup error dialog (Open Logs / Copy Details / Quit) | `electron/app/startupError.js` |
| Help menu polish (Diagnostics, Logs, Build Info) | `electron/menus/appMenu.js` |
| macOS code-sign + notarize afterSign hook | `electron/builders/notarize.cjs`, `docs/PACKAGING.md` |
| Opt-in Sentry crash telemetry | `electron/app/telemetry.js`, `electron/app/userPrefs.js`, Settings UI |
| Touch ID biometric unlock — opt-in from Settings; no first-launch auto-prompt | `electron/app/biometric.js`, Settings UI |
| Bug fixes — broken hide/quit IPC, shutdown race, hardcoded :3001 fallback, magic-link XSS, response envelope, prefs cache invalidation, onNavigate listener leak, biometric error code distinction, unused `uuid` dep | scattered |

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

#### 1. First-launch onboarding wizard (#7)

The first-time user today sees the login screen with `"Invalid credentials"` because there's no password yet. Replace with a 3-step guided modal: set password → (optional) paste first management key → quick tour → Dashboard.

- Schema: `User.onboardedAt DateTime?` + `prisma/migrations/<ts>_onboarding/`
- Server: `POST /api/auth/setup` in `server/routes/auth.js`, response on `GET /api/auth/status` extends with `onboarded: boolean`
- Renderer: `src/components/Onboarding/{Welcome,KeyStep,Tour,Onboarding}.jsx`, gate in `src/App.jsx` before `'login'` state
- Visual style: Intel One Mono, neo-cyberpunk gradient panels (match splash)
- ETA: 1.5 days (UI is the bulk; backend ~50 lines)

#### 2. Auto-update via `electron-updater`

Without this every fix dies on the user's hard drive.

- Add `electron-updater` to deps; init in `electron/main.js` after window shown
- GitHub Releases as feed (free, signed)
- "Restart to update" toast when an update is staged
- Gate behind `app.isPackaged` so dev builds don't hit Releases
- ETA: 1 afternoon

#### 3. Drop bundled Chromium → lazy-download on first bulk-auth use

Chromium is **~330 MB / 54 % of the DMG**. Bulk-auth wizard is the only path that needs it. Move from `extraResources` to a one-time `playwright install chromium` triggered when the user clicks "Bulk OTP" for the first time. DMG drops from 272 MB to ~280 MB → ~70 MB after the rest of the app shrinks proportionally.

- Touch: `electron-builder.yml` (drop the chromium extraResource), `scripts/prepare-electron-resources.mjs` (no-op the chromium copy unless `HYDRA_BUNDLE_CHROMIUM=1`), `src/pages/BulkAuthWizard.jsx` (first-run install dialog with progress)
- ETA: ½ day

### P1 — Fast follow-ons

#### 4. CI release pipeline

Single tag → three signed binaries.

- `.github/workflows/release.yml` triggered on `v*` tag push
- Matrix: macos-latest, windows-2022, ubuntu-22.04
- Secrets: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, future `CSC_LINK` (Windows)
- `electron-builder --publish always` to upload artifacts to the release
- ETA: 1 day end-to-end

#### 5. Windows Hello biometric

`electron/app/biometric.js` is currently macOS-only. The `windows-hello` npm package wraps `UserConsentVerifier`. Linux: still skip.

- ETA: ½ day Windows-side; ½ day cross-platform smoke

#### 6. Playwright elimination — Phases 1 & 3 (from SITREP 2026-04-24)

- **Phase 1:** code-redemption Playwright fallback → switch to direct tRPC HTTP. `server/services/dashboard-api.js` redemption path; `server/controllers/CodeController.js` callsites.
- **Phase 3:** management-key provisioning Playwright fallback → already has tRPC HTTP primary; remove the headless browser fallback once tRPC is reliable for 100 % of accounts.
- Result: Playwright becomes a true optionalDep that only the bulk-auth wizard touches → unlocks #3 (drop Chromium).
- ETA: 1 day Phase 1, ½ day Phase 3

### P2 — Polish + plumbing

- **Settings → "Check for updates"** action surfacing the auto-updater state
- **macOS dark/light mode** — A4 added a `prefers-color-scheme: light` query but it's not battle-tested end-to-end; full audit + Settings toggle (Auto / Light / Dark) → persist via `nativeTheme.themeSource`
- **Window title per-route** — `mainWindow.setTitle('Hydra — Pool Manager')` etc.
- **Tray menu live-updates** when proxy state changes (`tray._hydraRebuildMenu` exists but is only called once at boot)
- **`firstLaunchSetup` error dialog** — currently still uses bare `dialog.showErrorBox`; upgrade to the `showStartupErrorDialog` helper used elsewhere
- **Renderer crashes → log file** — replace `console.log` in renderer with a `client-logger.js` IPC pipe so renderer crashes show up in the log file users can email
- **`server/scripts/`, `scratch/`, `videos/`** — likely-trash directories at repo root; needs an audit pass (videos/ is 13 MB; mgmt-keys-page.html already moved; other root-level junk?)
- **`docs/ARCHITECTURE_DEEP_DIVE.md` is 503 lines** — overlaps with PROJECT_STRUCTURE in places. A future consolidation pass could halve it without losing anything; currently held for separate session.

### P3 — Strategic / moat features

- **Encrypted DB backups + restore UI** — schedule "every N days, write `hydra-backup-YYYY-MM-DD.db.enc` to `~/Documents/Hydra Backups/`" + a Restore button in Settings
- **iCloud / CloudKit sync (macOS)** for power users running fleet across machines
- **Marketing site** at hydra.app — single-page with screenshot + 3 features + auto-link to latest GitHub Release
- **Native onboarding telemetry** — anonymous "users completed step N" funnel (only if user opted into telemetry)

---

## 🧹 Maintenance debt being tracked

| Issue | Where | Severity |
|-------|-------|----------|
| 21 npm-audit vulnerabilities (Sentry transitive deps) | `npm audit` | low; mostly dev tooling |
| 36 raw `console.log/warn/error` in `electron/app/` | scattered | low; redirected to file logger via setupLogging |
| `docs/2026-04-27/` — historical sprint archive | now in `docs/_archive/2026-04-27/` | none; just out of the way |

---

## 📚 Reference (do not re-derive when picking up)

- **Bridge contract:** see `CLAUDE.md` § "Renderer ↔ Native Bridge" — adding an IPC requires touching `ipc.js`, `preload.js`, `src/lib/native.js`, plus a CLAUDE.md note if user-visible
- **Result envelope:** `{ok: true, data}` / `{ok: false, error, code?}` everywhere in API + IPC — last outlier (`/api/shutdown`) was fixed 2026-05-06
- **Splash duration constants** must stay in lockstep — `SPLASH_MIN_VISIBLE_MS` in `electron/main.js` paired with `fillbar` keyframe in `electron/app/windows.js`
- **Process model:** Electron main owns Express child via in-process import; loopback-only port; never expose beyond 127.0.0.1
