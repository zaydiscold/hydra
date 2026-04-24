# HTTP Signup Migration

**Branch:** `feat/http-signup-migration`
**Status:** Finished as a hybrid flow: HTTP where Clerk allows it, browser fallback for CAPTCHA-gated new signup
**Last updated:** 2026-04-24

---

## Summary

The original goal was to replace Generator signup browser automation with direct Clerk FAPI HTTP calls. Verification showed that OpenRouter's Clerk instance now has `captcha_on_signup: true`; direct `POST /v1/client/sign_ups` returns `captcha_missing_token`, and `POST /v1/client/sign_ins` for an unknown email returns "Couldn't find your account."

That means brand-new account creation cannot currently be pure HTTP. The finished branch keeps the useful HTTP automation for flows that Clerk still permits:

- Existing-account OTP send and verify use Clerk FAPI requests.
- Session materialization and refresh remain direct HTTP.
- New account signup falls back to Playwright because a real page is needed to satisfy the CAPTCHA-protected signup path.
- Management key provisioning still uses its existing internal ladder: tRPC HTTP first, then browser fallback when needed.

## Verified Upstream Behavior

Connectivity check:

```bash
npm run check:clerk
```

Result on 2026-04-24: Clerk FAPI is reachable and returns `__client` cookies.

Direct new signup probe:

```text
POST https://clerk.openrouter.ai/v1/client/sign_ups?...
HTTP 400
code: captcha_missing_token
message: Authentication unsuccessful due to failed security validations.
```

Unknown-email sign-in probe:

```text
detectAuthMethod(hydra-http-probe-...@example.com)
Clerk error: Couldn't find your account.
```

This confirms the branch cannot honestly promise "new signup is pure HTTP" until OpenRouter disables signup CAPTCHA or Hydra gains a legitimate CAPTCHA-token handoff from a browser session.

## Files Changed

### `server/services/account-generator.js`

The Generator service is now split into explicit paths:

- `launchSignupFlow` starts with `detecting_account`.
- If Clerk recognizes the email, it sends OTP through `startEmailOTP()` and stores HTTP task resources (`signInId`, `clientCookie`, `httpMode`).
- If Clerk rejects detection for an unknown account, or if sign-up preparation is CAPTCHA-gated, it sets `falling_back_to_browser` and calls `launchSignupFlowPlaywright()`.
- `finalizeOtpSubmission` uses `completeEmailOTP()` only for HTTP-mode tasks; browser tasks complete through Playwright.
- `closeGeneratorResources` is null-safe for HTTP tasks.
- `GENERATOR_TTL_MS` is 5 minutes to leave a practical OTP entry window.

Existing-account HTTP state machine:

```text
detecting_account -> sending_otp -> awaiting_otp -> verifying_otp ->
[activating_session] -> saving_profile -> provisioning_key -> completed
```

New-account state machine while Clerk signup CAPTCHA is enabled:

```text
detecting_account -> falling_back_to_browser -> launching_browser ->
navigating_signup -> waiting_for_page_hydrate -> entering_email ->
awaiting_otp -> submitting_otp -> completed
```

### `server/services/otp-generator.js`

This dead-code service had broken API calls and now matches the task/store APIs:

1. `taskSupervisor.createTask()` -> `taskSupervisor.startInteractive()`
2. `store.createAccount()` -> `store.addAccountWithCredentials()` plus `store.updateAccountSession()`
3. `taskSupervisor.cleanup()` -> `taskSupervisor.cancel()`
4. `heartbeatOtpJob()` wraps its return value with `serializeTask()`
5. `session.clientCookie` is converted through `openRouterDashboardDeviceCookies()` before persistence.

No active route imports this file today; the fixes keep it usable if it is wired back in later.

### `Dockerfile`

The runtime image was slimmed from the Playwright base image to `node:20-bookworm`.
Runtime dependencies are installed with `npm ci --omit=dev`, Chromium is installed afterward with `npx playwright install chromium`, and `apt-get`/`tini` were removed to avoid Docker Desktop proxy failures.

## Operator Expectations

For a brand-new generated email, seeing `falling_back_to_browser` or `launching_browser` is expected and correct while Clerk has signup CAPTCHA enabled.

For an existing OpenRouter email with email-code auth available, the flow should stay on HTTP statuses through OTP verification.

## Key APIs

```javascript
detectAuthMethod(email)
startEmailOTP(email)
completeEmailOTP(signInId, code, clientCookie, { isSignUp })
refreshSession(clientCookieArray, sessionCookie)
openRouterDashboardDeviceCookies(cookieString)
```

`openRouterDashboardDeviceCookies()` returns the `[{ cookie, issuedAt }]` array expected by `store.updateAccountSession()`.

## Verification Results

| Check | Result |
|-------|--------|
| Clerk FAPI connectivity | PASS |
| Direct new signup probe | CAPTCHA-gated (`captcha_missing_token`) |
| Unknown-email detection | Falls back to browser (`Couldn't find your account.`) |
| Existing-account HTTP path | Code path present; requires real OTP to complete |
| Playwright fallback path | Code path present for new signup |
| Build | PASS (`npm run build`) |
| Lint | PASS (`npm run lint`) |
