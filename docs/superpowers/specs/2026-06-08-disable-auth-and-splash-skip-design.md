# Design: Unified disable-auth + splash hold-to-skip (v1.6.0)

Two independent features shipped together as one release.

## Feature 1 — Splash hold-to-skip

**Goal:** let the user skip the ~15s matter.js splash animation with a deliberate, game-style gesture.

**Interaction:**
- A small **"Skip"** affordance is visible on the splash.
- Holding **Spacebar** (or press-and-holding the Skip button) fills a **circular progress ring** over **3 seconds**.
- At full, the splash dismisses early and the main window is revealed.
- Releasing before 3s smoothly resets the ring; the animation continues.

**Architecture:**
- The splash (`electron/app/windows.js → createSplashWindow`) stays `focusable:false` (never steals OS focus on boot). Keyboard is captured via the splash `webContents` `before-input-event` in the main process, so Spacebar works without focus theft.
- Skip visuals (button + SVG ring) live in the inlined splash HTML; hold/release logic runs in the splash document and reports progress; on completion `splashPreload` sends IPC `splash:skip`.
- Main process handles `splash:skip` → tears down the splash (reusing the existing dismissal path) and shows the main window immediately.

**Tests:** `electron/tests/main-process.test.mjs` — assert the splash source wires the Skip button, the 3s hold ring, the spacebar handler, and the `splash:skip` IPC/dismiss path.

## Feature 2 — Unified disable-auth (env var + DB flag + Settings UI)

**Goal:** one feature with two faces — a **deployment** override (headless/always-on servers, e.g. Mothership) and an **interactive** Settings toggle (desktop), both lockout-safe.

**Schema:** add `authDisabled Boolean @default(false)` to `User`. Applied via `prisma db push` + the existing schema-hash self-heal (no hardcoded hash to update; existing DBs heal on boot, default `false`).

**Backend (`server/services/auth.js`):**
- `disableAuth(currentPassword)` — verify current password; on success set `authDisabled=true`, blank `passwordHash` to an unusable sentinel, bump `tokenVersion`. Only allowed when a real password is set (post-signup).
- `enableAuth(newPassword)` — set fresh `passwordHash`, `authDisabled=false`, bump `tokenVersion`. **Re-enable always requires a new password → forgetting the old one can never lock you out.**
- `getSetupStatus()` — include `authDisabled` so the frontend knows to skip the login screen.
- `getBypassUser()` — already present (from the env-var work); reused.

**Middleware (`server/middleware/auth.js`):** `requireUnlocked` falls back to the bypass admin identity when there's no valid session AND (`config.HYDRA_DISABLE_AUTH` (env) OR the persisted `authDisabled` flag (DB)). A valid session always wins. `/v1` proxy auth (master `sk-` key) is unaffected.

**Routes (`server/routes/auth.js`):**
- `POST /api/auth/disable` — body `{ currentPassword }`, requires unlocked.
- `POST /api/auth/enable` — body `{ newPassword }`, available while disabled/unlocked.

**Frontend:**
- `src/api.js` — `disableAuth(currentPassword)`, `enableAuth(newPassword)`.
- `src/App.jsx` — auth gate skips the login screen when `authDisabled`.
- `src/pages/Settings.jsx` — a **"Password protection"** toggle in the security section. OFF asks for the current password (disable); ON asks to create a new password (enable). Clear copy that re-enabling needs a new password.

**Tests:** extend `server/tests/disable-auth.test.mjs` — env bypass (exists), DB-flag bypass, disable-requires-current-pw, enable-requires-new-pw, lockout-safety (no path re-enables with a stale password), `getSetupStatus.authDisabled`.

## Release
- Bump `1.5.15 → 1.6.0`, release notes under `docs/releases/1.6.0.md`, follow the repo's versioning/evidence pattern.
- Pushed together with the already-merged Windows bring-up chain so the Windows device pulls everything in one shot.
