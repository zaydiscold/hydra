# Hydra — 4-Perspective Sweep Report
# Date: 2026-05-06 | Master branch, 30+ commits

> **Status (2026-05-06):** Reviewed and processed.
> Quick-wins shipped: ✅ cheerio removed, ✅ `chrome120` target set,
> ✅ inline gzip on Express, ✅ logger unified to winston, ✅ `playwright`
> moved to `optionalDependencies`, ✅ a11y pass (commit c130199 — aria-current,
> skip-to-content, landmarks, password-reveal tabIndex, nuke keyboard
> handler), ✅ splash hardening (single hex layer, corner-bracket SVG,
> serialized splash→main handoff). UX items #1–#5 (auth-screen first-time
> install copy, nuclear-reset countdown, web-only Lock/Quit, settings
> error toasts) are tracked in the swarm doc and remain follow-on polish
> for the desktop app — none block shipping.

---

## UX/PRODUCT (5 findings)

1. **App.jsx:306** — "First time install?" button sets an error string instead of switching to setup mode. User has to READ the error message to understand what to do. Should auto-detect empty state and show setup form.
2. **App.jsx:320** — Nuclear Reset uses hold-to-activate with a tiny progress bar. No countdown text. Users won't know to hold — they'll click and nothing happens.
3. **App.jsx:458** — Lock Vault + Quit only visible when `window.hydraNative` exists (Electron only). Web users have no way to lock or gracefully quit.
4. **App.jsx:365** — `shutdownConfirm` is a simple boolean toggle. Race condition: rapid double-click could bypass the confirmation before state updates.
5. **Settings.jsx** — No error toasts on API failures. Network errors during settings save are silent — user thinks it worked.

---

## CODE QUALITY (7 findings)

1. **schemaSync.js** (401 lines) — God module. Mixes lock management, content hashing, sentinel tracking, migration execution, backup creation, backup pruning, and self-heal. Should be split into 3-4 focused modules.
2. **schemaSync.js:109,136** — `computeSchemaContentHash()` called TWICE per startup. Once to check if sync needed, once to mark synced. Cache the result.
3. **schemaSync.js** — 10 separate `await import('node:fs')` calls. Import once at module top.
4. **state.js** (102 lines) — Pure getter/setter boilerplate. 20+ exported functions that are just `return _var` / `_var = val`. A single state object + `get(key)` / `set(key, val)` would cut to 30 lines.
5. **env.js:241, schemaSync.js:285,304,310,311,340** — 6x `console.log()` in production electron code. Should use `electron-log` consistently.
6. **main.js** — 7 separate `app.quit()` / `process.exit()` calls scattered across modules. Centralize in shutdown.js.
7. **windows.js** — Splash HTML built via string concatenation (~180 lines of `+` chains). A template literal would be cleaner and less error-prone.

---

## ARCHITECTURE (6 findings)

1. **package.json** — `cheerio` listed as dependency but NEVER imported anywhere. Dead weight (~2MB).
2. **package.json** — `playwright` is a production dependency (~200MB). Should be optional/peer. Most users don't need bulk account generation.
3. **package.json** — Both `electron-log` AND `winston` installed. Two logging frameworks. Pick one.
4. **server/index.js** — No gzip/brotli compression middleware. All assets served uncompressed to Electron renderer. 60-70% wasted bandwidth.
5. **server/index.js** — No SSR. Entire app is client-rendered. First paint = white screen until React hydrates. For a local app this is fine but adds perceived latency.
6. **vite.config.js** — No `build.target` specified. Defaults to broad browser support. Since this is Electron 28 (Chromium 120), targeting `chrome120` would enable modern syntax and reduce bundle ~5-10%.

---

## FRESH EYES (6 findings)

1. **index.css** — Dark-only theme. Light mode CSS was added by A4 agent (`prefers-color-scheme: light` query exists) but verify it actually works end-to-end.
2. **src/pages/** — Pages have loading references (Dashboard:10, AccountDetail:33) but check if they're real spinners or just text.
3. **src/** — No retry logic on API calls. Network hiccup = permanent broken state until manual page refresh.
4. **Settings.jsx** — Version info exists but buried. No dedicated About panel. Users expect Help > About.
5. **Splash** — Shows Intel One Mono font ✅ (matches app). But the falling animation has 14 compositor layers — on integrated GPUs this may cause 5-15% CPU during the 1.5s minimum display.
6. **Auth screen** — Password field has no "show password" button inline (it exists but tabIndex was recently fixed to 0). Verify it's actually keyboard-focusable now.

---

## DEFINITIVE FIXES (prioritized)

### Quick wins (< 30 min each)
- [ ] Remove `cheerio` from dependencies (`npm uninstall cheerio`)
- [ ] Set `build.target: 'chrome120'` in vite.config.js
- [ ] Replace 6x `console.log` with electron-log calls in electron/app/
- [ ] Cache `computeSchemaContentHash()` result (avoid double-call)
- [ ] Consolidate 10x `await import('node:fs')` to single top-level import

### Medium effort (1-2 hours each)
- [ ] Move `playwright` to optionalDependencies
- [ ] Add gzip compression middleware to Express
- [ ] Split schemaSync.js into 3 modules (locks, hashing, migration)
- [ ] Simplify state.js to a single state object
- [ ] Unify logging to one framework

### Larger scope (half day+)
- [ ] Add retry logic to API calls in renderer
- [ ] Add SSR or preload critical HTML
- [ ] Reduce splash compositor layers (fewer animated spans)

---
*Generated by 4-perspective sweep. No changes made.*
