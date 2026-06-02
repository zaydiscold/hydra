# Touch ID Unlock Token Order

## Finding

Touch ID was correctly acting as a gate over Hydra's 24-hour local unlock
token, but the `native:auth-token:get` IPC path prompted Touch ID before it
proved that a usable token existed. That could create a confusing launch:
Touch ID prompt first, then the password screen anyway if the token was
missing, expired, malformed, or later rejected by the local API.

## Evidence

- User report on 2026-06-01: Touch ID completed or appeared, but Hydra still
  asked for the password and prompted every relaunch.
- Local log evidence in `~/Library/Logs/Hydra/main.log` showed repeated
  `Touch ID prompt failed (BIOMETRIC_CANCELLED)` entries during unattended
  LaunchServices package soaks, followed by password fallback.
- Local persisted-token metadata inspection showed the native token file uses
  mode `0600` and a 24-hour expiry window:
  `updatedAt=2026-06-01T08:00:41.726Z`,
  `expiresAt=2026-06-02T08:00:41.726Z`.

## Change

`electron/app/ipc.js` now reads and validates
`renderer-auth-token.json` before calling `promptBiometric('Unlock Hydra')`.
Only a present, non-empty, unexpired token can trigger Touch ID. Expired tokens
are removed without prompting. If Touch ID is enabled and the token is usable,
Hydra still prompts once per relaunch before releasing that token; cancel,
denial, or unavailable hardware still fails closed to password.

The packaged `v1.4.6` launch review found a second ordering issue in the
renderer: `src/App.jsx` awaited that optional native-token release before
rendering the server-known password fallback. A Touch ID prompt left pending
during unattended review therefore made the main window look blank even
though the server was healthy. Bootstrap now renders `/api/auth/status` first,
shows login immediately when the vault exists, then lets Touch ID restore the
saved token in the background. A late biometric result is ignored after a
newer password login, so the convenience path cannot overwrite fresh auth.

The Settings and README copy now say this explicitly:

- Password unlock persists for up to 24 hours on-device.
- Touch ID defaults on once for capable Macs, stays off on unsupported
  platforms, and preserves an explicit Settings opt-out.
- Touch ID only releases a valid saved token.
- A prompt on relaunch is expected while a valid token exists.
- Missing, expired, cancelled, or unavailable token/prompt paths go to password.

## Repro

1. Enable Touch ID in Settings.
2. Log in with the vault password so `native:auth-token:set` writes a fresh
   24-hour token.
3. Relaunch the packaged app through LaunchServices.
4. Expected: Touch ID appears once; approval releases the saved token and skips
   password. Cancelling falls back to password.
5. Remove or expire `renderer-auth-token.json`, then relaunch.
6. Expected: Hydra goes straight to password without showing a pointless Touch
   ID prompt.

## Regression Coverage

- `server/tests/electron-ipc-contract.test.mjs` asserts the token read and
  expiry check occur before biometric prompting.
- `electron/tests/main-process.test.mjs` asserts the main-process source keeps
  that order while preserving fail-closed biometric logging.
- `server/tests/ui-static-contract.test.mjs` asserts renderer bootstrap renders
  server status before waiting on native Touch ID token release and guards
  against late prompt results.
- `bin/commands/audit.js` includes the same order as a release audit contract.

## Exact-Public `v1.4.7` Runtime Recheck

A read-only local metadata pass on 2026-06-01 rechecked the installed public
`v1.4.7` package without printing the saved token:

- `preferences.json` exists with mode `0600` and `biometricEnabled=true`.
- `renderer-auth-token.json` exists with mode `0600`, contains a non-empty
  token, and is not expired.
- The saved token expires at `2026-06-02T08:00:41.726Z`. The read-only snapshot
  recorded `33853` seconds remaining inside the bounded 24-hour window.
- `~/Library/Logs/Hydra/main.log` contains `40` historical biometric gate
  denials from `2026-05-31T10:23:08.963Z` through
  `2026-06-01T10:07:10.265Z`. Every typed outcome is
  `BIOMETRIC_CANCELLED`; there are zero persisted-token read failures, zero
  persisted-token validation failures, and zero failed token-clear records.

This distinguishes the expected fail-closed path from the still-manual
hardware approval path. A prompt on relaunch is correct while the saved token
is valid and Touch ID is enabled. Cancelling the prompt intentionally keeps the
password screen. A completed fingerprint approval followed by a password
screen would still be unexpected and needs an interactive hardware
reproduction before it can be claimed fixed or closed.

## `v1.5.0` Supported-Device Default Follow-Up

A packaged `v1.5.0` LaunchServices review on 2026-06-02 exposed a separate
first-run expectation gap: `preferences.json` already recorded
`biometricEnabled=true`, but `renderer-auth-token.json` was absent, so Hydra
correctly skipped a pointless Touch ID prompt and rendered password fallback.
Source review then found an unfinished migration. `isPrefExplicitlySet()` had
been added for one-time biometric defaulting, but Electron startup still
contained the earlier opt-in-only comment and never invoked a default
initializer.

`electron/app/userPrefs.js` now persists a
`biometricDefaultInitialized` marker and exports
`initializeBiometricDefault(canPrompt)`. `electron/main.js` invokes it once
after app readiness:

- Touch ID-capable Macs default `biometricEnabled=true`.
- Windows, Linux, and Macs without an available Touch ID policy initialize off.
- An existing stored choice wins.
- Changing `biometricEnabled` in Settings persists the initialization marker,
  so an explicit opt-out stays off even though default-equal values are omitted
  from the compact JSON file.
- `native:auth-token:get` still checks for a present, non-empty, unexpired
  24-hour token before prompting, preserving the no-token password fallback.

The password fallback surface was also tightened for the native-prompt handoff:
the lock card now uses a static layered background instead of backdrop blur,
and a concise `DESKTOP UNLOCK` strip explains that Touch ID checks the saved
24-hour unlock first while password remains ready. This keeps the screen behind
the native prompt deliberate without adding another persistent animation.

Regression coverage:

- `server/tests/user-prefs.test.mjs` exercises supported-device default-on,
  unsupported-device default-off, and durable explicit opt-out semantics.
- `electron/tests/main-process.test.mjs` locks the startup initializer and
  fail-closed token gate together.
- `server/tests/ui-static-contract.test.mjs` locks the preference marker,
  initializer, and Settings persistence chain.

## `v1.5.0` Manual Lock Follow-Up

A second packaged review on 2026-06-02 found a separate manual-lock gap:
clicking **Lock** called `api.clearToken()`, which removed both the active
renderer credential and `renderer-auth-token.json`. That left Touch ID with no
device token to release even when the operator had enabled the biometric gate.

Hydra now separates visible-session lock from full device-token revocation:

- `api.lockToken()` clears renderer `localStorage` and the legacy JS cookie,
  then invokes `native:auth-token:lock`.
- `native:auth-token:lock` retains a device token only when it is non-empty,
  unexpired, and protected by `biometricEnabled=true`.
- When Touch ID is off, the token is absent, the token is expired, or lock
  cleanup encounters malformed state, the native handler removes the file.
- The server-issued HttpOnly cookie is still cleared immediately through
  `/api/auth/logout`, so the visible Hydra session locks at once.
- The password screen exposes a deliberate **Unlock with Touch ID** action on
  capable Macs while keeping password unlock available beside it.
- Hydra does not put this JWT into macOS Keychain. The owner-only `0600`
  device-token file and native `promptTouchID()` gate preserve the intended
  convenience path without reintroducing duplicate Keychain permission
  prompts.

Regression coverage:

- `server/tests/electron-ipc-contract.test.mjs` locks the gated retention and
  fail-closed cleanup rules.
- `server/tests/electron-data-path.test.mjs` locks the preload, renderer facade,
  and API bridge.
- `server/tests/ui-static-contract.test.mjs` locks the visible Touch ID button
  and manual-lock call site.
