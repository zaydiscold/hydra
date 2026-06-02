# Bulk Auth Import Redirect and Dedupe

Date: 2026-06-01

## What Was Found

Bulk Email Link import had two independent failure modes:

- Hydra sent one `/accounts/bulk-otp-stubs` request and then one high-cost `/magic-link/send` request per row. A 13-row batch could hit Hydra's own `12/min` high-cost limiter before upstream Clerk was even considered.
- Clerk rejected the magic-link `redirect_url` because Hydra generated a localhost callback while the Clerk FAPI request origin/referer is OpenRouter. Clerk requires email-link redirects to belong to the instance domain, an allowed redirect URL, or the same origin as the requesting page.
- The callback URL sent to Clerk contained `signInId=pending`. Hydra only built the real callback after Clerk had already sent the email, so even an allowlisted relay would receive an unusable placeholder link.
- Clerk's same-device/browser protection may also reject an Email Link flow initiated with Hydra's server-side Clerk device cookie and opened in a normal mail browser. That switch belongs to the Clerk tenant owner, not Hydra.

## Why It Matters

The broken flow created hidden damage:

- Valid rows could be marked failed because Hydra self-rate-limited a local queue.
- The UI kept firing after the first redirect-domain failure, causing upstream Clerk throttling.
- Duplicate email rows were silently collapsed, so the operator could not tell which rows were skipped or reused.
- A generic public tunnel would expose local Hydra surface area without satisfying OpenRouter Clerk's tenant-owned redirect allowlist.

## How It Was Fixed

- `/api/accounts/bulk-otp-stubs` no longer uses the high-cost limiter; it is a local encrypted-vault write and does not send Clerk email.
- `/api/accounts/magic-link/capability` exposes whether Email Link can run before any account row is created or replaced.
- The Email Link tab now runs that capability preflight before any queue write. If the callback is missing, unconfirmed, or local-only, the UI shows the callback state at the top of the tab, disables "Send Magic Links", leaves the paste input intact, and does not contact Clerk.
- The Email Link tab keeps a "Recheck" action for compatible Clerk tenants, but OpenRouter users are directed to the supported OTP HTTPS lane instead of a tunnel setup dead end.
- OTP strategy-error hints no longer recommend Email Link generically. They
  tell the operator to check the account sign-in method and use Email Link
  only when its capability banner says ready.
- Bulk Email Link sends are paced one at a time with a `6500ms` gap.
- Email Link sending fails closed before contacting Clerk unless `HYDRA_MAGIC_LINK_CALLBACK_ORIGIN` is public HTTPS and `HYDRA_MAGIC_LINK_CALLBACK_ALLOWLIST_CONFIRMED=1` explicitly records that the Clerk tenant owner allowlisted the relay.
- The email callback now carries a random 24-byte base64url `linkId`. Hydra keeps Clerk attempt and account identifiers server-side, indexes the pending attempt by both `signInId` and `linkId`, atomically claims the public callback before Clerk completion, and removes both indexes together on completion, failure, or expiry.
- Bulk import has a shared "Force replace matching saved emails" toggle. Without it, existing emails are reported as duplicate skips and stay in the paste box. With it, the existing row is converted back into a pending OTP stub while management-key records are preserved.
- The paste box clears only successfully used first occurrences. Repeated pasted emails and failed/skipped rows remain for retry.

## Evidence

Source contracts:

- `server/controllers/AccountController.js`: callback preflight, explicit tenant-owner confirmation, opaque callback token, capability endpoint, include-pending duplicate lookup, and force-replace path.
- `server/services/magic-link-manager.js`: paired renderer-poll and public-callback indexes with shared cleanup.
- `server/routes/auth.js`: opaque `linkId` callback lookup; no account ID or Clerk attempt ID in the emailed callback URL.
- `server/routes/accounts.js`: bulk OTP stubs are no longer high-cost limited.
- `server/services/store.js`: `replaceAccountWithOtpStub()` clears stale session material, invalidates session-status cache, and preserves the account row.
- `src/hooks/useBulkAuth.js`: capability-gated Email Link queue, live callback-status state, paced sends, and paste cleanup.
- `src/components/EmailLinkTab.jsx`: pre-send callback banner, Recheck action, disabled send button when Email Link cannot work, and Force Replace control.
- `src/utils/auth.js`: duplicate-preserving email parsing and cleanup helpers.

Regression coverage:

- `server/tests/background-failure-visibility.test.mjs`
- `server/tests/ui-static-contract.test.mjs`
- `server/tests/electron-api-integration.test.mjs`

## Repro Notes

Use OTP for OpenRouter bulk import. It is the supported pure HTTPS path.

Email Link is an advanced path for a compatible Clerk tenant whose owner has
allowlisted a public HTTPS relay and reviewed same-device/browser policy:

```bash
export HYDRA_MAGIC_LINK_CALLBACK_ORIGIN="https://your-owner-allowlisted-relay.example"
export HYDRA_MAGIC_LINK_CALLBACK_ALLOWLIST_CONFIRMED=1
```

That origin must forward only `/api/auth/magic-callback` to the running Hydra
API. Do not point a generic tunnel at the full local Hydra server. OpenRouter
users cannot self-enable this because Hydra does not own OpenRouter's Clerk
tenant or callback allowlist.

## External References

- Clerk custom Email Link flow: https://clerk.com/docs/js-frontend/guides/development/custom-flows/authentication/email-links
- Clerk same-device/browser protection: https://clerk.com/docs/guides/secure/best-practices/protect-email-links
- Clerk redirect allowlist model: https://clerk.com/docs/reference/backend/types/backend-redirect-url
- Clerk Account Portal redirect rule: https://clerk.com/docs/guides/account-portal/direct-links
- OpenRouter OAuth PKCE callback flow: https://openrouter.ai/docs/use-cases/oauth-pkce

## Live Relay Setup Attempt

Date: 2026-06-01

The operator asked Hydra to configure the relay after seeing the Email Link
capability banner. A fresh machine-state and upstream-contract check confirmed
that Hydra must not write the two opt-in environment variables automatically:

- `cloudflared --version` reports `2026.3.0`, but this machine has no
  `~/.cloudflared/` identity. `cloudflared tunnel list` fails because no origin
  certificate is configured.
- `wrangler whoami` reports that Wrangler is not authenticated.
- A live `curl -sSIL https://openrouter.ai/sign-in` probe confirms OpenRouter
  is using `https://clerk.openrouter.ai`.
- Clerk's current redirect documentation states that `redirect_url` must be on
  the instance domain, one of its subdomains, or share the requesting origin.
  Hydra cannot add a relay URL to OpenRouter's tenant-owned allowlist.
- A live
  `curl -sSIL 'https://openrouter.ai/auth?callback_url=https%3A%2F%2Fexample.com%2Fcb'`
  probe confirms that OpenRouter has a same-origin `/auth` handoff. OpenRouter
  documents that route as an OAuth PKCE API-key authorization flow. It does
  not return the Clerk `__clerk_ticket` required by Hydra's
  `/api/auth/magic-callback` session-completion route.
- The local Printing Press OpenRouter map exposes `/auth/keys/code` and
  `/auth/keys` for that PKCE API-key flow. It does not expose a supported API
  that imports an OpenRouter Clerk login session.

No tunnel was started and no `.env` value was changed. Setting
`HYDRA_MAGIC_LINK_CALLBACK_ALLOWLIST_CONFIRMED=1` without a tenant-owner
allowlist entry would be false and would re-enable the rejected-request loop.
For OpenRouter accounts, use Bulk OTP. Hydra users cannot self-enable Email
Link for OpenRouter accounts because OpenRouter owns the Clerk tenant. If an
owner-controlled Clerk tenant is introduced later, configure an authenticated
named tunnel that forwards only `/api/auth/magic-callback`, register that exact
HTTPS relay with the Clerk tenant owner, and only then set both opt-in
variables.

## OTP Guidance Follow-Up

Date: 2026-06-01

A later source review found one stale renderer hint in `src/utils/auth.js`.
When Clerk rejected `email_code` or reported an unavailable strategy, the hint
still recommended the Email Link tab generically. That contradicted the
capability-gated OpenRouter behavior above and could steer an operator back
into the rejected callback lane.

The hint now says to check the account sign-in method and use Email Link only
when its capability banner says ready. `server/tests/ui-static-contract.test.mjs`
locks both the positive copy and removal of the stale generic recommendation.
The same pass corrected the adjacent rate-limit hint grammar from `requests
send` to `requests sent` and locks that wording as well.

Focused verification passed:

- `npm run test:api-integration` (`10/10`)
- `node --test server/tests/ui-static-contract.test.mjs
  server/tests/background-failure-visibility.test.mjs
  server/tests/batch-runner.test.mjs
  server/tests/openrouter-request-cancellation.test.mjs` (`89/89`)
- `npm run lint`
- `npm run build`
- `git diff --check`

The read-only post-fix runtime profile under
`/private/tmp/hydra-v147-post-bulk-guidance-profile-20260601T224033Z`
sampled the still-installed exact-public `v1.4.7` package 11 times at
30-second intervals. It retained four Hydra-owned processes and zero stale
profiles throughout; CPU stayed within `0.0-0.4%`, averaged `0.036%`, and
ended at `0.0%`; RSS moved `621101056 -> 523845632` bytes (`-97255424`).
This is conservative no-regression evidence for the running public package,
not a claim that the copy-only source patch has already shipped.

After the adjacent grammar lock, the read-only follow-up profile under
`/private/tmp/hydra-v147-post-bulk-grammar-profile-20260601T225030Z`
sampled the same still-installed exact-public package 11 more times at
30-second intervals. It retained four Hydra-owned processes and zero stale
profiles throughout; CPU stayed within `0.0-0.4%`, averaged `0.073%`, and
ended at `0.0%`; RSS moved `509345792 -> 513179648` bytes (`+3833856`).

## Owner-Only Operator Copy

Date: 2026-06-02

A fresh setup request exposed that the dormant Email Link tab subtitle could
still read like a local setup task even though OpenRouter owns the required
Clerk allowlist. Hydra now says `Owner-only; use OTP` in the tab switcher. The
backend error explicitly says Email Link cannot be self-enabled for OpenRouter
accounts, and `.env.example` reserves relay configuration for a genuinely
owner-controlled Clerk tenant. No tunnel was started and no `.env` opt-in was
forged. The broad `.env.*` ignore rule now explicitly unignores that
placeholder-only template so the operator guidance ships with the repo.

Focused verification passed:

- `npm run test:ui-static` (`46/46`)
- `npm run test:api-integration` (`11/11`)
- `npm run test:background-failure-visibility` (`33/33`)
- `npm run lint`
- `npm run build`
- `git diff --check`

The rebuilt ARM package passed smoke, strict deep codesign, and Bulk Import
renderer hash equality:

```text
6dda6c27f1bef4efbf0feea42b2326d60519a03cfc183495e79097b7abfbb05b  dist/assets/BulkAuthWizard-CfkZ2A5T.js
6dda6c27f1bef4efbf0feea42b2326d60519a03cfc183495e79097b7abfbb05b  release/mac-arm64/Hydra.app/Contents/Resources/app/dist/assets/BulkAuthWizard-CfkZ2A5T.js
461bf8e32d93582544eb87042ed4a62deb418ae1d2ddc1123371cf61a66f61e1  release/Hydra-1.4.7-mac-arm64.zip
```

Generated archive metadata moved reversibly to Trash. LaunchServices reopened
the sole Spotlight `Hydra.app`; the bounded startup sample settled from
`53.8%` CPU at `+30s` to `0.3%` at `+65s`, with four owned processes and zero
stale profiles.

The final literal recheck passed lint, full `npm test`, gate `12/12`, OpenAPI
generation (`84 operations`, no tracked drift), diff hygiene, audit, and local
Docker smoke with a rebuilt image and real containerized Playwright Chromium
launch. Teardown left no `hydra_default` network and stopped Docker Desktop
cleanly.

## Existing Import Versus New Signup

Date: 2026-06-02

A follow-up source trace confirmed that Bulk OTP and the account-card
Authenticate modal use the same direct HTTPS endpoints:

```text
POST /api/accounts/:id/otp/start
POST /api/accounts/:id/otp/verify
```

That lane is correct for importing an existing OpenRouter account and does not
need a public callback URL. The separate Email Link relay is not a setup step
for OpenRouter.

The trace also exposed one unsafe ambiguity: an email unknown to OpenRouter
could still enter Clerk's direct `sign_up` preparation from Bulk OTP even
though OpenRouter requires interactive CAPTCHA verification for new signup.
Hydra now fails closed before that direct preparation with structured code
`SIGNUP_INTERACTIVE_REQUIRED`. The renderer shows an **Open Account Generator**
action, and Generator retains the isolated interactive signup lane. Hydra does
not retry or bypass the CAPTCHA-gated signup boundary.

Reproduction:

1. Open Bulk Account Import and keep the default OTP lane.
2. Paste an existing OpenRouter account email, build the queue, and send the
   email code. Hydra uses the same direct HTTPS OTP path as account-card
   Authenticate.
3. Paste an email that is not registered with OpenRouter, build the queue, and
   send the code. Hydra returns `SIGNUP_INTERACTIVE_REQUIRED` before attempting
   direct Clerk `sign_up` preparation and offers the Generator handoff.

Source contracts:

- `server/services/clerk-auth.js`: typed interactive-signup boundary before
  direct `sign_up` preparation.
- `server/controllers/AccountController.js`: preserves the structured error
  code and safe hint.
- `src/hooks/useBulkAuth.js`, `src/components/OtpTab.jsx`: structured Generator
  handoff.
- `src/pages/BulkAuthWizard.jsx`: existing-import versus new-signup copy.

Verification passed:

- `npm run test:clerk-signup-boundary` (`1/1`)
- `npm run test:ui-static` (`46/46`)
- `npm run test:background-failure-visibility` (`33/33`)
- `npm run test:api-integration` (`11/11`)
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`

The local ARM `v1.4.8` candidate replaced the prior canonical bundle through a
reversible Trash move. It passed explicit package smoke, strict deep codesign,
bundle-version inspection, and embedded-source inspection. The generated
archive hashed to:

```text
6a051e0f0f9f1c844c0600832e34629e9d1bd4b104259934d50b83ae577ba7  Hydra-1.4.8-mac-arm64.zip
```

Generated archive metadata moved reversibly to
`~/.Trash/hydra-v148-bulk-signup-boundary-package-byproducts-20260602T005805Z`.
LaunchServices reopened the sole Desktop-tree `Hydra.app`. The bounded startup
sample retained four Hydra-owned processes and zero stale profiles while CPU
decayed from `270.2%` at `+5s` to `60.5%` at `+15s`, then `0.0%` at both
`+20s` and `+30s`. Splash diagnostics reported `target=72`,
`duplicateShatterSkips=0`, `timers=0`, `rafActive=false`, `bodyCount=0`,
`matterCleared=true`, `portalCollisionDisabled=true`, and
`portalLiftApplied=true`.
