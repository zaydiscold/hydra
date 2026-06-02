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
- Focused verification after the patch:
  - `node --check server/services/account-generator.js`
  - `npm run test:background-failure-visibility`
  - `npm run test:ui-static`

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
- readSignupCheckpoint(page)
- Manual upstream verification visible ...
- GENERATOR_OTP_SCREEN_TIMEOUT
- fillVisibleOtpInput(page, otpCode, task.taskId)
- input[name*="code" i]
- input[inputmode="numeric"]

src/api.js
- submitGeneratorOtpQuiet(..., trackLoading: false)

src/pages/Generator.jsx
- waiting_for_otp_screen: Watching the isolated browser for email-code or human-verification state.
- manual_verification: Finish the verification in the account browser...
- Submit code
```

No supplied signup password was used to create a live upstream account during
this verification. The remaining upstream OTP or human-verification completion
is operator-owned.

## Reproducibility

1. Open Hydra's Account Generator.
2. Start a browser-signup task with an email that Clerk treats as a new account.
3. If OpenRouter shows human verification, Hydra should move to
   `manual_verification` within the short poll window instead of waiting the full
   30 seconds.
4. Complete the browser verification. Once the OTP form appears, Hydra should
   move to `awaiting_otp`.
5. Enter the six-digit code in Hydra and press Enter or **Submit code**. The app
   should stay responsive while the browser task submits the code and finishes
   session capture/provisioning.

