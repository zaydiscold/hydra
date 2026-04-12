# OpenRouter Infrastructure Recon
> Gathered: 2026-03-30 | Tools: subfinder, curl, dig, python3

---

## Tech Stack (from CSP headers)

| Layer | Tech | Evidence |
|-------|------|----------|
| Hosting | Vercel + Next.js | `x-powered-by: Next.js`, `x-vercel-id: sfo1::*` |
| CDN/WAF | Cloudflare | `server: cloudflare`, `cf-ray` on all requests |
| Auth | **Clerk** (production) | `clerk.openrouter.ai` FAPI, CSP includes it |
| Payments | Stripe | CSP: `checkout.stripe.com`, `connect-js.stripe.com` |
| Analytics | PostHog + GA + Segment + Datadog | CSP + `ph_bootstrap` cookie leaks feature flags |
| Realtime | Pusher | CSP: `*.pusher.com`, `wss://*.pusher.com` |
| Search | Algolia | CSP: `*.algolia.net`, `*.algolianet.com` |
| Status | OnlineOrNot | `status.openrouter.ai` → OnlineOrNot platform |
| Docs | Fern | CSP: `app.buildwithfern.com`, `prod.ferndocs.com` |
| Internal | Cloudflare Access | `internal.openrouter.ai` → CF Zero Trust |
| Infra | Kubernetes + ArgoCD | `argocd.internal.openrouter.ai` (internal DNS) |
| Monitoring | Grafana | `grafana.internal.openrouter.ai` (internal DNS) |

---

## DNS Records

```
A:    104.18.3.115, 104.18.2.115  (Cloudflare proxy)
NS:   clark.ns.cloudflare.com, ulla.ns.cloudflare.com
MX:   aspmx.l.google.com (Google Workspace)
TXT:  MS=ms10021800 (Microsoft verification)
      google-site-verification=* (3x)
      stripe-verification=8036027d64fb95fc68edd64dee16e8f86d5ab5ad6d3b5450c3670f605d4d02df
      anthropic-domain-verification-7gwg46=PIhaOX0UVFMt4mq8BdhMDW0Tz
      v=spf1 include:_spf.google.com include:amazonses.com include:mail.zendesk.com ~all
      rippling-domain-verification=5df2663b1d5f4887 (HR tool)
      oneleet-domain-verification-* (security compliance)
      linkedin-site-verification=*
```

---

## Subdomain Map (subfinder)

```
✅ LIVE
  200  clerk.openrouter.ai           Clerk FAPI — fully open REST auth API
  200  status.openrouter.ai          OnlineOrNot incident tracker
  200  tool-calling.openrouter.ai    Tool calling sandbox  
  200  tool-playground.openrouter.ai Tool playground UI
  200  trust.openrouter.ai           Security/trust page (nginx, static)
  200  www.openrouter.ai             Redirects to main

🔒 PROTECTED
  302  internal.openrouter.ai        → Cloudflare Access Zero Trust login
  302  internal-compete.openrouter.ai → Cloudflare Access Zero Trust
  302  design.openrouter.ai          → Cloudflare Access (Figma/design tool)
  403  accounts.openrouter.ai        → Cloudflare bot challenge (JS required)

🔍 INTERNAL DNS ONLY
  N/A  argocd.internal.openrouter.ai  ArgoCD (Kubernetes CD)
  N/A  grafana.internal.openrouter.ai Grafana (metrics dashboards)

💀 DEAD
  522  eu.openrouter.ai              Connection timeout (decommissioned EU region?)
  404  wrapped.openrouter.ai         Referenced in CSP but 404
  404  email-v3.openrouter.ai        Not found
  000  auth.services.openrouter.ai   Connection refused (internal only)
```

---

## Endpoint Scan (openrouter.ai)

```
200  /api                    Next.js route index
200  /api/v1                 API v1 root
200  /api/v1/models          Public model list (no auth)
200  /api/v1/providers       Public provider list (no auth)
200  /api/v1/auth            Auth info page
200  /api/internal           Internal Next.js API routes exist
200  /api/trpc               tRPC endpoint exists
200  /graphql                GraphQL endpoint (200, not introspectable without auth)
200  /sign-in                Clerk sign-in page
200  /sign-up                Clerk sign-up page
200  /health                 Health check
200  /healthz                Health check
200  /status                 Redirects to status.openrouter.ai
200  /uptime                 Uptime monitor (disallowed in robots.txt)
200  /seo                    SEO tooling (disallowed in robots.txt)
200  /wrapped                Year-in-review page

401  /api/v1/credits         Needs management key (returns 401)
401  /api/v1/keys            Needs management key
401  /api/v1/key             Needs any API key
401  /api/v1/activity        Needs management key
401  /api/v1/guardrails      Needs management key

307  /redeem                 Redirects (auth required) ← CODE REDEMPTION PAGE
307  /keys                   → /settings/keys
308  /settings               Permanent redirect
307  /settings/keys          Auth required
307  /settings/management-keys Auth required ← MGMT KEY CREATION PAGE
308  /credits                Redirect
308  /account                Redirect

404  /api/v1/auth/keys       Not found at this path (use /auth/keys)
400  /api/v1/generation      Needs request body
```

---

## Clerk API (clerk.openrouter.ai) — THE KEY FINDING

### What is the Clerk API?

**Clerk** is a third-party authentication provider. OpenRouter delegates all auth to Clerk's infrastructure. Clerk exposes a **Frontend API (FAPI)** at `clerk.openrouter.ai` which is a fully REST-accessible API that handles:
- Session creation and management
- Email/password sign-in
- OAuth sign-in (Google, GitHub)
- Email OTP / magic links
- TOTP 2FA
- Client cookie management

**The critical insight:** Clerk's FAPI is designed to be called from the browser's JavaScript SDK, but it's just HTTP with cookies — meaning we can call it directly from any HTTP client (curl, fetch, python requests, etc.) without any browser.

### Clerk Instance Config

```
Endpoint:    https://clerk.openrouter.ai/v1/environment
Instance ID: aac_2PiQqjkyv87XHXL9B44ixveX3Zq
App Name:    OpenRouter
Environment: production

Auth methods enabled:
  ✅ email_address + password (REQUIRED for all accounts)
  ✅ oauth_google
  ✅ oauth_github
  ✅ web3_metamask_signature
  ✅ passkey
  ✅ enterprise_sso / saml
  ✅ email_code (OTP)
  ✅ email_link (magic link)
  ⬜ phone_number (disabled)

2FA:
  ✅ totp (available but optional)

Security:
  single_session_mode: true
  captcha_on_signup: YES (blocks new account creation)
  captcha_on_signin: NO  ← we can sign in freely
  hibp_breach_check: disabled
  min_password_length: 0 (no policy enforced)
```

### Sign-In Flow (Programmatic — No Browser)

```
Step 1: GET  /v1/client
  → Returns client object + sets __client cookie
  → Cookie jar establishes session context

Step 2: POST /v1/client/sign_ins
  Body: identifier=<email>   (application/x-www-form-urlencoded)
  Cookie: <client cookie>
  → Returns sign_in_attempt with id (sia_xxx)
  → status: "needs_first_factor"
  → supported_first_factors: depends on account

Step 3a (Password accounts):
  POST /v1/client/sign_ins/{sia_id}/attempt_first_factor
  Body: strategy=password&password=<password>
  → On success: status "complete", __session JWT in set-cookie

Step 3b (OAuth-only accounts — Google/GitHub):
  POST /v1/client/sign_ins/{sia_id}/prepare_first_factor
  Body: strategy=oauth_google&redirect_url=<url>
  → Returns OAuth URL → must redirect browser → get code back
  → REQUIRES Playwright for the OAuth dance

Step 3c (Email OTP accounts):
  POST /v1/client/sign_ins/{sia_id}/prepare_first_factor
  Body: strategy=email_code&email_address_id=<id from step 2>
  → Sends OTP to email
  
  POST /v1/client/sign_ins/{sia_id}/attempt_first_factor
  Body: strategy=email_code&code=<6-digit>
  → On success: __session JWT

Step 4 (if TOTP 2FA enabled):
  POST /v1/client/sign_ins/{sia_id}/attempt_second_factor
  Body: strategy=totp&code=<6-digit>
  → On success: __session JWT

Step 5: Use __session JWT for all dashboard requests
  Cookie: __session=<jwt>
  → Valid for all internal OpenRouter dashboard API calls
```

### Live Test Results

| Email | Account Exists | Strategies | Auth Method |
|-------|---------------|------------|-------------|
| `zaydkhan3@gmail.com` | ✅ Yes | email_code, email_link, oauth_google | Google OAuth — needs browser for Google dance |
| `iam@zayd.wtf` | ✅ Yes | **password**, email_code, email_link | ✅ Pure HTTP — no browser needed |

---

## PostHog Feature Flags (from ph_bootstrap cookie)

Leaked from unauthenticated page load:
```json
{
  "effective_pricing_tab": true,
  "survey-targeting-*": true/false,
  "nav_broadcast_name_test": "control",
  "nav_signup_color_test": "test",
  "broadcast_ga_banner": true
}
```

---

## OpenRouter Management API Summary

Base URL: `https://openrouter.ai/api/v1`
Auth: `Authorization: Bearer sk-or-v1-<key>`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /credits | Account balance (total + used) |
| GET | /keys | List all API keys |
| POST | /keys | Create API key |
| PATCH | /keys/{hash} | Update API key |
| DELETE | /keys/{hash} | Delete API key |
| GET | /keys/{hash} | Get single API key |
| GET | /key | Info on current key (is_management_key flag) |
| GET | /activity | Usage analytics (last 30 days) |
| GET /POST/PATCH/DELETE | /guardrails | Full guardrails CRUD |
| GET | /guardrails/assignments/keys | Guardrail assignments |

Response includes `is_management_key: boolean` — use `GET /api/v1/key` to detect if a key is a management key.

---

## robots.txt

```
User-Agent: *
Allow: /
Disallow: /seo/
Disallow: /uptime
Sitemap: https://openrouter.ai/sitemap.xml
```

---

## Security.txt

Located at: `/.well-known/security.txt`

---

## GraphQL

`POST https://openrouter.ai/graphql` returns 200.
Introspection requires auth. Worth probing with a valid `__session` cookie to discover hidden operations not in the REST API.

---

## Key Opportunities for Automation

1. **Email+password accounts** → Pure HTTP Clerk API → No browser ever needed
2. **Google OAuth accounts** → Playwright for one-time Google OAuth dance → Cache session cookie → Pure HTTP forever
3. **Session cookies expire** → Re-auth via Clerk API (same flow, ~100ms)
4. **Management key creation** → `managementKeys.create` tRPC route exists! → Needs format discovery → Pure HTTP
5. **Code redemption** → `credits.redeemCode` tRPC route exists! → Needs format discovery → Pure HTTP
6. **GraphQL** → May expose hidden operations (worth probing with auth)

---

## tRPC Routes (Discovered)

The following tRPC routes were confirmed to exist (HTTP 200 instead of 404). Full details in `TRPC_ROUTES.md`.

**Critical routes for automation:**
- `managementKeys.create` — Create management keys without browser UI
- `credits.redeemCode` — Redeem promo/credit codes
- `credits.redeem` / `credits.applyCode` / `account.redeem` / `code.redeem` / `voucher.redeem` / `promo.redeem` — Alternative redemption routes

**Utility routes:**
- `user.me` — User profile
- `credits.balance` — Credit balance
- `keys.create` — Create API key (alternative to REST)

**All require:** valid `__session` cookie + correct tRPC batch request format (to be discovered via Playwright or Chrome DevTools network interception).
