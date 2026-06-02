# Account Generator OTP Timeout and Manual Verification

Date: 2026-06-02

## What Was Found

The Account Generator browser-signup path could appear stuck at
`waiting_for_otp_screen` for the full 30-second OTP wait. Hydra only checked for
human-verification UI after the OTP wait timed out, so an upstream CAPTCHA,
Cloudflare challenge, or shifted Clerk page looked like an OTP hang instead of a
visible operator step.

The OTP submit path was also too narrow. It targeted Clerk's segmented
one-digit inputs first and only used a generic button click afterward. If Clerk
rendered a single six-digit code field or renamed the code input, Hydra could
miss the field, fail late, or leave the renderer feeling blocked while the
isolated browser was doing the real work.

Follow-up live reproduction on 2026-06-02 found a second upstream change:
OpenRouter's current signup form no longer advances from email alone. The page
renders a required password field and a required legal acceptance checkbox
before Clerk will move toward the email-code step. After those fields are
filled, OpenRouter may still expose an empty `cf-turnstile-response` field,
which means the form is waiting on Cloudflare/Turnstile verification even when
there is no large visible CAPTCHA panel. The generator now treats that as
`manual_verification`, not as an OTP wait.

Follow-up packaged-path review on 2026-06-02 found a third wiring issue:
two Playwright `waitForFunction` calls passed `{ timeout }` as the function
argument instead of the third `options` parameter. That meant Playwright could
silently use its default 30 second timeout and report
`Timeout 30000ms exceeded`, even when Hydra intended a different wait contract.
Hydra now passes `undefined` as the second argument and the timeout object as
the third argument, records sanitized browser checkpoints, and exposes a
Generator focus endpoint so the operator can bring the isolated account browser
forward during security checks.

## How It Was Found

- The reported error matched Playwright's 30-second wait shape:
  `Timeout 30000ms exceeded`.
- Source trace:
  - `src/pages/Generator.jsx` rendered `waiting_for_otp_screen` until the server
    moved the task forward.
  - `server/services/account-generator.js` used a serial wait:
    `waitForFunction(otpChallengeVisiblePredicate, 30000)` followed by a short
    manual-verification check only after the OTP wait failed.
  - `finalizeOtpSubmissionPlaywright()` used a narrow OTP input selector before
    clicking a submit control.
- Live upstream trace with Hydra's isolated Playwright path:
  - Opened `https://openrouter.ai/sign-up`.
  - Filled the email field only, matching the old generator behavior.
  - OpenRouter stayed on the sign-up form and reported password validation.
  - The active inputs were `input[name="emailAddress"]`,
    `input[name="password"]`, and `input[name="legalAccepted"]`.
  - After filling password and terms, the page exposed
    `input[name="cf-turnstile-response"]` with an empty value, indicating an
    upstream security gate rather than a ready OTP form.
- Focused verification after the patch:
  - `node --check server/services/account-generator.js`
  - `npm run test:background-failure-visibility`
  - `npm run test:ui-static`
  - `npm run test:openrouter-request-cancellation`
- Direct service smoke through `startSignupJob()` reached
  `manual_verification` with `mode=browser_signup` and cleaned up without a
  false launch failure after cancellation.
- `v1.5.3` focused verification:
  - `node --check server/services/account-generator.js`
  - `node --check server/controllers/GeneratorController.js`
  - `node --check server/routes/generator.js`
  - `npm run test:background-failure-visibility`
  - `npm run test:ui-static`
  - `npm run lint`
  - `npm run build`
  - `git diff --check`
  - Source-level live Generator smoke with a throwaway address reached
    `manual_verification` after password fill, terms acceptance, Continue
    click, checkpoint reporting, and clean cancellation.

## Why It Matters

The operator should know whether Hydra is waiting for an email code or waiting
for a browser-side human-verification gate. Delaying that state by 30 seconds
makes the generator look broken and encourages duplicate starts, retry pressure,
and unnecessary upstream rate-limit burn.

The OTP form also needs to tolerate Clerk layout changes. OpenRouter's Clerk
surface can render segmented fields, a single numeric field, renamed code
inputs, or a security challenge before the OTP screen. Hydra should detect those
states directly and keep the local app responsive while the browser task
continues in the background.

## Raw Evidence

Redacted source evidence after the fix:

```text
server/services/account-generator.js
- OTP_CHECK_INTERVAL_MS = 350
- SIGNUP_FORM_BLOCKED_GRACE_MS = 3 * 1000
- readSignupCheckpoint(page)
- signupBlocked / passwordBlocked / legalBlocked
- input[name="cf-turnstile-response"]
- turnstilePending
- fillVisibleSignupPassword(page, ...)
- acceptVisibleSignupTerms(page, ...)
- Manual upstream verification visible ...
- GENERATOR_SIGNUP_FORM_BLOCKED
- GENERATOR_MANUAL_VERIFICATION_TIMEOUT
- GENERATOR_OTP_SCREEN_TIMEOUT
- fillVisibleOtpInput(page, otpCode, task.taskId)
- input[name*="code" i]
- input[inputmode="numeric"]

src/api.js
- submitGeneratorOtpQuiet(..., trackLoading: false)

src/pages/Generator.jsx
- waiting_for_otp_screen: Watching the isolated browser for email-code or human-verification state.
- entering_signup_details: Entering the signup password and required OpenRouter consent.
- manual_verification: Finish any OpenRouter security check in the account browser...
- Submit code
- Browser state: {checkpointText}
- Show account browser

server/routes/generator.js
- POST /:taskId/focus

server/services/account-generator.js
- page.waitForFunction(..., undefined, { timeout: STARTUP_TIMEOUT_MS })
- page.waitForFunction(..., undefined, { timeout: 15000 })
- focusSignupBrowser(taskId, ownerUserId)
```

No supplied signup password is recorded in this document. The verification
stopped at the upstream security-check boundary; OTP receipt and final account
creation remain operator-owned.

## Reproducibility

1. Open Hydra's Account Generator.
2. Start a browser-signup task with an email that Clerk treats as a new account.
3. Hydra should fill the signup email and, when OpenRouter renders them on the
   current step, the required password and legal checkbox before clicking
   Continue.
4. If OpenRouter keeps the password or legal checkbox required, Hydra should
   fail with `GENERATOR_SIGNUP_FORM_BLOCKED` instead of hanging.
5. If OpenRouter shows or hides a Turnstile/security gate, Hydra should move to
   `manual_verification` within the short poll window instead of waiting the full
   30 seconds.
6. Complete the browser verification. Once the OTP form appears, Hydra should
   move to `awaiting_otp`.
7. Enter the six-digit code in Hydra and press Enter or **Submit code**. The app
   should stay responsive while the browser task submits the code and finishes
   session capture/provisioning.
