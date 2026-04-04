# OpenRouter Selectors Quick Reference

## Authentication Page (Clerk Sign In)

### Input Fields
```javascript
// Email/Identifier
const emailInput = 'input#identifier-field';
const emailInputAlt = 'input[name="identifier"]';
const emailInputAlt2 = '.cl-formFieldInput__identifier';

// Password
const passwordInput = 'input#password-field';
const passwordInputAlt = 'input[name="password"]';
const passwordInputAlt2 = '.cl-formFieldInput__password';
```

### Action Buttons
```javascript
// Continue/Login button
const continueButton = 'button.cl-formButtonPrimary';
const continueButtonAlt = 'button:has-text("Continue")';

// Show password toggle
const showPasswordButton = '.cl-formFieldInputShowPasswordButton';

// Social login buttons
const githubLogin = '.cl-socialButtonsIconButton__github';
const googleLogin = '.cl-socialButtonsIconButton__google';
const metamaskLogin = '.cl-socialButtonsIconButton__metamask';
```

### Form
```javascript
const loginForm = 'form.cl-form';
```

---

## Navigation (Public Pages)

### Main Nav Buttons
```javascript
const navButtons = {
  openrouter: 'button:has-text("OpenRouter")',
  fusion: 'button:has-text("Fusion")',
  models: 'button:has-text("Models")',
  chat: 'button:has-text("Chat")',
  rankings: 'button:has-text("Rankings")',
  apps: 'button:has-text("Apps")',
  enterprise: 'button:has-text("Enterprise")',
  pricing: 'button:has-text("Pricing")',
  docs: 'button:has-text("Docs")'
};
```

### Search
```javascript
const searchInput = 'input[placeholder="Search"]';
const searchToggle = 'button[type="button"]:nth-of-type(11)';
```

### Sign Up
```javascript
const signUpButton = 'button:has-text("Sign Up")';
```

---

## Management Keys Page (Post-Login Predicted)

> Note: Page requires authentication. Selectors below are PREDICTED based on UI patterns.

### Likely Create/Add Buttons
```javascript
const createButton = 'button:has-text("Create")';
const createButtonAlt = 'button:has-text("Add")';
const createButtonAlt2 = 'button:has-text("New")';
const createButtonAlt3 = 'button:has-text("Generate")';
```

### Likely Form Inputs (Predicted)
```javascript
// Key name
const keyNameInput = 'input[name="name"], input#name, input[placeholder*="name" i]';

// Key description
const keyDescriptionInput = 'input[name="description"], textarea[name="description"]';

// Rate limit
const keyLimitInput = 'input[name="limit"], input[type="number"]';

// Labels/Tags
const keyLabelsInput = 'input[name="labels"], input[placeholder*="label" i]';
```

### Likely Modal/Dialog (Predicted)
```javascript
const modal = '[role="dialog"], .modal, [data-testid*="modal"]';
const modalTitle = '[role="dialog"] h2, .modal h2';
const modalCloseButton = '[role="dialog"] button:has-text("Close"), [aria-label="Close"]';
```

### Action Buttons (Predicted)
```javascript
const saveButton = 'button:has-text("Save"), button[type="submit"]';
const cancelButton = 'button:has-text("Cancel")';
const deleteButton = 'button:has-text("Delete")';
const revokeButton = 'button:has-text("Revoke")';
```

---

## Playwright Code Examples

### Login Flow
```javascript
import { chromium } from 'playwright';

async function login(email, password) {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  await page.goto('https://openrouter.ai/sign-in');
  
  // Fill email
  await page.fill('input#identifier-field', email);
  
  // Fill password (if needed)
  await page.fill('input#password-field', password);
  
  // Click continue
  await page.click('button.cl-formButtonPrimary');
  
  // Wait for navigation
  await page.waitForURL('**/settings/**', { timeout: 30000 });
  
  return { browser, page };
}
```

### Wait for React Hydration
```javascript
// Wait for Clerk to initialize
await page.waitForFunction(() => {
  return document.querySelector('.cl-form') !== null;
});

// Or wait for specific elements
await page.waitForSelector('button.cl-formButtonPrimary', { state: 'visible' });
```

### Navigate to Management Keys
```javascript
// After login
await page.goto('https://openrouter.ai/settings/management-keys');

// Wait for page to load
await page.waitForTimeout(3000);

// Check if we're on the right page
const url = page.url();
if (url.includes('/sign-in')) {
  console.log('Still needs login');
}
```

---

## API Endpoints (Alternative to UI)

If UI automation fails, use these API endpoints with the management key:

```javascript
const API_BASE = 'https://openrouter.ai';
const headers = {
  'Authorization': `Bearer ${MANAGEMENT_KEY}`,
  'Content-Type': 'application/json'
};

// List API keys
fetch(`${API_BASE}/api/v1/keys`, { headers });

// Create API key
fetch(`${API_BASE}/api/v1/keys`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ name: 'new-key' })
});

// Get credits
fetch(`${API_BASE}/api/v1/credits`, { headers });
```

---

## Important Notes

1. **NO data-testid attributes** - Use class-based or text-based selectors
2. **Clerk authentication** - UI has `cl-` prefixed classes
3. **Tailwind CSS** - Extensive utility classes, subject to change
4. **Radix UI** - Some components use `radix-` prefixed IDs
5. **Internal classes** - Avoid `cl-internal-*` classes (unstable)

## Class Stability Ranking (Most to Least Stable)

1. **Stable:** `input#identifier-field`, `input#password-field`
2. **Good:** `[name="identifier"]`, `[name="password"]`
3. **Moderate:** `button.cl-formButtonPrimary`
4. **Risky:** `button:has-text("Continue")` (i18n issues)
5. **Avoid:** `.cl-internal-ji79b9` (internal Clerk classes)

---

Generated: 2026-04-03
Account: cecff6a9-cbcc-4110-93ec-409299474b82
