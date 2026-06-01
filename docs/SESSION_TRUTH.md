# Session Truth And Refresh Memory

## What Hydra Tracks

Hydra deliberately separates login-session truth from management-key storage.
A management key can exist without a usable Clerk login, and a Clerk login can
be active without a management key. UI and CLI surfaces must not conflate them.

Stored login state is encrypted locally:

- `sessionToken`: the current short-lived Clerk session proof token.
- `clientCookie`: legacy scalar compatibility field for the newest device snapshot.
- `clientCookies[]`: newest-first Clerk device identity snapshots used for refresh.
- `sessionExpiry`: next local renewal checkpoint, not the total login lifetime
  and not a live-health guarantee.
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
Forced probes return `observedAt` so CLI and renderer surfaces can distinguish
the time of the live Clerk check from historical `lastLoginAt`. Compact fleet
labels say `login 5w ago` rather than showing an unlabeled age. A login that
started 1,000 hours ago is not dropped solely because it is old: Hydra keeps
the useful historical age, but action gates require current live-probe truth.

When a forced Clerk probe renews stored material, Hydra waits for that local
write and reloads the account row before returning the response. The detail and
Vault surfaces merge the returned `sessionExpiry` and `sessionRefreshedAt`
immediately. This prevents a successful live result from rendering beside a
stale pre-probe checkpoint.

The detail copy intentionally separates four clocks:

- `Live Clerk check`: whether the login works now.
- `Interactive sign-in`: when the operator last completed a login flow.
- `Last silent renewal`: when Hydra last stored renewed session material.
- `Next local renewal checkpoint`: Hydra's next estimated maintenance boundary.

A login can be seven weeks old, renew silently today, and remain active. The
checkpoint must never be presented as the login's total remaining lifetime.

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

## 2026-05-31 Exact-Public v1.1.5 Recheck

A fresh sequential `hydra session <id> --refresh --json` sweep exercised the
same production `store.probeSessionLive()` path used by Account Detail. The
redacted local artifact lives at:

```text
/private/tmp/hydra-live-session-recheck-20260531T134828Z/redacted-summary.json
```

The artifact is owner-only (`0600`) and contains no account IDs, aliases,
emails, cookies, session tokens, or management keys. Results:

- `12` stored rows checked.
- `4` logins confirmed active by live Clerk refresh.
- `0` expired and `0` errored live probes.
- `8` rows had no active stored login and remained explicit re-auth candidates.
- All `4` live logins were redeem-ready.
- One live login had no management key, reconfirming that login truth and
  management-key truth are intentionally independent.
- Each active row persisted a one-entry Clerk identity stack, a just-now silent
  renewal timestamp, and a `7.0d` next local renewal checkpoint.

A temporary packaged-only CDP pass then opened a redacted Account Detail route
and clicked the read-only `Re-probe session status from Clerk` action. The exact
public `v1.1.5` renderer displayed:

```text
LIVE CLERK CHECK JUST NOW
Login works now
Next local renewal checkpoint: 7.0d
Interactive sign-in 7w ago · last silent renewal just now
The checkpoint is Hydra's next stored renewal estimate, not the login's total lifetime. The live Clerk check is current truth.
```

The temporary debug session closed, port `9333` closed, and a normal no-debug
LaunchServices relaunch settled to four owned processes, `0.0%` sampled CPU,
and zero stale Hydra Playwright profiles. Raw redacted packaged evidence lives
under:

```text
/private/tmp/hydra-v115-public-session-ui-20260531T134932Z
```

## 2026-05-31 Exact-Public v1.4.0 Recheck

A post-release sequential sweep repeated the production
`hydra session <id> --refresh --json` probe path against all stored rows. The
owner-only (`0600`) redacted summary lives at:

```text
/private/tmp/hydra-live-session-recheck-v140-20260531T212329Z/redacted-summary.json
```

The summary contains no account IDs, aliases, emails, cookies, session tokens,
or management keys. Results:

- `12/12` stored rows completed a live Clerk probe.
- `4` logins were active and redeem-ready.
- `8` rows had no active stored login and remained explicit OTP re-auth
  candidates.
- `0` probes failed and `0` rows reported decrypt failures.
- One active login intentionally had no management key.
- Every active row retained a one-entry Clerk identity stack, a just-now
  silent renewal timestamp, and a `7.0d` next local renewal checkpoint.

## 2026-06-01 Dead Cookie Pruning

The six-hour auto-refresher now persists exhausted Clerk device-cookie stacks
as empty after proving that every stored identity is dead. The metadata-only
write preserves the existing session token and intentionally leaves
`sessionRefreshedAt` unchanged: pruning failed refresh material is not a silent
renewal.

Forced live probes and automation session refreshes also remove dead identities
after an older stacked cookie succeeds. Identity-aware comparison treats
snapshots that differ only in transient dashboard or Cloudflare material as
the same Clerk device identity.

The deterministic lifecycle test starts with `25` dead cookie identities:

```bash
npm run test:session-refresher-pruning
```

The first sweep attempts all `25`, stores an empty stack without stamping a
false renewal, and records `SESSION_REFRESH_FAILED`. The second sweep attempts
`0`, proving known-dead identities do not consume Clerk requests every six
hours forever. The recon note is
`docs/recon/SESSION_REFRESH_DEAD_COOKIE_PRUNING.md`.

The current-source ARM package proof passed smoke, strict deep `codesign`,
embedded-source inspection, LaunchServices launch, and an untouched five-minute
profile. Across 11 samples the package retained four Hydra-owned processes,
zero Hydra Playwright profiles, `0.055%` average CPU, `0.000%` end CPU, and
`+5144576` bytes RSS drift. Evidence is stored under
`/private/tmp/hydra-v142-session-pruning-current-source-launch-20260601T.ykgIT2`
and
`/private/tmp/hydra-v142-session-pruning-post-rebuild-idle-20260601T.2OCWjF`.

## 2026-06-01 Timestamp Semantics

`sessionRefreshedAt` records a completed stored renewal, not any write to the
encrypted account session document. Metadata-only writes now explicitly leave
it unchanged:

- auth-method detection cookie capture
- OTP request cookie capture
- password sign-in awaiting second factor
- explicit session clearing before fresh re-auth, including failed
  device-cookie stack removal
- derived JWT-expiry backfill, narrowed to an expiry-only metadata write
- auto-refresh follow-up device-cookie append

Completed password login, OTP verification, magic-link verification, forced
live probes, explicit silent renewal, and successful automation renewals still
advance the clock. `AccountController` and `DashboardController` also use the
shared Clerk-identity pruning helper, so transient dashboard or Cloudflare
cookie churn cannot preserve a dead Clerk device identity. The recon note is
`docs/recon/SESSION_REFRESH_TIMESTAMP_SEMANTICS.md`.
