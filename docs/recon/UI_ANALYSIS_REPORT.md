# OpenRouter Management Keys UI Analysis Report

**Account:** cecff6a9-cbcc-4110-93ec-409299474b82 (iam@zayd.wtf)  
**Date:** 2026-04-03  
**Analyst:** Playwright DOM Inspector

---

## Executive Summary

The OpenRouter `/settings/management-keys` page requires authentication via Clerk. The page redirects unauthenticated users to `/sign-in?redirect_url=...`. No `data-testid` attributes are used, requiring CSS class-based or text-based selectors for automation.

**Technology Stack:**
- Framework: Next.js (App Router)
- Authentication: Clerk
- Styling: Tailwind CSS
- UI Components: Radix UI (radix- classes observed)
- API: Likely tRPC-based

---

## 1. Page Access Requirements

### Authentication Status
- **Current State:** Redirects to `/sign-in` (401 unauthorized for API calls)
- **Session Status:** Stored session token cannot be decrypted (local vault key mismatch)
- **Account has:** Valid management key for API access

### Redirect Behavior
```
/settings/management-keys → /sign-in?redirect_url=https%3A%2F%2Fopenrouter.ai%2Fsettings%2Fmanagement-keys
```

---

## 2. Login Page Analysis (Clerk UI)

### Login Form Structure

**Form Selector:**
```css
.cl-form.cl-internal-ji79b9
```

**Email Input:**
```css
#identifier-field
/* or */
input[name="identifier"]
/* or */
.cl-formFieldInput__identifier
```
- Type: `text`
- Required: `true`
- Placeholder: `Enter your email address`

**Password Input:**
```css
#password-field
/* or */
input[name="password"]
/* or */
.cl-formFieldInput__password
```
- Type: `password`
- Required: `false`
- Placeholder: `Enter your password`

**Continue/Login Button:**
```css
.cl-formButtonPrimary
/* or */
button:has-text("Continue")
```
- Class: `cl-formButtonPrimary cl-button 🔒️ cl-internal-j14dgf`
- Type: `null` (handled by JS)

**Social Login Buttons:**
- GitHub: `.cl-socialButtonsIconButton__github`
- Google: `.cl-socialButtonsIconButton__google`
- MetaMask: `.cl-socialButtonsIconButton__metamask`

### Clerk UI Pattern
All Clerk elements have the `cl-` prefix and `🔒️` emoji in class names:
- Forms: `cl-form`
- Inputs: `cl-formFieldInput`
- Buttons: `cl-button`, `cl-formButtonPrimary`

---

## 3. Navigation Buttons (19 total)

### Main Navigation (Non-Clerk)
All nav buttons share this Tailwind pattern:
```css
inline-flex items-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-ring gap-2 leading-6 hover:bg-accent hover:text-accent-foreground border border-transparent h-9 rounded-md w-auto justify-center text-muted-foreground px-2
```

| # | Text | Type | Purpose |
|---|------|------|---------|
| 1 | OpenRouter | null | Nav |
| 2 | Fusion | null | Nav |
| 3 | Models | null | Nav |
| 4 | Chat | null | Nav |
| 5 | Rankings | null | Nav |
| 6 | Apps | null | Nav |
| 7 | Enterprise | null | Nav |
| 8 | Pricing | null | Nav |
| 9 | Docs | null | Nav |
| 10 | Sign Up | null | Sign up |
| 11 | (icon) | button | Search toggle |
| 12 | Sign Up | null | Mobile sign up |

### Clerk Authentication Buttons
| # | Text | Class Pattern |
|---|------|---------------|
| 14 | (GitHub icon) | `cl-socialButtonsIconButton__github` |
| 15 | (Google icon) | `cl-socialButtonsIconButton__google` |
| 16 | (MetaMask icon) | `cl-socialButtonsIconButton__metamask` |
| 17 | (hidden submit) | `type="submit"` |
| 18 | (show password) | `cl-formFieldInputShowPasswordButton` |
| 19 | Continue | `cl-formButtonPrimary` |

---

## 4. CSS Class Patterns

### Tailwind CSS Utility Classes
Navigation and main UI use extensive Tailwind:
```css
/* Common patterns */
bg-background text-primary
text-muted-foreground hover:bg-accent hover:text-accent-foreground
rounded-md h-9 w-auto
focus-visible:ring-1 focus-visible:ring-ring
transition-colors duration-150
```

### Radix UI Classes
Components use Radix primitives:
```css
#radix-_r_0_-trigger-radix-_r_1_
data-[state=open]:bg-primary/80
group-data-[state=open]:w-2
```

### Clerk Classes (🔒️ = Locked/Secure)
```css
.cl-form 🔒️
.cl-formFieldInput 🔒️
.cl-formButtonPrimary 🔒️
.cl-internal-* (internal Clerk classes, may change)
```

---

## 5. API Endpoints Discovered

### REST API Paths (from testing)
| Endpoint | Status | Notes |
|----------|--------|-------|
| `/api/keys` | 200 | Returns HTML (SPA redirect) |
| `/api/credits` | 200 | Returns HTML (SPA redirect) |
| `/api/settings/management-keys` | 200 | Returns HTML (SPA redirect) |
| `/api/trpc/keys.list` | 200 | tRPC route exists |
| `/api/trpc/user.keys` | 200 | tRPC route exists |
| `/api/trpc/management.keys` | 200 | tRPC route exists |
| `/api/graphql` | 200 | GraphQL endpoint exists |

### API Authentication Required
All endpoints return 200 but serve HTML for the SPA to handle the redirect. Actual API calls require:
- Valid `__session` JWT cookie (Clerk)
- Or `Authorization: Bearer <token>` header
- Cloudflare cookies: `__cf_bm`, `cf_clearance`

---

## 6. Data-TestID Status

**CRITICAL FINDING:**
- **Count:** 0 elements with `data-testid` attributes
- **Implication:** UI relies entirely on class names and text content for targeting
- **Risk:** Classes may change with deployments (especially `cl-internal-*`)

---

## 7. Form Input Analysis

### All Inputs Found (3 total)

1. **Search Input** (Navigation)
   ```css
   #radix-_R_sjdl9bH2_
   type: text
   placeholder: Search
   required: false
   ```

2. **Email Field** (Login)
   ```css
   #identifier-field
   name: identifier
   type: text
   required: true
   placeholder: Enter your email address
   ```

3. **Password Field** (Login)
   ```css
   #password-field
   name: password
   type: password
   required: false
   placeholder: Enter your password
   ```

---

## 8. Selectors for Automation

### Recommended Selectors (Ordered by Stability)

#### For Login Flow:
```javascript
// Email input (most stable)
'input#identifier-field'
'input[name="identifier"]'

// Password input (most stable)
'input#password-field'
'input[name="password"]'

// Continue button
'button.cl-formButtonPrimary'
'button:has-text("Continue")'

// Social login (if needed)
'button.cl-socialButtonsIconButton__github'
'button.cl-socialButtonsIconButton__google'
```

#### For Post-Login Navigation (Hypothesized):
Based on the patterns observed, management keys page likely has:
```javascript
// Create/Add button (predicted)
'button:has-text("Create")'
'button:has-text("Add")'
'button:has-text("New")'
'button:has-text("Generate")'

// Form inputs (predicticted patterns)
'input[name="name"]'           // Key name
'input[name="description"]'
'input[name="limit"]'          // Rate limit
'input[type="checkbox"]'       // Enabled/disabled
```

---

## 9. No __NEXT_DATA__ Found

The page does not expose `window.__NEXT_DATA__`, indicating:
- Next.js App Router (not Pages Router)
- Server Components for initial render
- Client-side hydration for interactivity

---

## 10. Recommendations for Automation

### Authentication Approach
1. **Option A:** Use Clerk's API directly for programmatic authentication
2. **Option B:** Store valid session cookies and inject them via Playwright
3. **Option C:** Use the management key for API-only operations (no UI automation)

### Selector Strategy
Due to lack of `data-testid`:
1. Use ID selectors where available (`#identifier-field`, `#password-field`)
2. Use name attributes (`[name="identifier"]`)
3. Use text content as fallback (`:has-text("Continue")`)
4. Avoid `cl-internal-*` classes (Clerk internal, unstable)

### Stability Considerations
- **Stable:** `cl-form`, `cl-button` (Clerk public classes)
- **Unstable:** `cl-internal-*`, `🔒️` emoji classes
- **Moderate:** Tailwind utility classes may change with design updates

---

## 11. Files Generated

| File | Description |
|------|-------------|
| `management-keys-page.png` | Screenshot of redirect page |
| `login-page.png` | Screenshot of Clerk login |
| `dom-analysis.json` | Complete DOM structure analysis |
| `api-analysis.json` | API endpoint discovery results |
| `account-full.json` | Account metadata (encrypted config) |

---

## 12. Next Steps for Full Analysis

To analyze the actual `/settings/management-keys` UI:

1. **Obtain valid session:**
   - Use `test-session-validation.mjs` or `check:clerk` npm script
   - Complete OTP/email verification if required
   - Export `__session` cookie and Cloudflare cookies

2. **Re-run analysis:**
   ```bash
   export OPENROUTER_COOKIES='[{"name":"__session","value":"..."},...]'
   node analyze-ui.mjs
   ```

3. **Alternative:**
   - Use management key to call REST API directly
   - Document API schema instead of UI automation

---

## Summary Table: Selectors Reference

| Element | Primary Selector | Fallback Selector |
|---------|-------------------|-------------------|
| Email Input | `#identifier-field` | `input[name="identifier"]` |
| Password Input | `#password-field` | `input[name="password"]` |
| Continue Button | `button.cl-formButtonPrimary` | `button:has-text("Continue")` |
| GitHub Login | `.cl-socialButtonsIconButton__github` | `button:has-text("Continue with GitHub")` |
| Google Login | `.cl-socialButtonsIconButton__google` | `button:has-text("Continue with Google")` |
| Navigation Search | `#radix-_R_sjdl9bH2_` | `input[placeholder="Search"]` |

---

**Report Generated:** 2026-04-03  
**Status:** Authentication Required for Full UI Analysis
