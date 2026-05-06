# Browser Isolation — How Hydra's Playwright Stays Out of Your Real Chrome

> **TL;DR:** Hydra never opens your daily Chrome. It always uses a separate
> Chromium binary (Chrome for Testing in packaged builds, Playwright's own
> Chromium download in dev) with a fresh ephemeral profile dir under
> `/var/folders/.../hydra-pw-profile-XXXXXX`. Your 1,200 tabs are safe.

---

## Why this exists

Hydra automates OpenRouter signup via Playwright when the HTTP path can't
complete it (Clerk CAPTCHA gate). Playwright is normally a developer tool —
it has flags that, if mis-configured, will literally **launch your real
Google Chrome with your real profile**. That would mean:

- Hydra signing in as a sock-puppet on YOUR Chrome with all your cookies
- 1,200 tabs you have open all reflowing because Chrome reloads
- Every Playwright crash takes your real Chrome with it
- Your daily browser becomes Hydra's puppet for the duration

We never want any of that. Three knobs control isolation, and **all three
must be right at once** or your real Chrome leaks in.

| Knob | What it controls | Hydra default |
|---|---|---|
| **Binary** | Which Chrome.app gets launched | Chrome for Testing (packaged) or Playwright's `~/.cache/ms-playwright/chromium-*` (dev) — never your real `/Applications/Google Chrome.app` |
| **Profile** (`userDataDir`) | Cookies, history, signed-in sessions | Fresh `mkdtemp` under `/var/folders/.../hydra-pw-profile-XXXXXX` per launch — never `~/Library/Application Support/Google/Chrome` |
| **Flags** | Default-browser prompt, sync, telemetry | `--no-default-browser-check --no-first-run --disable-sync --disable-background-networking --use-mock-keychain` etc. |

---

## Architecture

```
                          ┌─────────────────────────────────┐
                          │  Hydra Electron app (your UI)   │
                          └──────────────┬──────────────────┘
                                         │ in-process Express + Prisma
                                         │
                  ┌──────────────────────▼─────────────────────┐
                  │  server/services/account-generator.js      │
                  │  server/services/dashboard-api.js          │
                  │  ─ HTTP signup flow first (no browser)     │
                  │  ─ Falls back to Playwright on CAPTCHA     │
                  └──────────────────────┬─────────────────────┘
                                         │
                                         │ chromium.launch(opts)
                                         │
                  ┌──────────────────────▼─────────────────────┐
                  │  server/lib/playwright-browser.js          │
                  │  resolveChromiumLaunchOptions()            │
                  │                                            │
                  │  1. HYDRA_PLAYWRIGHT_EXECUTABLE_PATH       │  opt-in
                  │  2. HYDRA_PLAYWRIGHT_CHANNEL=chrome ⚠      │  opt-in (DANGEROUS)
                  │  3. Packaged → bundled Chrome for Testing  │  default in .app
                  │  4. Dev → Playwright's own Chromium         │  default in dev
                  │                                            │
                  │  Always applied:                           │
                  │  ─ ISOLATION_ARGS (no first-run, no sync,  │
                  │    no default-browser check, etc.)         │
                  │  ─ ephemeral userDataDir (mkdtemp)         │
                  └──────────────────────┬─────────────────────┘
                                         │
                                         │ launches an isolated subprocess
                                         │
            ┌────────────────────────────▼────────────────────────────┐
            │  Chrome for Testing  (NOT your real Chrome)             │
            │  --user-data-dir=/var/folders/.../hydra-pw-profile-XXXX │
            │  --no-default-browser-check --no-first-run ...          │
            │                                                         │
            │  reaches openrouter.ai/sign-up, fills email, etc.       │
            └─────────────────────────────────────────────────────────┘

                            (your 1,200 tabs are over here, untouched)
                            ┌─────────────────────────────────────────┐
                            │  /Applications/Google Chrome.app        │
                            │  ~/Library/Application Support/         │
                            │     Google/Chrome (your real profile)   │
                            └─────────────────────────────────────────┘
```

---

## How each knob is set

### 1. Binary

`server/lib/playwright-browser.js` chooses in this order:

```
HYDRA_PLAYWRIGHT_EXECUTABLE_PATH (env)   → opt-in, never set by default
HYDRA_PLAYWRIGHT_CHANNEL         (env)   → opt-in, never set by default
process.env.HYDRA_EMBEDDED === '1'       → packaged: scan resourcesPath/chromium/...
fallthrough                              → dev: Playwright's bundled Chromium
```

The packaged scan looks for **Chrome for Testing**, not your installed Chrome:

```js
join(resourcesPath, 'chromium', 'chrome-mac-arm64',
     'Google Chrome for Testing.app', 'Contents', 'MacOS',
     'Google Chrome for Testing')
```

`scripts/prepare-electron-resources.mjs` populates `build/electron/chromium/`
with **only the matching-platform-arch Chrome for Testing** before each
electron-builder run. Your `/Applications/Google Chrome.app` is never copied
or referenced.

### 2. Profile dir

Every call to `chromium.launch(resolveChromiumLaunchOptions(...))` ends in
`finalizeOptions()`, which always sets:

```js
opts.userDataDir = mkdtempSync(join(tmpdir(), 'hydra-pw-profile-'))
```

So every launch gets a fresh empty dir like
`/var/folders/jp/.../hydra-pw-profile-aB7xQz/`. No cookies survive across
launches; no real-Chrome cookies leak in.

The prefix `hydra-pw-profile-` makes leftover dirs trivial to find:

```bash
find $TMPDIR -name 'hydra-pw-profile-*' -mtime +1
```

### 3. Flags

`ISOLATION_ARGS` is prepended to every launch's `args[]`:

```js
'--no-default-browser-check'
'--no-first-run'
'--disable-default-apps'
'--disable-background-networking'
'--disable-sync'
'--disable-features=Translate,CalculateNativeWinOcclusion,MediaRouter'
'--metrics-recording-only'
'--use-mock-keychain'
```

Most important ones:

- `--no-default-browser-check` — without this, the Testing-channel Chrome
  may attempt to register itself as your default browser handler.
- `--use-mock-keychain` — without this, Chrome reaches into the user's
  macOS Keychain to read saved passwords. With it, the keychain is faked.
- `--disable-sync` — without this, if any Google account state survived
  the ephemeral profile, sync would try to phone home.

---

## What COULD still leak — and what to do

### Risk: someone sets `HYDRA_PLAYWRIGHT_CHANNEL=chrome`

This is the explicit opt-in to use your real Chrome. The resolver respects
it (priority 2), so if anyone exports that env var, isolation is OFF.

**Mitigation:** never set this in dev or prod. If you genuinely need a
Chrome with extensions for some weird automation, set
`HYDRA_PLAYWRIGHT_EXECUTABLE_PATH` instead and point at a *separate* Chrome
install — never the one you use daily.

**Verify:** `env | grep HYDRA_PLAYWRIGHT` — output should be empty.

### Risk: someone passes `userDataDir: '<your real Chrome profile>'` from a caller

Currently no caller does this. To prevent regression, a future test should
assert that no `userDataDir` argument ever points at known real-Chrome dirs.

### Risk: a leftover `hydra-pw-profile-*` dir contains stale OpenRouter cookies

Cosmetic — those dirs use ephemeral random names so a stale one doesn't
collide with a future launch. macOS sweeps `/var/folders/...` on reboot
and on quarterly cleanup. A `find $TMPDIR -name 'hydra-pw-profile-*' -mtime +1 -exec rm -rf {} +`
cron is overkill for a single-user desktop tool but available if you want it.

---

## Verifying isolation right now

Run while a Hydra Playwright task is in flight:

```bash
# 1. Confirm the launched binary is Chrome for Testing, NOT real Chrome
ps -ax -o command= | grep -i chrome | head -5
# Expect to see paths like:
#   .../Hydra.app/Contents/Resources/app/chromium/chrome-mac-arm64/...
#   .../node_modules/playwright/.local-browsers/chromium-XXXX/...
# Should NOT see:
#   /Applications/Google Chrome.app/...

# 2. Confirm the profile is ephemeral
ps -ax -o command= | grep 'user-data-dir=' | head -5
# Expect: --user-data-dir=/var/folders/.../hydra-pw-profile-XXXXXX
# Should NOT see: --user-data-dir=$HOME/Library/Application Support/Google/Chrome

# 3. Confirm isolation args are present
ps -ax -o command= | grep -E 'no-default-browser-check.*no-first-run|disable-sync' | head -3
```

If any of those checks fail, isolation is broken — file an issue, don't
ship.

---

## When this doc lies

If you change `playwright-browser.js`, update this doc. If you add a new
caller of `chromium.launch()` that bypasses `resolveChromiumLaunchOptions`,
that caller is responsible for its own isolation — and it should be
caught by the contract test in `server/tests/playwright-isolation.test.mjs`
(if/when that test exists).

---

## Sessions: what survives a Hydra restart, what doesn't

**Browser isolation ≠ session loss.** This is the most important
point in this doc. When we say the Playwright browser uses an
ephemeral `userDataDir`, we mean the *browser fingerprint*
(installed extensions, autofill, cached fonts, persisted device-id)
is fresh per launch. The actual **OpenRouter login state** is stored
elsewhere and re-injected when needed.

Three session types live in three different places:

### Type 1 — OpenRouter Clerk session (per account)

**Where it lives:** Prisma `Account.sessionToken` + `Account.config`
(both encrypted AES-256-GCM with `LOCAL_STORAGE_KEY` from
`local-secrets.json`). One row per OpenRouter account Hydra manages.

**Survives:** forever, until Clerk says the session expired (~7d typically).

**Restored into Playwright like this:**

```js
// server/services/dashboard-api.js
context = await browser.newContext({ userAgent: USER_AGENT });
await context.addCookies(
  await playwrightCookiesForOpenRouter(sessionCookie, clientCookie)
);
// ↑ stored cookies from Prisma are INJECTED into the isolated context.
//   The Playwright browser now appears logged-in as that OpenRouter
//   account, even though its userDataDir is brand new and empty.
```

**Refreshed back into Prisma like this:**

```js
// server/services/session-refresher.js
await updateAccountSession(userId, id, sessionCookie, clientCookie,
                           sessionExpiry, { ... });
// ↑ after a successful action, the refreshed __client cookie is
//   written back so the next launch picks up the new state.
```

Why this design wins: the browser identity is fresh (no cross-task
fingerprint accumulation that Clerk could fraud-flag), but the
account login is preserved. Best of both worlds.

### Type 2 — Hydra master unlock JWT (per Hydra-user)

**Where it lives:** the renderer's `localStorage.hydra_token`. Issued
by the server when you POST `/api/auth/login` with your password,
signed with the per-install `JWT_SECRET` from `userData/jwt-secret`.

**TTL:** 30 days by default (`HYDRA_MASTER_JWT_TTL: '30d'` in
`server/config.js`). Survives Hydra restarts as long as the JWT is
within its `exp`.

**Survives a quit?** Yes — `localStorage` is per-userData-dir, and
Hydra's userData is `~/Library/Application Support/Hydra/` which
persists. No retyping `1111` for 30 days.

**Browser isolation does NOT touch this.** The unlock JWT lives in
the *renderer's* localStorage, not the Playwright browser. The
Playwright work happens server-side and never sees this token.

### Type 3 — Playwright browser cookies (per signup task)

**Where it lives:** the ephemeral `userDataDir` we just created
(`/var/folders/.../hydra-pw-profile-XXXX/`). Browser-only state:
DOM cookies, localStorage of openrouter.ai, IndexedDB.

**Survives:** intentionally NO. The dir gets `rm -rf`'d when the
task ends (or by the orphan sweep on the next Hydra launch). This
is correct: each signup is a *fresh account*, so we want a fresh
browser. Reusing fingerprints would trip Clerk's fraud heuristics.

**Important nuance:** the *result* of the signup (the `__client`
cookie + Clerk JWT) is extracted by code BEFORE the browser dies
and persisted to Type 1 storage (Prisma). The browser is the
acquisition channel, not the storage layer.

---

## Quick summary table

| Session | Storage | Persists across launches? | Affected by Playwright isolation? |
|---|---|---|---|
| OpenRouter Clerk (per account) | Prisma encrypted blobs | ✅ yes (until Clerk expiry) | ❌ no — Prisma is the canonical store, browser is just the working surface |
| Hydra unlock JWT (per Hydra-user) | Renderer localStorage | ✅ yes (30-day TTL) | ❌ no — renderer-side, never touches Playwright |
| Playwright browser fingerprint | Ephemeral userDataDir | ❌ no (intentionally) | ✅ yes — this is exactly what isolation discards |

If you ever change anything in `server/lib/playwright-browser.js`,
re-read this section. The "ephemeral profile" decision is correct
*because* of where sessions actually live — break that assumption
and you'll either leak fingerprints between accounts (bad) or
discard real session state (worse).
