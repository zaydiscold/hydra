# Full Recon Results — OpenRouter
> **Date:** 2026-03-30 | **Tools used:** subfinder, httpx, katana, endpoint bruter, JS bundle scraper
> **Tools attempted but hung (Antigravity terminal issue):** waybackurls, gau, nuclei, hakrawler, amass

## ⚠️ Antigravity Terminal Hangups

Several recon tools (waybackurls, gau, nuclei, hakrawler, amass) hung indefinitely in Antigravity's terminal runner. This is an Antigravity platform issue, not a tool issue. These tools work fine in a normal terminal. To run them manually:

```bash
# Run these in a regular terminal — they hang in Antigravity
echo openrouter.ai | waybackurls | sort -u > /tmp/or_wayback.txt
gau openrouter.ai | sort -u > /tmp/or_gau.txt
nuclei -u https://openrouter.ai -severity low,medium,high,critical -o /tmp/or_nuclei.txt
echo https://openrouter.ai | hakrawler -d 2 -subs > /tmp/or_hakrawler.txt
amass enum -passive -d openrouter.ai -o /tmp/or_amass.txt
```

---

## Subfinder — 16 Subdomains

```
accounts.openrouter.ai
argocd.internal.openrouter.ai
auth.services.openrouter.ai
clerk.openrouter.ai
design.openrouter.ai
email-v3.openrouter.ai
eu.openrouter.ai
grafana.internal.openrouter.ai
internal-compete.openrouter.ai
internal.openrouter.ai
status.openrouter.ai
tool-calling.openrouter.ai
tool-playground.openrouter.ai
trust.openrouter.ai
wrapped.openrouter.ai
www.openrouter.ai
```

---

## HTTPX — Live Host Probing (Tech Stack Detection)

| Subdomain | Status | Title | Tech |
|-----------|--------|-------|------|
| tool-playground.openrouter.ai | 200 | My OpenRouter SPA | Cloudflare, Vercel |
| accounts.openrouter.ai | 403 | Just a moment... | Cloudflare Bot Management |
| clerk.openrouter.ai | 200 | — | Cloudflare Bot Management, Google Cloud |
| wrapped.openrouter.ai | 404 | Not Found | Cloudflare |
| email-v3.openrouter.ai | 404 | — | Google Cloud CDN |
| internal.openrouter.ai | 302→200 | **Sign in ・ Cloudflare Access** | Cloudflare Access |
| design.openrouter.ai | 302→200 | **Sign in ・ Cloudflare Access** | Cloudflare Access |
| internal-compete.openrouter.ai | 302→200 | **Sign in ・ Cloudflare Access** | Cloudflare Access |
| trust.openrouter.ai | 200 | Trust center | — |
| status.openrouter.ai | 200 | OpenRouter Status | Cloudflare |
| eu.openrouter.ai | **522** | — | Cloudflare (origin unreachable) |
| www.openrouter.ai | 308→200 | OpenRouter | **Next.js, React, Vercel, Algolia, Google Analytics** |
| tool-calling.openrouter.ai | 200 | Tool Calling Demo | Next.js, React, Vercel |
| argocd.internal.openrouter.ai | 302→302→200 | **Sign in - Google Accounts** | Google SSO |
| grafana.internal.openrouter.ai | 302→302→200 | **Sign in - Google Accounts** | Google SSO |

### Observations
- **3 internal subdomains** behind Cloudflare Access (need employee SSO)
- **2 internal subdomains** behind Google SSO (ArgoCD + Grafana — infrastructure management)
- **eu.openrouter.ai** returns 522 (origin down) — EU region endpoint, possibly deprecated
- **accounts.openrouter.ai** returns 403 with bot management — gated

---

## Katana — 5600+ Crawled URLs (Key Findings)

### New API Endpoints Discovered

```
# Frontend API (public, no auth needed)
/api/frontend/all-providers
/api/frontend/author-models
/api/frontend/llms-full-txt-proxy
/api/frontend/models
/api/frontend/stats/effective-pricing
/api/frontend/stats/endpoint
/api/frontend/stats/latency-comparison
/api/frontend/stats/latency-e2e-comparison
/api/frontend/stats/structured-output-error-rate
/api/frontend/stats/throughput-comparison
/api/frontend/stats/tool-call-error-rate
/api/frontend/stats/top-apps-for-model
/api/frontend/stats/top-colos-for-model
/api/frontend/stats/uptime-hourly
/api/frontend/stats/uptime-recent
/api/frontend/uptime-graphs

# Internal API (likely needs auth)
/api/internal/v1/artificial-analysis-benchmarks
/api/internal/v1/provider-preferences

# Models
/api/models/search?q=
/api/chat/completions

# Admin (probably needs employee access)
/admin-utils/uncategorized-apps
```

### Clerk Auth Endpoints

```
clerk.openrouter.ai/me/passkeys
clerk.openrouter.ai/oauth/authorize
clerk.openrouter.ai/oauth/authorize-with-immediate-redirect
clerk.openrouter.ai/oauth/authorize/continue
clerk.openrouter.ai/oauth/end_session
```

### Settings/Dashboard Pages

```
/settings/credits
/settings/credits?ref=pricing-table-payg
/settings/credits?utm_source=signup-success
/settings/integrations
/settings/keys
/settings/keys?utm_source=signup-success
/settings/preferences
/settings/presets
/settings/privacy
/workspaces/default/keys
/workspaces/default/keys?utm_source=signup-success
```

---

## Endpoint Brute Force — 38 Non-404 Paths

All of these return non-404 (most return 200 with SPA HTML). Ones that are actual API endpoints vs SPA routes need auth testing.

```
/api/v1/credits/redeem      ← potential code redemption
/api/v1/credits/apply        ← potential code application
/api/v1/credits/code         ← potential code endpoint
/api/v1/management-keys      ← management key endpoint!
/api/v1/management           ← management endpoint
/api/v1/mgmt                 ← shorthand management
/api/v1/voucher              ← voucher system
/api/v1/promo                ← promo code system
/api/v1/promo-code           ← promo code
/api/v1/code                 ← generic code
/api/v1/account              ← account info
/api/v1/user                 ← user info
/api/v1/users                ← users list?
/api/v1/me                   ← current user
/api/v1/billing              ← billing info
/api/v1/stripe               ← stripe integration
/api/v1/checkout             ← checkout flow
/api/v1/token                ← token endpoint
/api/v1/tokens               ← tokens list
/api/v1/session              ← session info
/api/v1/sessions             ← sessions list
/api/v1/admin                ← admin endpoint
/api/v1/internal             ← internal endpoint
/api/v1/config               ← configuration
/api/v1/settings             ← settings
/api/v1/models/count         ← model count
/api/v1/providers/list       ← provider list
/api/v1/stats                ← statistics
/api/auth                    ← auth base
/api/auth/me                 ← current auth user
/api/auth/session            ← auth session
/api/auth/keys               ← auth keys
/api/auth/callback           ← OAuth callback
/api/auth/callback/google    ← Google OAuth callback
/api/webhook                 ← webhook endpoint
/api/webhooks                ← webhooks list
/api/events                  ← events endpoint
/_next/data                  ← Next.js ISR data
/api/_next                   ← Next.js internal
```

---

## JS Bundle Analysis

From scraping 37 JS chunks served by the main page:

```
"/api/early_access_features/?token="    ← PostHog feature flags
"/api/frontend/all-providers"
"/api/frontend/llms-full-txt-proxy"
"/api/frontend/models"
"/api/internal/v1/provider-preferences"
"/api/surveys/?token="                  ← PostHog surveys
"/api/v1"                               ← Base API path
"/api/web_experiments/?token="          ← PostHog experiments
```

### Key Observation
The JS bundles reference PostHog analytics endpoints (`early_access_features`, `surveys`, `web_experiments`) — these have token-based auth that's different from the session system and may be exploitable for feature flag enumeration.

---

## Priority Targets for Automation

### Tier 1 — Critical (Direct Automation Value)

| Endpoint | Why | Action Needed |
|----------|-----|---------------|
| `/api/v1/management-keys` | Management key CRUD? | Test with `__session` cookie |
| `/api/v1/credits/redeem` | Code redemption? | Test with auth |
| `/api/auth/me` | Get current user | Test with `__session` |
| `/api/auth/session` | Session info | Test with `__session` |
| `clerk.openrouter.ai/me/passkeys` | Add passkey to account? | Research |

### Tier 2 — Useful Intel

| Endpoint | Why |
|----------|-----|
| `/api/frontend/all-providers` | Provider list (public) |
| `/api/frontend/models` | Model catalog (public) |
| `/api/v1/billing` | Billing info per account |
| `/api/v1/account` | Account metadata |
| `/api/internal/v1/provider-preferences` | Account preferences |

### Tier 3 — Nice to Have

| Endpoint | Why |
|----------|-----|
| `/api/frontend/stats/*` | Performance/pricing data (public) |
| `/workspaces/default/keys` | Workspace key management |
| `/api/v1/config` | Application config |
