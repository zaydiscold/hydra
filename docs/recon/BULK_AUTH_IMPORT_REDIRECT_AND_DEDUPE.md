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
