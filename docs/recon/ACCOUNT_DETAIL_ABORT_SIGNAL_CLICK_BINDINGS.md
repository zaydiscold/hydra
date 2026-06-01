# Account Detail AbortSignal Click Bindings

Last updated: 2026-06-01

## What Was Found

The packaged Account Detail screen displayed a cached-session warning after a
user clicked the read-only live-session probe, even though Clerk and the local
API were healthy. The same event-binding defect affected the Account Detail
snapshot refresh and management-key refresh controls.

The renderer callbacks accept an optional `AbortSignal` for lifecycle
cancellation:

```js
probeSession(signal = accountAbortRef.current?.signal)
fetchSnapshot(signal = accountAbortRef.current?.signal)
fetchManagementKeys(signal = accountAbortRef.current?.signal)
```

Passing one of those callbacks directly to React as `onClick={probeSession}`
caused React to pass its click `SyntheticEvent` as the first argument. The
renderer then forwarded that event to `fetch(..., { signal })`, where an
`AbortSignal` was required.

## How It Was Found

The defect was reproduced in the packaged macOS Electron app with Computer Use:

1. Launch the packaged app through LaunchServices.
2. Open an account from Dashboard.
3. Click the read-only session probe on Account Detail.
4. Observe the cached-session warning.

The upstream path was then isolated without exposing secrets:

```bash
node bin/hydra.mjs session <redacted-account-id> --refresh --json
```

The CLI refreshed the same stored account successfully. A direct local request
to the embedded Electron server also returned HTTP `200` with a live active
session:

```text
POST /api/accounts/<redacted-account-id>/session-check
status=200
session.live=true
session.active=true
```

That separated Clerk and server health from the renderer click pathway. A
source sweep found ten direct Account Detail bindings across the three callback
families.

## Repair

Each click handler now invokes its callback explicitly without forwarding the
React event:

```jsx
onClick={() => void probeSession()}
onClick={() => void fetchSnapshot()}
onClick={() => void fetchManagementKeys()}
```

`server/tests/ui-static-contract.test.mjs` rejects direct bindings for those
callbacks and locks the expected wrapped call-site counts.

## Why It Matters

The bug made a healthy live session look uncertain and could make snapshot or
management-key refreshes appear broken. The repair restores the read-only
account maintenance controls without weakening cancellation during unmount.

## Reproducibility

Run the renderer contract and cancellation checks:

```bash
npm run test:ui-static
npm run test:openrouter-request-cancellation
npm run test:session-refresh-contract
npm run lint
npm run build
git diff --check
```

Then repeat the packaged Account Detail session probe through the Electron app.
