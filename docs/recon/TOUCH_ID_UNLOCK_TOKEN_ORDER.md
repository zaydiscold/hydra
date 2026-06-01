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
- Touch ID is opt-in and only releases a valid saved token.
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
