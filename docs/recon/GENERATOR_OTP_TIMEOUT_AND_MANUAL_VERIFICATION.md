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

Follow-up live form walk on 2026-06-02 found a fourth upstream drift:
OpenRouter now opens a Clerk modal with first name, last name, email, password,
terms, duplicate visible submit controls, and a floating portal that can
intercept checkbox clicks. Hydra `1.5.4` fills the visible duplicate form fields,
derives safe first/last names from the email, accepts the legal checkbox with a
force path plus DOM fallback, clicks the current modal Continue control, and
uses checkpoint truth to unlock OTP entry if the browser has already reached the
code screen before the status poll updates.

Follow-up operator report on 2026-06-02 found a fifth handoff drift:
the isolated browser could reach a waiting-for-code surface while Hydra still
timed out after Playwright's familiar `30000ms` shape. Hydra `1.5.5` expands
OTP detection to renamed `otp`, `code`, `digit`, and `verification` fields,
segmented one-digit code boxes, and current copy such as "we sent a code",
"six-digit", and "resend code". The browser wait is now `75s`, and the isolated
browser opens at `1360x900` so OpenRouter's modal/buttons render in the desktop
layout instead of cramped responsive states.

Follow-up operator report on 2026-06-02 found a sixth local handoff issue:
after the operator typed a six-digit OTP and pressed Enter, the local page could
appear grey and stuck before the task visibly moved into the background. The
root cause was local orchestration, not upstream OTP ownership: the verify route
still used the high-cost route limiter, the renderer waited for the quiet POST
before showing `submitting_otp`, stale `checkpoint.state=otp` could keep the
OTP form visible during finalization, and duplicate Enter/click submits could
race the same browser finalization. Hydra `1.5.7` removes the high-cost limiter
from OTP submit, validates six-digit codes at the controller boundary, flips the
UI into `submitting_otp` immediately, hides stale OTP controls during
finalization, records `otpAcceptedAt`, and makes duplicate submits idempotent.

Follow-up live probe on 2026-06-02 found a seventh post-security-check edge:
OpenRouter can leave the filled signup modal on `/sign-up` with all fields
disabled, a disabled/loading Continue button, and a hidden empty
`cf-turnstile-response`. Hydra already identified that as an upstream
manual/security handoff, but after the hidden check cleared it only waited for
an OTP page and did not retry the now-unblocked signup form. Hydra `1.5.8`
records `turnstilePending` and loading-button `submitPending`, retries the
signup form after manual verification clears, and exposes a deliberate
browser-backed OTP override so the operator can submit the email code if the
isolated browser is visibly on a code screen before the detector catches up.

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
- `v1.5.4` direct service smoke through `startSignupJob()` reached
  `manual_verification` in seven seconds after filling first name, last name,
  email, password, and terms. The sanitized checkpoint reported all field
  blockers false before clean cancellation.
- `v1.5.4` source dev visual smoke for `/generator` saved a screenshot and
  measured zero overflow after replacing the inner Start button `btn-icon`
  span with `generator-button-label`.
- `v1.5.5` focused contracts verified the expanded OTP detector, the `75s`
  wait, the `1360x900` isolated-browser viewport/screen, and the active-job
  layout shell/button sizing:
  - `npm run test:background-failure-visibility`
  - `npm run test:ui-static`
  - direct `node --check` on touched server/test modules
  - `npm run lint`
  - `npm run build`
  - `git diff --check`
- `v1.5.5` package verification rebuilt the local macOS ARM app, passed package
  smoke and strict deep codesign, inspected the embedded source for the `75s`
  OTP wait and `1360x900` browser viewport, and sampled a clean LaunchServices
  relaunch at `t+35s`, `t+75s`, and `t+120s` with four Hydra-owned processes,
  zero stale Hydra Playwright profiles, and CPU at `0.0%`, `0.0%`, and `0.6%`.
  Computer Use timed out against the packaged app on this machine, and
  `osascript` System Events reported missing assistive-access permission, so
  the native desktop walkthrough remains an environment boundary.
- `v1.5.7` focused verification reproduced the current Generator route from the
  source dev app. The patched page rendered cleanly at `/generator`, a supplied
  alias/password reached the isolated OpenRouter signup browser, and the task
  moved to `manual_verification` with equal-width active-job controls instead
  of the old generic `Timeout 30000ms exceeded` behavior. The smoke was bounded
  and cancelled through `DELETE /api/generator/:taskId`; the log recorded the
  supervisor reason and the isolated Playwright profile was removed.
- `v1.5.7` regression checks:
  - `node --check server/controllers/GeneratorController.js`
  - `node --check server/routes/generator.js`
  - `node --check server/services/account-generator.js`
  - `npm run test:background-failure-visibility`
  - `npm run test:ui-static`
  - `npm run build`
- `v1.5.8` focused verification:
  - `node --check server/services/account-generator.js`
  - `npm run test:background-failure-visibility`
  - `npm run test:ui-static`
  - `npm run build`
  - `git diff --check`
  - Bounded source-level live probe with a throwaway `preheat.cc` alias reached
    `manual_verification` after filling first name, last name, email, password,
    and legal acceptance. The sanitized checkpoint recorded
    `submitPending=true`; the browser DOM showed `url=https://openrouter.ai/sign-up`,
    a hidden empty `cf-turnstile-response`, and a disabled/loading Continue
    button. The task was cancelled through `cleanupJob()` without OTP submit or
    account persistence.
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
- emailBlocked / firstNameBlocked / lastNameBlocked
- input[name="cf-turnstile-response"]
- turnstilePending
- fillVisibleSignupNames(page, ...)
- fillVisibleSignupEmail(page, ...)
- fillVisibleSignupPassword(page, ...)
- acceptVisibleSignupTerms(page, ...)
- clickVisibleSignupContinueControl(page, ...)
- Manual upstream verification visible ...
- GENERATOR_SIGNUP_FORM_BLOCKED
- GENERATOR_SIGNUP_EMAIL_FIELD_MISSING
- GENERATOR_SIGNUP_NAME_FIELD_MISSING
- GENERATOR_MANUAL_VERIFICATION_TIMEOUT
- GENERATOR_OTP_SCREEN_TIMEOUT
- fillVisibleOtpInput(page, otpCode, task.taskId)
- input[name*="code" i]
- input[inputmode="numeric"]

src/api.js
- submitGeneratorOtpQuiet(..., trackLoading: false)

src/pages/Generator.jsx
- isOtpReady(status, checkpoint)
- waiting_for_otp_screen: Watching the isolated browser for email-code or human-verification state.
- entering_signup_details: Entering the signup password and required OpenRouter consent.
- manual_verification: Finish any OpenRouter security check in the account browser...
- Submit code
- Browser state: {checkpointText}
- Show account browser
- generator-button-label

server/routes/generator.js
- POST /:taskId/focus

server/services/account-generator.js
- page.waitForFunction(..., undefined, { timeout: STARTUP_TIMEOUT_MS })
- page.waitForFunction(..., undefined, { timeout: 15000 })
- focusSignupBrowser(taskId, ownerUserId)
- OTP_FINALIZATION_STATUSES
- GENERATOR_OTP_INVALID
- otpAcceptedAt
- turnstilePending
- submitPending
- postManualAdvanceAttempts
- browserOtpOverrideReady

server/controllers/GeneratorController.js
- otp: z.string().regex(/^\d{6}$/, 'OTP must be a 6-digit code')

server/routes/generator.js
- router.post('/verify/:taskId', authenticateUser, ...)
- Generator start remains highCostRouteLimiter-protected

src/pages/Generator.jsx
- OTP_FINALIZATION_STATUSES
- BROWSER_OTP_OVERRIDE_STATUSES
- canUseBrowserOtpOverride(status, checkpoint, browserBacked)
- Finish the browser check. If the code field is already visible there, enter the email code here.
- setStatus('submitting_otp')
- isOtpReady blocks finalization and terminal statuses
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
   session capture/provisioning. A duplicate Enter or click during finalization
   should be treated as already processing, not as a second browser race.
