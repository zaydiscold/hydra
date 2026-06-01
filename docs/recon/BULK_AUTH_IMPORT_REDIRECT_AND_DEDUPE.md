# Bulk Auth Import Redirect and Dedupe

Date: 2026-06-01

## What Was Found

Bulk Email Link import had two independent failure modes:

- Hydra sent one `/accounts/bulk-otp-stubs` request and then one high-cost `/magic-link/send` request per row. A 13-row batch could hit Hydra's own `12/min` high-cost limiter before upstream Clerk was even considered.
- Clerk rejected the magic-link `redirect_url` because Hydra generated a localhost callback while the Clerk FAPI request origin/referer is OpenRouter. Clerk requires email-link redirects to belong to the instance domain, an allowed redirect URL, or the same origin as the requesting page.

## Why It Matters

The broken flow created hidden damage:

- Valid rows could be marked failed because Hydra self-rate-limited a local queue.
- The UI kept firing after the first redirect-domain failure, causing upstream Clerk throttling.
- Duplicate email rows were silently collapsed, so the operator could not tell which rows were skipped or reused.

## How It Was Fixed

- `/api/accounts/bulk-otp-stubs` no longer uses the high-cost limiter; it is a local encrypted-vault write and does not send Clerk email.
- `/api/accounts/magic-link/capability` exposes whether Email Link can run before any account row is created or replaced.
- The Email Link tab now runs that capability preflight first. If the callback is missing or local-only, the UI shows one failure state, disables retry for those rows, leaves the paste input intact, and does not contact Clerk.
- Bulk Email Link sends are paced one at a time with a `6500ms` gap.
- Email Link sending now fails closed before contacting Clerk unless `HYDRA_MAGIC_LINK_CALLBACK_ORIGIN` is set to a public HTTPS origin that routes `/api/auth/magic-callback` back to Hydra.
- Bulk import has a shared "Force replace matching saved emails" toggle. Without it, existing emails are reported as duplicate skips and stay in the paste box. With it, the existing row is converted back into a pending OTP stub while management-key records are preserved.
- The paste box clears only successfully used first occurrences. Repeated pasted emails and failed/skipped rows remain for retry.

## Evidence

Source contracts:

- `server/controllers/AccountController.js`: callback preflight, capability endpoint, include-pending duplicate lookup, and force-replace path.
- `server/routes/accounts.js`: bulk OTP stubs are no longer high-cost limited.
- `server/services/store.js`: `replaceAccountWithOtpStub()` clears stale session material, invalidates session-status cache, and preserves the account row.
- `src/hooks/useBulkAuth.js`: capability-gated Email Link queue, paced sends, and paste cleanup.
- `src/utils/auth.js`: duplicate-preserving email parsing and cleanup helpers.

Regression coverage:

- `server/tests/background-failure-visibility.test.mjs`
- `server/tests/ui-static-contract.test.mjs`
- `server/tests/electron-api-integration.test.mjs`

## Repro Notes

Use OTP for pure HTTPS bulk import. Use Email Link only after configuring a public callback origin:

```bash
export HYDRA_MAGIC_LINK_CALLBACK_ORIGIN="https://your-public-hydra-origin.example"
```

That origin must forward `/api/auth/magic-callback` to the running Hydra API.
