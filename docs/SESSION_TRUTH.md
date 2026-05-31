# Session Truth And Refresh Memory

## What Hydra Tracks

Hydra deliberately separates login-session truth from management-key storage.
A management key can exist without a usable Clerk login, and a Clerk login can
be active without a management key. UI and CLI surfaces must not conflate them.

Stored login state is encrypted locally:

- `sessionToken`: the current short-lived Clerk session proof token.
- `clientCookie`: legacy scalar compatibility field for the newest device snapshot.
- `clientCookies[]`: newest-first Clerk device identity snapshots used for refresh.
- `sessionExpiry`: stored refresh-window estimate, not a live-health guarantee.
- `lastLoginAt`: when interactive login completed.
- `sessionRefreshedAt`: when Hydra last stored refreshed session material.

UI age labels stay compact so old logins remain readable: minutes become
hours, then days, weeks, months, and years. The renderer does not surface
redundant labels such as `900 hours ago` or `1,000 hours ago`; both collapse to
`5w ago`. Invalid stored timestamps render no age label instead of malformed
copy.

Use `hydra session <account-id> --refresh --json` or the Account Detail
`Check Session` action for current truth. Cached/local metadata is useful for
display, but only a forced Clerk probe confirms that a login still works now.

## Cookie Snapshot Policy

Clerk device identity cookies are the durable refresh material. OpenRouter
dashboard and Cloudflare cookies can change during otherwise equivalent probes.
Hydra keeps genuinely distinct Clerk device identities newest-first, but
replaces snapshots that differ only in transient dashboard material. The stack
remains capped at 25 identities as a final bound.

This preserves fallback across distinct devices without retaining repeated
copies of the same Clerk identity.

## OTP Compatibility

Historical vault rows may use `otp`, `email`, or `email_otp`. Hydra treats all
three as email OTP aliases in server, CLI, and renderer decision paths. New
validated API writes continue using the canonical `otp` value.

Bulk magic-link rows are complete only after `checkSessionLive()` confirms an
active Clerk login. A clicked, expired, or missing pending link is not enough.
Each row handles live-confirmation failures independently so one upstream
failure does not poison the whole batch.

## Sanitized Reproduction

List cached/local fleet state without printing cookies:

```bash
node bin/hydra.mjs accounts --json
node bin/hydra.mjs scan --quick --json
```

Force a live Clerk probe for a selected stored account:

```bash
node bin/hydra.mjs session <account-id-prefix> --refresh --json
```

The JSON response reports status, readiness, cookie-stack count, login/key
presence, and whether the probe was live. It does not print session tokens or
client cookies.

## 2026-05-30 Evidence

A sanitized direct-store audit found four cached-active accounts at the
25-entry cap. Every raw snapshot differed, but each account had exactly one
unique Clerk identity; the churn came from transient dashboard material.

After identity-aware normalization and forced live refresh:

- `4/4` selected stored logins passed live Clerk refresh.
- `4/4` were redeem-ready.
- `1/4` active logins had no management key, proving login truth is independent.
- Cookie-stack counts persisted from `25` to `1` for all four active accounts.

Focused renderer contract verification:

```bash
npm run test:time-utils
npm run test:test-chain-completeness
npm run test:session-refresh-contract
```

The compact-age test covers the `900h` and `1000h` cases, invalid timestamps,
and the normal minute/hour/day/week/month/year boundaries.

Redacted artifacts live under:

```text
/private/tmp/hydra-live-session-probes-20260531T032710Z-post-hardening
```

Do not commit those artifacts. They are local verification evidence.
