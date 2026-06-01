# Session Refresh Timestamp Semantics

## What Was Found

`updateAccountSession()` intentionally owns two separate historical clocks:

- `lastLoginAt` records a completed interactive login.
- `sessionRefreshedAt` records stored renewed session material.

The helper historically stamped `sessionRefreshedAt` on every call unless the
caller opted out. Several callers only changed metadata: auth-method detection,
OTP setup, second-factor setup, explicit session clearing, derived-expiry
backfill, and a second fresh device-cookie append after an already-recorded
auto-refresh.

Those writes could make the account UI say `last silent renewal just now`
without a completed Clerk renewal.

Two controllers also retained local raw-string dead-cookie filters. Those
filters could preserve a proven-dead Clerk device identity when transient
dashboard or Cloudflare cookie material changed its serialized snapshot.

## How It Was Found

After the exhausted-stack pruning checkpoint, the follow-up sweep used:

```bash
rg -n 'updateAccountSession\(|sessionRefreshedAt|markSessionRefreshed|deadClientCookies' \
  server src docs -g '!docs/hydra-api.openapi.json' -g '!server/tests/**'
sed -n '320,480p' server/controllers/AccountController.js
sed -n '85,125p' server/controllers/DashboardController.js
sed -n '782,798p' server/services/dashboard-api.js
sed -n '145,170p' server/services/session-refresher.js
```

The call-site trace separated successful login or renewal writes from
metadata-only writes.

## What Changed

Metadata-only calls now pass:

```text
markSessionRefreshed: false
```

The guarded paths are:

- explicit refresh-login session clearing, including failed device-cookie stack
  removal
- auth-method detection cookie capture
- password sign-in awaiting second factor
- OTP request cookie capture
- derived JWT-expiry backfill
- auto-refresh follow-up device-cookie append

Completed password login, OTP verification, magic-link verification, forced
live probes, explicit silent renewal, and successful automation renewals still
advance the renewal timestamp.

`AccountController` and `DashboardController` now delegate dead-cookie
filtering to `store.removeDeadClientCookies()`, which compares Clerk device
identities rather than raw serialized cookie snapshots.

## Why It Matters

The UI distinction stays coherent:

- interactive login age answers when the user last completed sign-in
- silent renewal age answers when Hydra last stored renewed Clerk session
  material
- a live probe answers whether Clerk accepts the login now
- a local renewal checkpoint remains an estimate, not total login lifetime

Setup, cleanup, and metadata backfill no longer masquerade as successful
renewal.

Derived JWT-expiry backfill is now an expiry-only encrypted-config write. It
passes `undefined` for the unchanged session and client cookies plus:

```text
preserveSessionToken: true
markSessionRefreshed: false
```

That avoids re-encrypting the unchanged token or refreshing the stored device
cookie capture time merely because Hydra filled in a derived expiry estimate.

When explicit `refresh-login` silent recovery fails, the re-auth reset writes
`replaceClientCookies: []`. The endpoint now clears the failed device-cookie
stack along with the stored JWT instead of leaving later probes to retry stale
identities.

## Raw Evidence

Focused source contracts pass:

```text
npm run test:session-refresh-contract      14/14
npm run test:background-failure-visibility 32/32
npm run test:session-refresher-pruning      1/1
npm run test:openrouter-request-cancellation 5/5
npm run test:test-chain-completeness        2/2
npm run test:cli                           46/46
npm run lint
git diff --check
node bin/hydra.mjs audit --json
```

The audit remains honest at:

```text
31 ok / 5 deferred / 0 missing / 0 blockers
```

## Reproduce

Run:

```bash
npm run test:session-refresh-contract
npm run test:background-failure-visibility
npm run test:session-refresher-pruning
npm run test:openrouter-request-cancellation
npm run test:test-chain-completeness
npm run test:cli
npm run lint
node bin/hydra.mjs audit --json
git diff --check
```

## Release Boundary

This is a `[skip-bump]` source checkpoint after public `v1.4.2`. A
current-source ARM package rebuild, LaunchServices launch proof, and untouched
idle profile remain required before pushing. Manual GUI, live OTP, Touch ID
fingerprint, Intel, and real Windows desktop dogfood boundaries remain
explicit.
