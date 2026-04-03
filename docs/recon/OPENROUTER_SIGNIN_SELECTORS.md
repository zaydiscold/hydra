# OpenRouter sign-in recon (Clerk-hosted)

Hydra does **not** drive the openrouter.ai DOM for normal login. Session establishment uses **Clerk Frontend API** from the server (`server/services/clerk-auth.js`): strategies include `email_code` (6-digit email OTP) and password + optional TOTP. This doc maps the **user-facing** OpenRouter flow for manual testing and contrasts it with Hydra automation hooks.

## openrouter.ai (browser)

1. **URL**: `https://openrouter.ai/sign-in` (or sign-up; product may redirect).
2. **Email field**: standard email input on the first step.
3. **After email**: Clerk may show password and/or **“Use another method”** / alternate sign-in.
4. **Email code vs magic link**: Hydra’s server path matches **email code** (`email_code`), not one-click magic link (`email_link`). In the UI, pick the option that sends a **6-digit code** to the inbox (wording may be “Email code” / similar).
5. **2FA**: If the account uses an authenticator app, Clerk shows a TOTP step; Hydra maps that to `verifyOTP` with `totpSecondFactor: true` after password login returns **202** with `signInId`.

Selectors on Clerk’s hosted pages are **not stable** across versions; prefer **role** / **accessible name** in Playwright (`getByRole`, `getByLabel`) over CSS IDs.

## Hydra UI (stable automation)

Use these `data-testid` attributes on the dashboard login modal (`LoginAccountModal`):

| testid | Step |
|--------|------|
| `login-account-modal` | Root dialog |
| `login-account-otp-intro` | Email OTP intro copy + actions |
| `login-account-send-otp` | Send verification code |
| `login-account-use-password` | Switch to password step |
| `login-account-password-form` | Password form |
| `login-account-password-input` | Password field |
| `login-account-password-submit` | Sign in |
| `login-account-switch-otp` | Use Email OTP instead |
| `login-account-otp-form` | OTP entry |
| `login-account-otp-input` | 6-digit code |
| `login-account-otp-submit` | Verify |
| `login-account-otp-back` | Back |
| `login-account-error` | Error text (any step) |

Bulk OTP wizard: see `data-testid="bulk-auth-*"` in `src/pages/BulkAuthWizard.jsx`.

## Network (Clerk FAPI)

Server-side calls use `CLERK_BASE` (e.g. `https://clerk.openrouter.ai/v1`). Relevant pieces: `Set-Cookie` for `__client` / `__client_uat`, `__session` after completed sign-in. Undici clients must aggregate **`getSetCookie()`** lines, not only `headers.get('set-cookie')`.
