# Electron Migration Sprint — 2026-04-27 Archive

Consolidated artifacts from the Electron migration sprint. Originally lived at the project root in `4 - 27/`. Moved here on 2026-05-05 after the Electron app was successfully built and packaged (DMGs in `release/`).

## What's in here

| File | Purpose |
|------|---------|
| `SESSION_NOTES_2026-04-27_FULL.md` | Single canonical session log for the day |
| `SESSION_2026-04-27_electron_migration.md` | Migration kickoff notes (planning + TODO markers) |
| `SESSION_2026-04-27_sitrep_and_captcha_audit.md` | Read-only audit of HTTP signup + Playwright fallback |
| `SKEPTIC_AUDIT.md` | 25-issue bug hunt against the Electron shell. **Status: 🔴 #1–5, #10, #16 fixed; 🟠 #6–9, #12–13 fixed; 🟡 #14, #17–18, #20 fixed; 🔵 #19, #21–22, #25 fixed.** Remaining items are minor (#11 superseded by `standalone.js` `.catch` guard, #15 `unref()` is intentional, #23–24 are non-issues). See git log on `feat/electron-migration` for fix commits. |
| `LINT_AUDIT.md` | Snapshot of lint coverage gaps. ESLint runs clean on configured globs. |
| `FLEET_AUDIT_SOURCE_OF_TRUTH.md` | Spot-check verification log for every migration claim |

## Active artifacts that escaped this folder

- `scripts/integration-gate.mjs` — runnable Phase-1/2/3 validation gate. Run via `npm run gate` or `node scripts/integration-gate.mjs`.
- `release/Hydra-1.0.0-arm64.dmg`, `release/Hydra-1.0.0.dmg` — packaged installers.
- `Hydra.app` (project root) — symlink to the unpacked Apple Silicon `.app` for click-to-launch.

## Why this archive exists

These notes are historical context for "how Hydra became an Electron app." If you're trying to understand why a particular `// ─── ELECTRON_MIGRATION ───` marker is in `server/`, this folder explains the design intent. For the current architecture, see `docs/ELECTRON_MASTER_PLAN.md` and `docs/ELECTRON_TROUBLESHOOTING.md`.
