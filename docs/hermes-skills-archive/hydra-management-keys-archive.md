---
name: hydra-openrouter-management-keys
title: Hydra OpenRouter Management Key Automation
description: Complete workflow for automating OpenRouter management key provisioning in Hydra router, including session persistence, cookie handling, encrypted storage, and UI integration.
triggers:
  - hydra openrouter
  - management key provision
  - clerk session cookie
  - playwright automation
  - key storage encryption
  - session validation
---

# Hydra OpenRouter Management Key Automation

Use this skill when automating OpenRouter management key workflows in Hydra, including session validation, Playwright provisioning, encrypted storage, and UI integration.

## Prerequisites

- Hydra router running locally (~/Desktop/hydra)
- OpenRouter accounts with valid sessions
- Prisma database configured
- Playwright installed

## Phase 1: Session Audit

Check all account sessions for validity:

```javascript
const accounts = await prisma.account.findMany();
for (const acc of accounts) {
  try {
    const session = storage.decrypt(acc.sessionToken);
    const config = JSON.parse(storage.decrypt(acc.config));
    console.log(`${acc.alias}: Session ${session.length > 50 ? "✅" : "❌"}`);
  } catch(e) {
    console.log(`${acc.alias}: ❌ Decrypt failed`);
  }
}
```

## Phase 2: Live Validation

Test sessions against OpenRouter:

```javascript
const res = await fetch("https://openrouter.ai/settings/management-keys", {
  headers: { "Cookie": `__session=${session}; ${clientCookie}` },
  redirect: "manual"
});
// 200 = valid, 302 to login = expired
```

## Phase 3: Provision & Store

```javascript
// Provision via Playwright (free, headless)
const result = await dashboardApi.createManagementKey(deviceId, accountId, keyName);

// Store encrypted
await storeManagementKey(accountId, result.key, name, { 
  provisionedAt: new Date().toISOString() 
});
```

## Critical Cookie Bugs (Check These!)

1. **Duplicate cookies** - Ensure `__client` and `__client_uat` aren't added twice
2. **Missing filterFn** - `mergeDeviceJar()` must pass filterFn to internal function
3. **HTML responses** - tRPC may return HTML instead of JSON

## Required API Endpoints

- `GET /api/accounts/:id/management-keys` - List (preview only)
- `GET /api/accounts/:id/management-keys/best` - Get full key
- `POST /api/accounts/:id/management-keys/store` - Manual store

## Pitfalls

- Account lockouts require 60min cooldown after repeated attempts
- Sessions last ~7 days; implement refresh
- Never expose full keys in list endpoints
- Cloudflare cookies (`__cf_bm`, `_cfuvid`) required

## CRITICAL: Storage System Migration (Don't Skip!)

When migrating from old storage (Account.config) to new storage (ManagementKey table), you MUST check for remnants:

### The Bug We Found
`persistProvisionedManagementKey()` was only saving to old config, but API endpoints read from new table - causing keys to disappear!

### Remnant Hunt Checklist
Search for these patterns and update ALL of them:

```bash
grep -r "config\.managementKey" server/
grep -r "account\.managementKey" server/
grep -r "updateAccountManagementKey" server/
grep -r "managementKey.*config" server/
```

### 3 Critical Places to Fix

1. **verifyOTP** - Auto-provision decision
   ```javascript
   // BEFORE (old - uses config):
   const acct = await store.getAccountWithKey(userId, accountId);
   if (!acct.managementKey) { /* provision */ }
   
   // AFTER (new - uses table):
   const { getManagementKeys } = await import('../services/management-key-store.js');
   const existingKeys = await getManagementKeys(accountId);
   if (existingKeys.length === 0) { /* provision */ }
   ```

2. **getSnapshot** - Key existence and preview
   ```javascript
   // BEFORE (old):
   const account = await store.getAccountWithKey(req.user.id, req.params.id);
   if (!account.managementKey) return error;
   const snapshot = await openrouter.getAccountSnapshot(account.managementKey);
   const preview = account.managementKey.slice(0, 16) + '...';
   
   // AFTER (new):
   const { getBestManagementKey } = await import('../services/management-key-store.js');
   const bestKey = await getBestManagementKey(req.params.id);
   if (!bestKey) return error;
   const snapshot = await openrouter.getAccountSnapshot(bestKey.key);
   const preview = bestKey.key.slice(0, 16) + '...';
   ```

3. **persistProvisionedManagementKey** - MUST save to BOTH systems
   ```javascript
   async function persistProvisionedManagementKey(userId, accountId, key, source) {
     // 1. Legacy: Account config (backward compatibility)
     await store.updateAccountManagementKey(userId, accountId, key);
     
     // 2. New: ManagementKey table (for API endpoints)
     await storeManagementKey(accountId, key, `Hydra Auto Key (${source})`);
     
     // 3. Verify
     const saved = await store.getAccountWithKey(userId, accountId);
     if (!saved?.managementKey || saved.managementKey !== key) {
       throw new Error('Management key was created but could not be persisted');
     }
   }
   ```

### Migration Script
```javascript
import * as store from './server/services/store.js';
import { storeManagementKey } from './server/services/management-key-store.js';

async function migrateExistingKeys() {
  const accounts = await store.getAccounts(userId);
  
  for (const acc of accounts) {
    const full = await store.getAccountWithKey(userId, acc.id);
    
    if (full.managementKey?.startsWith('sk-or-v1-')) {
      try {
        await storeManagementKey(acc.id, full.managementKey, 'Hydra Auto Key (migrated)');
        console.log(`✅ Migrated ${acc.alias}`);
      } catch(e) {
        console.log(`❌ ${acc.alias}: ${e.message}`);
      }
    }
  }
}
```

### Testing After Migration
```javascript
// Test all 3 APIs work with table
const list = await fetch(`/api/accounts/${id}/management-keys`);
const best = await fetch(`/api/accounts/${id}/management-keys/best`);
const snap = await fetch(`/api/accounts/${id}/snapshot`);

console.log('List:', list.data?.keys?.length, 'keys');
console.log('Best:', best.success ? '✅' : '❌');
console.log('Snapshot:', snap.data?.managementKeyPreview);
```

### Key Insight
- Old system: `config.managementKey` (single key, stored in Account table)
- New system: `ManagementKey` table (multiple keys, separate table)
- During transition: Save to BOTH, read from NEW table only
- Migration: Move existing keys from config to table

## Phase 4: Management Key Storage System (New)

Store provisioned keys encrypted in database with full UI integration:

### Database Schema
```prisma
model ManagementKey {
  id            String   @id @default(uuid())
  accountId     String
  account       Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  encryptedKey  String   // sk-or-v1-... (encrypted)
  name          String
  status        String   @default("active")
  metadata      String?  // JSON
  lastUsedAt    DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### Storage Service (server/services/management-key-store.js)
```javascript
export async function storeManagementKey(accountId, key, name, metadata = {}) {
  if (!key?.startsWith('sk-or-v1-')) throw new Error('Invalid key format');
  const encryptedKey = encrypt(key);
  return await prisma.managementKey.create({
    data: { id: crypto.randomUUID(), accountId, encryptedKey, name, 
            status: 'active', metadata: metadata ? JSON.stringify(metadata) : null }
  });
}

export async function getManagementKeys(accountId) {
  const keys = await prisma.managementKey.findMany({ where: { accountId } });
  return keys.map(k => ({ ...k, key: decrypt(k.encryptedKey) }));
}

export async function getBestKey(accountId) {
  const key = await prisma.managementKey.findFirst({
    where: { accountId, status: 'active' },
    orderBy: { createdAt: 'desc' }
  });
  return key ? { ...key, key: decrypt(key.encryptedKey) } : null;
}

/**
 * Get the best (most recently used or newest) management key for an account
 * CRITICAL: Use this instead of config.managementKey in all read operations!
 * This prevents the old/new storage system conflict bug.
 * @param {string} accountId
 * @returns {Object|null} Best key with decrypted value, or null if none
 */
export async function getBestManagementKey(accountId) {
  // First try to find an active key that was recently used
  let key = await prisma.managementKey.findFirst({
    where: { accountId, status: 'active' },
    orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }]
  });
  
  // If no used key, get the newest active key
  if (!key) {
    key = await prisma.managementKey.findFirst({
      where: { accountId, status: 'active' },
      orderBy: { createdAt: 'desc' }
    });
  }
  
  if (!key) return null;

  return {
    id: key.id,
    accountId: key.accountId,
    key: decrypt(key.encryptedKey),
    name: key.name,
    status: key.status,
    metadata: key.metadata ? JSON.parse(key.metadata) : null,
    lastUsedAt: key.lastUsedAt,
    createdAt: key.createdAt
  };
}

export async function provisionAndStoreKey(deviceId, accountId, name) {
  const result = await createManagementKey(deviceId, accountId, name);
  if (!result.key) throw new Error(`Provisioning failed: ${result.message}`);
  const stored = await storeManagementKey(accountId, result.key, name, {
    provisionedAt: new Date().toISOString(), via: result.source || 'playwright'
  });
  return { ...stored, key: result.key };
}
```

### API Endpoints
```javascript
// server/controllers/AccountController.js - add to provision()
if (result.key) {
  try {
    const { storeManagementKey } = await import('../services/management-key-store.js');
    await storeManagementKey(req.params.id, result.key, keyName || 'Management Key', {
      provisionedAt: new Date().toISOString(), via: result.source || 'playwright'
    });
  } catch (storeErr) {
    console.error('[provision] Failed to store key:', storeErr.message);
  }
}

// New endpoints in server/routes/accounts.js
router.get('/:id/management-keys', requireUnlocked, controller.listManagementKeys);
router.get('/:id/management-keys/best', requireUnlocked, controller.getBestManagementKey);
router.post('/:id/management-keys/store', requireUnlocked, controller.storeProvisionedKey);
```

### UI Integration (src/pages/AccountDetail.jsx)
```javascript
// Add state
const [managementKeys, setManagementKeys] = useState([]);
const [loadingMgmtKeys, setLoadingMgmtKeys] = useState(false);

// Fetch function
const fetchManagementKeys = useCallback(async () => {
  if (!resolvedAccountId) return;
  setLoadingMgmtKeys(true);
  try {
    const res = await api.getManagementKeys(resolvedAccountId);
    setManagementKeys(res.data?.keys || []);
  } catch (err) {
    console.error('[ACCOUNT_DETAIL] Failed to fetch management keys:', err.message);
  } finally {
    setLoadingMgmtKeys(false);
  }
}, [resolvedAccountId]);

// UI Section (after snapshot.managementKeyPreview)
{managementKeys.length > 0 && (
  <div style={{ marginBottom: 'var(--space-md)', padding: '10px', 
                background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>
        Stored Management Keys ({managementKeys.length})
      </span>
      <button onClick={fetchManagementKeys} disabled={loadingMgmtKeys}>↻ Refresh</button>
    </div>
    {managementKeys.map((key) => (
      <div key={key.id} style={{ display: 'flex', gap: 8, padding: '6px 8px' }}>
        <span>{key.name}</span>
        <span style={{ color: 'var(--status-success)', marginLeft: 'auto' }}>{key.status}</span>
        <code>{key.preview}</code>
        <span>{formatDate(key.createdAt)}</span>
      </div>
    ))}
  </div>
)}
```

### API Functions (src/api.js)
```javascript
export const getManagementKeys = (accountId) => 
  request(`/accounts/${accountId}/management-keys`);
export const getBestManagementKey = (accountId) => 
  request(`/accounts/${accountId}/management-keys/best`);
export const storeManagementKey = (accountId, key, name, metadata) =>
  request(`/accounts/${accountId}/management-keys/store`, 
    { method: 'POST', body: { key, name, metadata } });
```

## Phase 5: Pool Manager Hardening (New)

Keys automatically dropped from rotation after repeated failures:

### rotation-manager.js Changes
```javascript
const MAX_RETRIES = 10;                // Drop key after 10 consecutive PROXY failures
const MAX_LOGIN_ATTEMPTS = 4;          // Block auth after 4 consecutive LOGIN failures
const LOGIN_COOLDOWN = 60 * 60 * 1000; // 1 hour cooldown

class RotationManager {
  constructor() {
    this.failureCounts = new Map();      // hash → proxy failures
    this.loginAttempts = new Map();      // accountId → auth attempts
    // ... rest of constructor
  }

  async recordFailure(hash, httpStatus) {
    const current = (this.failureCounts.get(hash) || 0) + 1;
    this.failureCounts.set(hash, current);
    logger.warn(`[POOL] Key ${hash.slice(0, 8)}… failure #${current}/${MAX_RETRIES}`);
    
    // Apply cooldown for 429/402
    if (httpStatus === 429 || httpStatus === 402) {
      this.applyCooldown(hash, httpStatus);
    }
    
    // Drop after max retries
    if (current >= MAX_RETRIES) {
      await this.dropFromPool(hash, `exceeded ${MAX_RETRIES} consecutive failures`);
      return true; // was dropped
    }
    return false; // still in pool
  }

  recordSuccess(hash) {
    if (this.failureCounts.has(hash)) {
      this.failureCounts.delete(hash); // Reset on success
    }
  }

  async dropFromPool(hash, reason) {
    await prisma.key.update({ where: { hash }, data: { isPooled: false } });
    this.pool = this.pool.filter(k => k.hash !== hash);
    this.failureCounts.delete(hash);
    this.cooldowns.delete(hash);
    logger.error(`[POOL] Key ${hash.slice(0, 8)}… DROPPED from pool: ${reason}`);
  }
}
```

### Proxy Integration (server/routes/proxy.js)
```javascript
// On successful request
rotationManager.recordSuccess(keyEntry.hash);

// On error
if (upstreamRes.status === 429) {
  await rotationManager.recordFailure(keyEntry.hash, 429);
  // ... continue to next key
}
if (upstreamRes.status >= 500 && upstreamRes.status < 600) {
  const wasDropped = await rotationManager.recordFailure(keyEntry.hash, upstreamRes.status);
  // Only do model fallback if key wasn't dropped
  if (!wasDropped && !fallbackModel && baseBody?.model) {
    // Try fallback model
  }
}
```

## Phase 6: Google OAuth Edge Case (/factor-one)

Google OAuth accounts redirect to `/sign-in/factor-one` requiring OTP:

### Detection in Playwright (server/services/dashboard-api.js)
```javascript
await page.goto(`${OR_BASE}/settings/management-keys`, { ... });

// Check for Google OAuth factor-one page
const currentUrl = page.url();
if (currentUrl.includes('/sign-in/factor-one')) {
  provisionStepLog(accountId, 'Detected /sign-in/factor-one (Google OAuth needs OTP)');
  
  // Try to click "Use another method" → OTP
  const useAnotherMethodBtn = page.locator('button:has-text("Use another method")').first();
  if (await useAnotherMethodBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await useAnotherMethodBtn.click();
    await page.waitForTimeout(2000);
    
    // Check for OTP input
    const otpInput = page.locator('input[autocomplete="one-time-code"], ...').first();
    if (await otpInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      throw new Error('GOOGLE_OAUTH_REQUIRES_OTP: Use "Login Account" flow with OTP first');
    }
  }
  
  throw new Error(
    'GOOGLE_OAUTH_REQUIRES_OTP: This account uses Google OAuth and requires OTP verification. ' +
    'Use the "Login Account" flow with the 6-digit OTP code from your email first.'
  );
}
```

### User-Friendly Error Message (src/api.js)
```javascript
export function formatApiErrorMessage(err) {
  if (err.message?.includes('GOOGLE_OAUTH_REQUIRES_OTP')) {
    return 'This Google OAuth account requires OTP verification before provisioning.\n\n' +
           'Steps to fix:\n' +
           '1. Click "Authenticate" on this account\n' +
           '2. Select "Email OTP" method\n' +
           '3. Enter the 6-digit code from your email\n' +
           '4. Once authenticated, retry "Provision Key"';
  }
  // ... rest of function
}
```

## Phase 7: Login Attempt Limiting (Critical!)

**PROBLEM**: Repeated login attempts can lock accounts (like delilah-zayd.wtf). Proxy key failures and login attempts need DIFFERENT limits.

### Two Separate Limits

| Concern | Limit | Applies To |
|---------|-------|------------|
| **Proxy Key Failures** | MAX_RETRIES = 10 | 429, 402, 401, 5xx errors during proxy |
| **Login Attempts** | MAX_LOGIN_ATTEMPTS = 4 | Password login, OTP requests, admin panel |

### Why Different?
- **Keys**: Should tolerate transient failures (10 retries before dropping from pool)
- **Accounts**: Must protect against lockout (4 attempts = 1 hour cooldown)

### Implementation

```javascript
// rotation-manager.js
const MAX_RETRIES = 10;                // Proxy key failures
const MAX_LOGIN_ATTEMPTS = 4;          // Auth attempts
const LOGIN_COOLDOWN = 60 * 60 * 1000; // 1 hour

class RotationManager {
  constructor() {
    this.failureCounts = new Map();      // hash → proxy failures
    this.loginAttempts = new Map();      // accountId → auth attempts
    // ...
  }

  // For proxy key failures (high tolerance)
  async recordFailure(hash, httpStatus) {
    const current = (this.failureCounts.get(hash) || 0) + 1;
    this.failureCounts.set(hash, current);
    
    if (current >= MAX_RETRIES) {
      await this.dropFromPool(hash, `exceeded ${MAX_RETRIES} consecutive failures`);
      return true; // was dropped
    }
    return false;
  }

  // For login/auth attempts (protect accounts)
  recordLoginAttempt(accountId) {
    const now = Date.now();
    const record = this.loginAttempts.get(accountId) || { count: 0, lastAttempt: 0 };
    
    // Reset if > 1 hour since last attempt
    if (now - record.lastAttempt > LOGIN_COOLDOWN) {
      record.count = 0;
    }
    
    record.count += 1;
    record.lastAttempt = now;
    this.loginAttempts.set(accountId, record);
    
    const allowed = record.count <= MAX_LOGIN_ATTEMPTS;
    
    if (!allowed) {
      logger.error(`[LOGIN] Account ${accountId.slice(0, 8)}… BLOCKED after ${MAX_LOGIN_ATTEMPTS} attempts`);
    }
    
    return {
      allowed,
      remaining: Math.max(0, MAX_LOGIN_ATTEMPTS - record.count),
      cooldown: !allowed ? LOGIN_COOLDOWN : null
    };
  }

  resetLoginAttempts(accountId) {
    this.loginAttempts.delete(accountId);
  }
}
```

### Account Login Integration (server/controllers/AccountController.js)

```javascript
async login(req, res) {
  const { rotationManager } = await import('../services/rotation-manager.js');
  
  // Check attempt limit
  const loginCheck = rotationManager.recordLoginAttempt(req.params.id);
  if (!loginCheck.allowed) {
    return this.error(
      res,
      `Too many failed login attempts. Wait ${Math.ceil(loginCheck.cooldown / 60000)} minutes.`,
      429,
      'LOGIN_RATE_LIMITED'
    );
  }
  
  try {
    const session = await clerkAuth.signInWithPassword(email, password);
    // Success - reset counter
    rotationManager.resetLoginAttempts(req.params.id);
    return this.success(res, { sessionExpiry: session.sessionExpiry, status: 'active' });
  } catch (err) {
    // Failure counted, will block after 4 attempts
    return this.error(res, err.message, 401);
  }
}

async startOTP(req, res) {
  const { rotationManager } = await import('../services/rotation-manager.js');
  
  const loginCheck = rotationManager.recordLoginAttempt(req.params.id);
  if (!loginCheck.allowed) {
    return this.error(res, `Too many OTP requests. Wait 1 hour.`, 429, 'OTP_RATE_LIMITED');
  }
  
  // ... send OTP
}

async verifyOTP(req, res) {
  try {
    const session = await clerkAuth.completeEmailOTP(signInId, code, clientCookie);
    // Success - reset counter
    const { rotationManager } = await import('../services/rotation-manager.js');
    rotationManager.resetLoginAttempts(req.params.id);
    return this.success(res, { sessionExpiry: session.sessionExpiry, status: 'active' });
  } catch (err) {
    return this.error(res, err.message, 401);
  }
}
```

### Admin Panel Protection (server/controllers/AuthController.js)

```javascript
async login(req, res) {
  const { rotationManager } = await import('../services/rotation-manager.js');
  
  // IP-based tracking for admin logins
  const clientId = req.ip || req.connection?.remoteAddress || 'admin';
  const loginCheck = rotationManager.recordLoginAttempt(`admin:${clientId}`);
  
  if (!loginCheck.allowed) {
    return this.error(
      res,
      `Too many failed login attempts. Wait ${Math.ceil(loginCheck.cooldown / 60000)} minutes.`,
      429,
      'LOGIN_RATE_LIMITED'
    );
  }
  
  try {
    const token = await auth.login(password);
    rotationManager.resetLoginAttempts(`admin:${clientId}`);
    return this.success(res, { token });
  } catch (err) {
    return this.error(res, err.message, 401);
  }
}
```

### Key Insight
- **Proxy**: 10 failures = drop key (availability over preservation)
- **Auth**: 4 failures = 1hr cooldown (preservation over availability)
- Always reset on success
- 1-hour auto-reset prevents permanent lockout

## Ralph Loop (Development Methodology)

Named after the user-agent collaboration pattern. When user says "continue the loop" or "Ralph loop":

### Phase Sequence
1. **Commit current state** - `git add -A && git commit -m "..."`
2. **Identify next edge case** - What could break? What haven't we tested?
3. **Implement fix/feature** - Code the solution
4. **Test end-to-end** - Verify working with real accounts
5. **Commit** - Document what was done
6. **Repeat** - Next phase

### Current Status (2025-04-05)

**Working Accounts (Sessions Valid)**:
| Account | Email | Status | Mgmt Key |
|---------|-------|--------|----------|
| iam-zayd.wtf | iam@zayd.wtf | ✅ Active | ✅ Stored |
| zayd-zayd.wtf | zayd@zayd.wtf | ✅ Active | ✅ Stored |
| admin-zayd.world | **admin@zayd.world** | ⏳ Testing | ⏳ Needs OTP |
| delilah-zayd.wtf | delilah@zayd.wtf | 🔒 Locked | ⏳ Retry ~40min |

**Phases Completed**:
1. ✅ Session persistence (Cloudflare cookies fixed)
2. ✅ Playwright provisioning (working end-to-end)
3. ✅ Management key storage (encrypted, UI integrated)
4. ✅ Pool manager hardening (MAX_RETRIES = 10)
5. ✅ Google OAuth edge case (/factor-one detection)
6. ✅ Login attempt limiting (MAX_LOGIN_ATTEMPTS = 4)

**Next Test**: admin@zayd.world - Send OTP code when ready

### Testing Commands

```bash
# Check all accounts
sqlite3 prisma/dev.db "SELECT id, alias, config FROM Account"

# Test specific account session
curl -s http://localhost:3001/api/accounts/<id>/snapshot \
  -H "Authorization: Bearer <token>" | jq '.data.sessionStatus'

# Start OTP for testing
node complete-otp.js <alias> <6-digit-code>

# Monitor logs
tail -f /tmp/hydra-dev.log | grep -E "(provision|key|login|session)"
```

### API Response Format (IMPORTANT!)

The management keys API returns a nested structure - not the standard format:

```javascript
// ❌ WRONG - This is what most endpoints return
{ success: true, data: [...] }

// ✅ CORRECT - Management keys endpoint returns:
{ success: true, data: { keys: [...] } }

// Code must extract properly:
const keys = response.data.success && response.data.data?.keys;
if (Array.isArray(keys)) {
  // Process keys
}
```

### Testing CRUD & Persistence (Full Verification)

To verify accounts and management keys survive server restart:

```javascript
// test-account-crud.mjs - Pre-restart verification
const results = {
  login: await testLogin(),                    // Get JWT token
  accounts: await testListAccounts(token),      // Verify API access
  listKeys: await testListKeys(token),          // Should return { data: { keys: [...] } }
  createKey: await testCreateKey(token),        // POST /management-keys/store
  verifyCreated: await testKeyInList(token, id), // Verify appears in list
  revokeKey: await testRevokeKey(id),           // Soft delete (status: 'revoked')
  verifyRevoked: await testKeyRevoked(token, id), // Should not appear or be marked revoked
  persistenceKey: await testCreateKey(token),   // Create key to test after restart
};

// Stop server, verify DB, restart, re-run tests
```

### Persistence Verification Workflow

```bash
# 1. Check server is running
lsof -i :3001

# 2. Run CRUD tests
node test-account-crud.mjs

# 3. Stop server
kill <PID>

# 4. Verify database intact
sqlite3 prisma/dev.db "SELECT id, alias FROM Account;"
sqlite3 prisma/dev.db "SELECT id, name, status FROM ManagementKey;"

# 5. Restart server
npm run server &
sleep 5

# 6. Run persistence tests
node test-restart-persistence.mjs
# - Verifies accounts still exist
# - Verifies management keys persisted
# - Verifies new login works
# - Verifies CRUD works after restart
```

### Key Revocation (Soft Delete Pattern)

Keys are NOT hard-deleted - they use status field for audit trail:

```javascript
// Revoke (don't delete!)
await prisma.managementKey.update({
  where: { id: keyId },
  data: { status: 'revoked', updatedAt: new Date() }
});

// List only shows active keys by default
const activeKeys = await prisma.managementKey.findMany({
  where: { accountId, status: 'active' }
});

// Best key endpoint filters out revoked
const best = await prisma.managementKey.findFirst({
  where: { accountId, status: 'active' },
  orderBy: { createdAt: 'desc' }
});
```

### Triple-Check Pattern

When verifying sessions work:
1. **Database check** - Session token exists and decrypts
2. **API check** - Snapshot returns valid status
3. **Live check** - Actually use session against OpenRouter API

```javascript
// Triple check implementation
const session = await store.getAccountSession(userId, accountId);
const decrypted = storage.decrypt(session.sessionToken);

// Check 1: Has token
console.log('Check 1 - Has token:', decrypted.length > 50);

// Check 2: API returns valid
const snapshot = await fetch(`/api/accounts/${id}/snapshot`, { headers: { Authorization: `Bearer ${token}` }});
console.log('Check 2 - API valid:', snapshot.data?.sessionStatus === 'active');

// Check 3: Live test against OpenRouter
const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
  headers: { Authorization: `Bearer ${decrypted}` }
});
console.log('Check 3 - Live valid:', res.status === 200);
```---
---
name: hydra-openrouter-session-debugging
title: Hydra OpenRouter Session & tRPC Debugging
description: Systematic debugging of Clerk session handling and tRPC authentication for OpenRouter management key provisioning
version: 1.0
tags: [hydra, openrouter, clerk, session, trpc, authentication, debugging]
---

# Hydra OpenRouter Session & tRPC Debugging

Systematic approach to debugging Clerk session handling and tRPC authentication issues in Hydra (OpenRouter management key provisioning).

## Common Issues & Solutions

### 1. Session Validity Bug
**Problem**: `isSessionValid()` rejected sessions with <10 minutes remaining
```javascript
// WRONG - rejects short-lived OTP sessions
return expiry - now > SESSION_EXPIRING_SOON_MS;  // 10 min threshold

// CORRECT - session valid if any time remains
return expiry > now;
```
**Fix**: Change validation to allow short-lived sessions (OTP sessions are ~60 seconds).

### 2. OTP Session Timing - Fresh JWT Required (CRITICAL UPDATE 2025-04-03)

**Discovery**: OTP-created sessions have ~60 second JWT lifetime, BUT the underlying session lasts **7 HOURS (420 minutes)**
- The JWT expires quickly (60s) but the session stays active server-side for 7 hours
- **SOLUTION**: Call `/client` endpoint to get a fresh JWT BEFORE each API call
- The fresh JWT has another 60s, giving enough time to complete tRPC calls

**Test Result (2025-04-03)**: Fresh OTP account
```
Session Expiry: 2026-04-03T23:31:10Z
Minutes until expiry: 420 (7 hours)
Provisioning: SUCCESS via Playwright
Key: sk-or-v1-e7e...367
```

**The 1-minute confusion explained**: JWT token expires in 60s, but the SESSION (the `__client` cookie + session binding) lasts 7 hours. Your browser stays logged in because the session is durable - we just need fresh JWTs for API calls.

**New approach - getFreshJwt()**:
```javascript
async function getFreshJwt(sessionCookie, clientCookie) {
  const res = await fetch('https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0', {
    headers: { 'Cookie': `__session=${sessionCookie}; ${clientCookie}` }
  });
  const data = await res.json();
  return data?.response?.sessions?.[0]?.last_active_token?.jwt;
}
```

**Updated trpcCall()**:
```javascript
async function trpcCall(route, input, sessionCookie, clientCookie) {
  const freshJwt = await getFreshJwt(sessionCookie, clientCookie);
  const jwtToUse = freshJwt || sessionCookie;
  // Use jwtToUse in Cookie header instead of original sessionCookie
}
```

**Provisioning strategy**:
1. Get fresh JWT before tRPC call
2. Make API call within 60s window
3. If fails, try REST API fallback
4. Finally fall back to browser automation with fresh JWT

**Timeline with fresh JWT**:
```
T+0s    Get fresh JWT from /client (expires T+60s)
T+1s    Make tRPC call with fresh JWT
T+2s    Complete provisioning
T+60s   JWT expires (already done)
```

**Old problem**: Session "validity" was misconfigured - `isSessionValid()` required >10 minutes remaining
**New solution**: Don't rely on stored JWT - always get fresh one from `/client` before API calls

### 3. Cookie Formatting for tRPC
**Required cookies for OpenRouter tRPC**:
- `__session` - JWT session token
- `__client` - Clerk device cookie
- `__client_uat` - Clerk user agent token
- `__cf_bm`, `_cfuvid` - Cloudflare cookies

**Format**: `__session=<jwt>; __client=<device>; __client_uat=<timestamp>; __cf_bm=<cf>; _cfuvid=<cf>`

**Common bugs**:
- Duplicate cookies (check for `__client_uat` AND `__client_uat_*` suffixed versions)
- JWT not URL-encoded (can contain special chars)
- Missing Cloudflare cookies causes 403/redirect to login

### 4. Session Refresh Behavior (CRITICAL FIX)
`refreshSession()` via GET `/client`:
- **MUST include expired `__session` cookie in request** - Clerk uses it to identify which session to refresh
- Returns `last_active_session_id` in response body
- Does NOT return `__session` Set-Cookie header for expired sessions
- Must extract JWT from `response.client.sessions[].last_active_token.jwt`

**CRITICAL BUG DISCOVERED (2025-04-03)**: 
`clerkGetClientSession()` only sent `__client` cookie, NOT `__session`
This caused refresh to return empty sessions (`"sessions": []`)

**Before (BROKEN)**:
```bash
curl -s 'https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0' \
  -H 'Cookie: __client=<device>'
# Returns: {"response": {"sessions": [], "last_active_session_id": null}}
```

**After (FIXED)**:
```bash
curl -s 'https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0' \
  -H 'Cookie: __session=<expired_jwt>; __client=<device>'
# Returns: {"response": {"sessions": [{"id": "sess_...", "status": "active"}]}}
```

**Fix applied - 4 file changes**:

1. `clerkHttpsJson()` - Accept and send session cookie:
```javascript
function clerkHttpsJson(method, pathAndQuery, opts = {}) {
  const { cookieClient, sessionCookie, extraHeaders = {}, body } = opts;
  // ...
  const cookieHeader = sessionCookie 
    ? `__session=${sessionCookie}${deviceCookie ? `; ${deviceCookie}` : ''}`
    : deviceCookie;
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  // ...
}
```

2. `clerkGetClientSession()` - Add sessionCookie parameter:
```javascript
async function clerkGetClientSession(clientCookie, sessionCookie, { ...opts } = {}) {
  const { data, setCookieLines } = await clerkHttpsJson('GET', 'client?...', {
    cookieClient: cc,
    sessionCookie,  // KEY: Pass session for refresh
    extraHeaders: { Origin: CLERK_ORIGIN, Referer: CLERK_REFERER },
  });
  // Extract JWT from response body (Set-Cookie won't have __session)
  let newSession = sessionCookieFromSetCookieLines(setCookieLines);
  if (!newSession) newSession = sessionJwtFromClerkClientPayload(data);
  return newSession ? { sessionCookie: newSession, ... } : null;
}
```

3. `refreshSession()` - Accept and pass session parameter:
```javascript
export async function refreshSession(clientCookie, sessionCookie) {
  try {
    return await clerkGetClientSession(clientCookie, sessionCookie, {
      debugPhase: 'refresh',
      maxAttempts: GET_CLIENT_MAX_ATTEMPTS,
      retryMs: GET_CLIENT_RETRY_MS,
    });
  } catch { return null; }
}
```

4. **Update ALL callers** to pass `session.sessionCookie`:
```javascript
// dashboard-api.js ensureSession()
const refreshed = await refreshSession(session.clientCookie, session.sessionCookie);

// dashboard-api.js - second refresh location
const refreshed = await refreshSession(session.clientCookie, session.sessionCookie);

// account-generator.js
const refreshed = await refreshSession(allDeviceCookies, sessionCookie);
```

**Why this matters**: Clerk uses the expired `__session` JWT (even expired) to identify WHICH session belongs to this device. Without it, Clerk returns empty sessions array. The session stays "active" server-side (as seen in browser incognito tabs lasting 40+ minutes) but requires the session ID to access.

**Test**: Send ALL cookies (including expired __session) to `/client`:
```bash
curl -s 'https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0' \
  -H 'Cookie: __session=<expired_jwt>; __client=<device>; __cf_bm=<cf>'
# Returns: {"sessions": [{"id": "...", "status": "active"}]}
```

Without `__session`: Returns `"sessions": []` - session lost forever!

### 5. Debugging Checklist

```bash
# 1. Check stored session
curl -s http://localhost:3001/api/accounts \
  -H "Authorization: Bearer <token>" | jq '.data[] | select(.email=="test@example.com")'

# 2. Verify session JWT expiry
node -e "
import * as store from './server/services/store.js';
const s = await store.getAccountSession(userId, accountId);
const parts = s.sessionCookie.split('.');
const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
console.log('Expires:', new Date(payload.exp * 1000));
console.log('Now:', new Date());
console.log('Valid:', payload.exp * 1000 > Date.now());
"

# 3. Test tRPC directly with curl
curl -s 'https://openrouter.ai/api/trpc/managementKeys.list?batch=1' \
  -H "Cookie: __session=<jwt>; __client=<device>; __cf_bm=<cf>" \
  -H "Origin: https://openrouter.ai" \
  -H "Referer: https://openrouter.ai/settings/management-keys"

# 4. Test session refresh with/without expired session (CRITICAL TEST)
curl -si 'https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0' \
  -H 'Cookie: __client=<device>'  # Returns: "sessions": []
  
curl -si 'https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0' \
  -H 'Cookie: __session=<expired>; __client=<device>'  # Returns: "sessions": [{"status":"active"}]

# This test reveals the core bug - without __session, Clerk returns empty sessions
# even though the session is still active server-side
```

**Key insight**: Check response headers for Clerk auth status:
```
x-clerk-auth-message: JWT is expired. Expiry date: ...
x-clerk-auth-reason: session-token-expired-refresh-non-eligible-no-refresh-cookie
x-clerk-auth-status: signed-out
```
This indicates the `__session` cookie wasn't sent with the refresh request.

**Symptom pattern observed**:
1. OTP verify succeeds → session stored with 60s expiry
2. Provisioning attempts → `ensureSession()` sees short expiry (< 1 hour)
3. Calls `refreshSession(clientCookie)` WITHOUT `sessionCookie`
4. GET `/client` returns `"sessions": []` (no session found)
5. tRPC called with old expired session → HTML login page
6. `x-clerk-auth-reason: session-token-expired-refresh-non-eligible-no-refresh-cookie`

## Key Files to Inspect
**Fix applied - 4 file changes**:

1. `clerk-auth.js` - `getFreshJwt()` (new), cookie duplication fixes, `mergeDeviceJar()` filterFn fix, `sessionCookie` parameter passing
2. `dashboard-api.js` - `getFreshJwt()`, `trpcCall()` with fresh JWT, `tryRestApiCreateKey()` (new), `playwrightCookiesForOpenRouter()` with fresh JWT, `shouldAbortProvisioning()` fix
3. `account-generator.js` - Updated `refreshSession()` call
4. `AccountController.js` - OTP provisioning logic

### Implementation Details

**`getFreshJwt()` - Fresh JWT from /client**:
```javascript
async function getFreshJwt(sessionCookie, clientCookie) {
  const res = await fetch('https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0', {
    headers: {
      'Cookie': `__session=${sessionCookie}; ${clientCookie}`,
      'Origin': 'https://openrouter.ai',
    }
  });
  const data = await res.json();
  return data?.response?.sessions?.[0]?.last_active_token?.jwt;
}
```

**`tryRestApiCreateKey()` - REST API Fallback**:
```javascript
async function tryRestApiCreateKey(sessionCookie, clientCookie, keyName) {
  const freshJwt = await getFreshJwt(sessionCookie, clientCookie);
  if (!freshJwt) return null;
  
  const endpoints = [
    '/api/v1/management-keys',
    '/api/v1/keys', 
    '/api/management/keys',
    '/api/keys/management'
  ];
  
  for (const endpoint of endpoints) {
    const res = await fetch(`https://openrouter.ai${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${freshJwt}`,
        'Cookie': clientCookie,
        'Content-Type': 'application/json',
        'Origin': 'https://openrouter.ai'
      },
      body: JSON.stringify({ name: keyName })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.key || data.data?.key) return { key: data.key || data.data.key };
    }
  }
  return null;
}
```

**Updated `trpcCall()` - Uses fresh JWT**:
```javascript
async function trpcCall(route, input, sessionCookie, clientCookie) {
  // Get fresh JWT for OTP sessions (60s lifetime)
  const freshJwt = await getFreshJwt(sessionCookie, clientCookie);
  const jwtToUse = freshJwt || sessionCookie;
  
  console.error(`[trpcCall] Using fresh JWT for route ${route}`);
  
  // Build cookies with fresh JWT
  const jar = parseCookieClientToJar(clientCookie);
  const clerkCookies = openRouterDashboardDeviceCookies(jar);
  const allCookies = [`__session=${jwtToUse}`, ...clerkCookies];
  
  // Make request with fresh JWT
  const res = await fetch(`https://openrouter.ai/api/trpc/${route}`, {
    method: 'POST',
    headers: {
      'Cookie': allCookies.join('; '),
      'Origin': 'https://openrouter.ai',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ "0": { "json": input } })
  });
  // ... handle response
}
```

**Fixed `shouldAbortProvisioning()` - Don't abort on login page**:
```javascript
function shouldAbortProvisioning(err) {
  if (err.isHtml && (err.status === 401 || err.status === 403)) return true;
  if (err.isHtml && err.httpStatus === 200) {
    if (err.htmlInfo?.looksLikeCloudflare) return true;
    // REMOVED: if (err.htmlInfo?.looksLikeLoginPage) return true;
    // Don't abort - might be wrong endpoint, try others
  }
  if (err.trpcCode === 'HTML_RESPONSE') {
    return false;  // Try other routes or fallbacks
  }
  if ([401, 403, 423, 429].includes(err.httpStatus)) return true;
  return false;
}
```

**Always check**:
- `server/services/clerk-auth.js` - `isSessionValid()`, `refreshSession()`, `completeEmailOTP()`, `clerkHttpsJson()`, `clerkGetClientSession()`
- `server/services/dashboard-api.js` - `ensureSession()`, `trpcCall()`, `dashboardHeaders()`, `createManagementKey()`
- `server/services/store.js` - `updateAccountSession()`, `getAccountSession()`

### Critical Functions Modified

**`clerkHttpsJson()`** - Must accept and send session cookie:
```javascript
function clerkHttpsJson(method, pathAndQuery, opts = {}) {
  const { cookieClient, sessionCookie, extraHeaders = {}, body } = opts;
  // ...
  const cookieHeader = sessionCookie 
    ? `__session=${sessionCookie}${deviceCookie ? `; ${deviceCookie}` : ''}`
    : deviceCookie;
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  // ...
}
```

**`clerkGetClientSession()`** - Pass session through:
```javascript
async function clerkGetClientSession(clientCookie, sessionCookie, { ...opts } = {}) {
  const { data, setCookieLines } = await clerkHttpsJson('GET', 'client?...', {
    cookieClient: cc,
    sessionCookie,  // KEY: Pass session for refresh
    extraHeaders: { ... },
  });
  // ...
}
```

**`refreshSession()`** - Accept session parameter:
```javascript
export async function refreshSession(clientCookie, sessionCookie) {
  return await clerkGetClientSession(clientCookie, sessionCookie, { ... });
}
```

**Callers updated** (must pass `session.sessionCookie`):
- `dashboard-api.js` ensureSession(): `await refreshSession(session.clientCookie, session.sessionCookie)`
- `account-generator.js`: `await refreshSession(allDeviceCookies, sessionCookie)`

### 7. Trace Flow
```
1. OTP Start → store clientCookie (no session yet)
2. OTP Verify → completeEmailOTP() returns sessionCookie
3. Store session → updateAccountSession()
4. Provision → ensureSession() retrieves session
5. tRPC Call → dashboardHeaders() builds Cookie header
```

**If tRPC returns HTML** instead of JSON:
1. **Check x-matched-path header** - if it's `/[maker-id]/[slug]/[tab]`, tRPC endpoint is being caught by Next.js dynamic routes
2. **Session expired** (check JWT exp claim and get fresh JWT)
3. **Missing Cloudflare cookies**
4. **Cookie format wrong** (duplicates, encoding)

### 8. tRPC Routing Issue (2025-04-03)

**Problem**: `/api/trpc/{procedure}` returns HTML with `x-matched-path: /[maker-id]/[slug]/[tab]`
- Next.js dynamic routes are catching tRPC URLs
- Indicates tRPC endpoint may have moved or been removed

**Workaround - REST API Fallback**:
```javascript
async function tryRestApiCreateKey(sessionCookie, clientCookie, keyName) {
  const endpoints = [
    '/api/v1/management-keys',
    '/api/v1/keys',
    '/api/management/keys',
    '/api/keys/management'
  ];
  
  for (const url of endpoints) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${freshJwt}`,
        'Cookie': clientCookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: keyName })
    });
    if (res.ok) return await res.json();
  }
}
```

**Fallback order**:
1. Try tRPC with fresh JWT
2. Try REST API endpoints
3. Fall back to browser automation (Playwright)

### 9. Cookie Duplication Bug Fixes (2025-04-03)

**Issue 1**: `__client` and `__client_uat` added twice in `openRouterDashboardDeviceCookies()` and `openRouterPlaywrightDeviceCookies()`
- First explicitly added (lines ~139-141)
- Then again in the loop through all dashboard device cookies (lines ~142-145)

**Impact**: Duplicate cookies in requests, causing authentication issues

**Fix** (applied to BOTH functions):
```javascript
// In openRouterDashboardDeviceCookies()
if (uat && uat !== client) out.push(`__client_uat=${uat}`);
else if (legacySingle) out.push(`__client_uat=${client}`);
if (client && client !== uat) out.push(`__client=${client}`);
for (const k of Object.keys(jar).sort()) {
  // Skip already-added Clerk cookies to avoid duplicates
  if (k === '__client' || k === '__client_uat') continue;
  if (isDashboardDeviceCookieName(k)) out.push(`${k}=${jar[k]}`);
}

// Same fix in openRouterPlaywrightDeviceCookies()
if (uat) list.push({ name: '__client_uat', value: uat, ... });
if (client) list.push({ name: '__client', value: client, ... });
for (const k of Object.keys(jar)) {
  // Skip already-added Clerk cookies to avoid duplicates
  if (k === '__client' || k === '__client_uat') continue;
  if (isDashboardDeviceCookieName(k)) {
    list.push({ name: k, value: jar[k], ... });
  }
}
```

**Issue 2**: `mergeDeviceJar()` ignored `filterFn` parameter (CRITICAL)
- Function signature accepted `filterFn` parameter
- But body called `mergeDeviceCookiesFromParsed(next, parseCookies(lines))` - NO filterFn!
- Always used default `isClerkDeviceCookieName`, ignoring passed `isDashboardDeviceCookieName`

**Impact**: Cloudflare cookies (`__cf_bm`, `_cfuvid`) from Set-Cookie headers were being FILTERED OUT when merging cookies from responses

**Fix**: Actually pass the filterFn parameter:
```javascript
function mergeDeviceJar(priorJar, lines, filterFn = isClerkDeviceCookieName) {
  const next = { ...priorJar };
  mergeDeviceCookiesFromParsed(next, parseCookies(lines), filterFn);  // FIXED: added filterFn
  return next;
}
```

**Why this matters**: Without Cloudflare cookies, tRPC calls return HTML login pages. The cookies must be preserved from initial login through all subsequent requests.

### Google OAuth Edge Case - /sign-in/factor-one (2025-04-04)

**Problem**: Google OAuth accounts (zaydkhan3@gmail.com) redirect to `/sign-in/factor-one` instead of direct dashboard access. This page requires clicking "Use another method" to get to the OTP flow.

**Detection** (in Playwright provisioning flow):
```javascript
// After navigating to /settings/management-keys
const currentUrl = page.url();
if (currentUrl.includes('/sign-in/factor-one')) {
  provisionStepLog(accountId, 'Detected /sign-in/factor-one (Google OAuth needs OTP)');
  
  // Try to click "Use another method" → OTP flow
  const useAnotherMethodBtn = page.locator('button:has-text("Use another method"), a:has-text("Use another method")').first();
  if (await useAnotherMethodBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await useAnotherMethodBtn.click();
    await page.waitForTimeout(2000);
    
    // Check if OTP input appeared
    const otpInput = page.locator('input[autocomplete="one-time-code"], input.cl-otpCodeFieldInput, input[maxlength="1"]').first();
    if (await otpInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      throw new Error('GOOGLE_OAUTH_REQUIRES_OTP: Use "Login Account" flow with OTP first');
    }
  }
  
  throw new Error(
    'GOOGLE_OAUTH_REQUIRES_OTP: This account uses Google OAuth and requires OTP verification. ' +
    'Use the "Login Account" flow with the 6-digit OTP code from your email first, ' +
    'then retry management key provisioning.'
  );
}
```

**UI Error Handling** (src/api.js):
```javascript
export function formatApiErrorMessage(err) {
  if (err.message?.includes('GOOGLE_OAUTH_REQUIRES_OTP')) {
    return 'This Google OAuth account requires OTP verification before provisioning.\n\n' +
           'Steps to fix:\n' +
           '1. Click "Authenticate" on this account\n' +
           '2. Select "Email OTP" method\n' +
           '3. Enter the 6-digit code from your email\n' +
           '4. Once authenticated, retry "Provision Key"';
  }
  // ... rest of function
}
```

**Why this happens**: Google OAuth accounts don't have passwords, so OpenRouter falls back to email OTP for verification. The `/factor-one` page is Clerk's multi-factor authentication step.

**Fix for users**:
1. Use "Login Account" button in UI (or OTP start/verify API)
2. Select "Email OTP" method (not password)
3. Enter 6-digit code from email
4. Session is now valid for ~7 hours
5. Retry "Provision Key" - it will work now

### 10. Specific Implementation Fixes (2025-04-03)

**4 files modified, 328 insertions(+), 85 deletions(-)**:

1. **`clerk-auth.js`** - Cookie duplication and filterFn fixes:
   - Fixed `openRouterDashboardDeviceCookies()` - skip duplicates
   - Fixed `openRouterPlaywrightDeviceCookies()` - skip duplicates  
   - Fixed `mergeDeviceJar()` - use passed `filterFn` parameter
   - Updated `clerkHttpsJson()` - accept and send `sessionCookie`
   - Updated `clerkGetClientSession()` - pass `sessionCookie` for refresh
   - Updated `refreshSession()` - accept `sessionCookie` parameter

2. **`dashboard-api.js`** - Fresh JWT and REST API fallback:
   - Added `getFreshJwt()` function
   - Updated `trpcCall()` - get fresh JWT before calls
   - Added `tryRestApiCreateKey()` - REST API fallback
   - Updated `playwrightCookiesForOpenRouter()` - get fresh JWT
   - Updated callers to pass `session.sessionCookie`

3. **`account-generator.js`** - Updated refresh call

4. **`AccountController.js`** - OTP provisioning logic

**Key insight**: OTP sessions are valid for 2+ hours but JWTs expire every 60s. The solution is to get a fresh JWT from `/client` before each API call, not to try to extend JWT lifetime.

## OTP Completion Workflow (CRITICAL - Use Built-in Functions)

**NEVER manually implement Clerk OTP API calls.** Hydra already has proper OTP functions.

### Correct Pattern
```javascript
import { startEmailOTP, completeEmailOTP } from "./server/services/clerk-auth.js";
import { encrypt, encryptConfig } from "./server/services/storage-codec.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Step 1: Start OTP (sends email)
const startRes = await startEmailOTP("user@example.com");
// Returns: { signInId, clientCookie, emailAddressId }

// Step 2: Wait for user to provide 6-digit code from email
// Codes expire in ~10 minutes

// Step 3: Complete with code
const completeRes = await completeEmailOTP(startRes.signInId, "123456", startRes.clientCookie);
// Returns: { sessionCookie, clientCookie, sessionExpiry }

// Step 4: Save to database
await prisma.account.update({
  where: { id: accountId },
  data: {
    sessionToken: encrypt(completeRes.sessionCookie),
    config: encryptConfig({
      email: "user@example.com",
      authMethod: "otp",
      clientCookie: completeRes.clientCookie,
      sessionExpiry: completeRes.sessionExpiry  // ~7 hours
    })
  }
});
```

### Common Mistakes
**WRONG - Manual Clerk API:**
```javascript
// Don't do this - you'll hit errors like:
// - "is missing" (strategy parameter)
// - "not found" (sign in id)
// - "is unknown" (__clerk_client_id parameter)
const clientRes = await fetch("https://clerk.openrouter.ai/v1/client", ...);
const signInRes = await fetch("https://clerk.openrouter.ai/v1/client/sign_ins", ...);
```

**RIGHT - Use Hydra's functions:**
```javascript
import { startEmailOTP, completeEmailOTP } from "./server/services/clerk-auth.js";
const result = await startEmailOTP(email);
const session = await completeEmailOTP(result.signInId, code, result.clientCookie);
```

### OTP Code Expiration & Timing (CRITICAL)

**Code Validity**: ~10 minutes from when `startEmailOTP()` is called

**CRITICAL TIMING ISSUE**: Each call to `startEmailOTP()` creates a NEW sign-in attempt and INVALIDATES all previous codes for that email.

**Common Failure Pattern**:
```
T+0s   User: "Run OTP for delilah"
       → startEmailOTP() called → Code 123456 sent → SignIn: sia_abc...
       
T+30s  User checks email, gets code 123456

T+35s  User: "Code is 123456"
       → Agent calls startEmailOTP() AGAIN (WRONG!)
       → NEW sign-in created → Code 789012 sent → SignIn: sia_xyz...
       → Code 123456 INVALIDATED
       → completeEmailOTP(sia_xyz, "123456") fails: "Incorrect code"
```

**Correct Pattern - Single Execution Flow**:
```javascript
// WRONG - Separate calls invalidate codes
const start = await startEmailOTP(email);  // Code A sent
// ... wait for user input ...
const start2 = await startEmailOTP(email);  // Code B sent, Code A INVALIDATED
const complete = await completeEmailOTP(start2.signInId, userCode, start2.clientCookie);

// RIGHT - Capture once, complete without re-triggering
const start = await startEmailOTP(email);  // Code sent
// → Store: start.signInId, start.clientCookie
// → Tell user: "Check email, give me code within 10 min"
// ... wait for user input ...
// → Use STORED values, do NOT call start again
const complete = await completeEmailOTP(start.signInId, userCode, start.clientCookie);
```

**User Communication Pattern**:
```
Agent: "📧 OTP sent to delilah@zayd.wtf! SignIn: sia_abc..."
Agent: "⏳ Check email NOW - you have ~10 minutes before code expires!"
Agent: "⚠️ Don't tell me until you're looking at the code!"

User: [checks email immediately] "Code is 771709"

Agent: [immediately runs complete without calling start again]
```

**If Code Expires**:
1. User says "Code didn't work"
2. Agent calls `startEmailOTP()` to send FRESH code
3. Agent says: "📧 NEW code sent! Check email NOW!"
4. User immediately checks email and provides code
5. Agent completes within seconds

**Batch Completion Script Pattern**:
```javascript
// complete-otp.js - one-shot completion
import { startEmailOTP, completeEmailOTP } from "./server/services/clerk-auth.js";

const [alias, code] = process.argv.slice(2);

// Start AND complete in single execution
const start = await startEmailOTP(getEmailForAlias(alias));
const complete = await completeEmailOTP(start.signInId, code, start.clientCookie);
// Save to database...
```

**Key Insight**: The 60s JWT expiration and 10min code expiration are SEPARATE:
- JWT expires in 60s (for API calls)
- OTP code expires in 10min
- But starting a new OTP flow invalidates the OLD code immediately

**For Multiple Accounts**:
Do ONE account at a time, fully complete before moving to next:
```
1. Trigger delilah OTP → wait for code → complete → save
2. Trigger zayd OTP → wait for code → complete → save  
3. Test all 3 accounts
```

**NOT** (this causes confusion):
```
1. Trigger delilah OTP
2. Trigger zayd OTP
3. Wait for both codes
4. Try to complete both
```

### Batch OTP Stub Creation
```bash
# Create multiple OTP stubs at once
curl -X POST http://localhost:3001/api/accounts/bulk-otp-stubs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"emails": ["user1@example.com", "user2@example.com"]}'
```

## Login Attempt Limiting (CRITICAL - Prevents Account Lockouts)

**DISCOVERY (2025-04-05)**: Repeated login attempts can lock accounts permanently (delilah-zayd.wtf incident). Need SEPARATE limits for proxy failures vs auth attempts.

### Two Different Limits

| Concern | Constant | Purpose | Behavior |
|---------|----------|---------|----------|
| **Proxy Key Failures** | `MAX_RETRIES = 10` | Keep keys in rotation despite transient failures | Drop key after 10 consecutive 429/402/401/5xx |
| **Login Attempts** | `MAX_LOGIN_ATTEMPTS = 4` | Prevent account lockout from too many auth attempts | 1 hour cooldown after 4 failures |

### Why Different?
- **Keys**: Tolerate transient failures (network blips, rate limits). Keep trying.
- **Accounts**: Clerk/OpenRouter will lock accounts after repeated failed logins. Protect them.

### Implementation (rotation-manager.js)

```javascript
const MAX_RETRIES = 10;                // Proxy failures (high tolerance)
const MAX_LOGIN_ATTEMPTS = 4;          // Auth failures (protect accounts)
const LOGIN_COOLDOWN = 60 * 60 * 1000; // 1 hour

class RotationManager {
  constructor() {
    this.failureCounts = new Map();      // key hash → proxy failures
    this.loginAttempts = new Map();      // accountId → login attempts
    this.cooldowns = new Map();          // key hash → expiry timestamp
  }

  // For proxy requests - tolerate more failures
  async recordFailure(hash, httpStatus) {
    const current = (this.failureCounts.get(hash) || 0) + 1;
    this.failureCounts.set(hash, current);
    
    // Apply cooldown for rate-limited keys
    if (httpStatus === 429 || httpStatus === 402) {
      this.applyCooldown(hash, httpStatus);
    }
    
    // Drop key after 10 consecutive failures
    if (current >= MAX_RETRIES) {
      await this.dropFromPool(hash, `exceeded ${MAX_RETRIES} consecutive failures`);
      return true; // was dropped
    }
    return false;
  }

  recordSuccess(hash) {
    if (this.failureCounts.has(hash)) {
      this.failureCounts.delete(hash); // Reset on success
    }
  }

  // For login/auth - strict limit to prevent lockout
  recordLoginAttempt(accountId) {
    const now = Date.now();
    const record = this.loginAttempts.get(accountId) || { count: 0, lastAttempt: 0 };
    
    // Reset counter if last attempt was > 1 hour ago
    if (now - record.lastAttempt > LOGIN_COOLDOWN) {
      record.count = 0;
    }
    
    record.count += 1;
    record.lastAttempt = now;
    this.loginAttempts.set(accountId, record);
    
    const remaining = Math.max(0, MAX_LOGIN_ATTEMPTS - record.count);
    const allowed = record.count <= MAX_LOGIN_ATTEMPTS;
    
    if (!allowed) {
      logger.error(`[LOGIN] Account ${accountId.slice(0, 8)}… BLOCKED after ${MAX_LOGIN_ATTEMPTS} attempts`);
    } else {
      logger.info(`[LOGIN] Account ${accountId.slice(0, 8)}… login attempt ${record.count}/${MAX_LOGIN_ATTEMPTS}`);
    }
    
    return { allowed, remaining, cooldown: !allowed ? LOGIN_COOLDOWN : null };
  }

  resetLoginAttempts(accountId) {
    if (this.loginAttempts.has(accountId)) {
      this.loginAttempts.delete(accountId);
      logger.info(`[LOGIN] Account ${accountId.slice(0, 8)}… login attempts reset (successful login)`);
    }
  }

  getRemainingLoginAttempts(accountId) {
    const record = this.loginAttempts.get(accountId);
    if (!record) return MAX_LOGIN_ATTEMPTS;
    if (Date.now() - record.lastAttempt > LOGIN_COOLDOWN) return MAX_LOGIN_ATTEMPTS;
    return Math.max(0, MAX_LOGIN_ATTEMPTS - record.count);
  }
}
```

### Integration Points

**Account Login (server/controllers/AccountController.js)**:
```javascript
async login(req, res) {
  const { rotationManager } = await import('../services/rotation-manager.js');
  
  // Check attempt limit BEFORE attempting login
  const loginCheck = rotationManager.recordLoginAttempt(req.params.id);
  if (!loginCheck.allowed) {
    return this.error(
      res,
      `Too many failed login attempts. Please wait ${Math.ceil(loginCheck.cooldown / 60000)} minutes before retrying to prevent account lockout.`,
      429,
      'LOGIN_RATE_LIMITED'
    );
  }
  
  try {
    const session = await clerkAuth.signInWithPassword(email, password);
    await store.updateAccountSession(req.user.id, req.params.id, ...);
    
    // SUCCESS - reset the counter
    rotationManager.resetLoginAttempts(req.params.id);
    return this.success(res, { sessionExpiry: session.sessionExpiry, status: 'active' });
  } catch (err) {
    // Failure is recorded, will block after 4 attempts
    return this.error(res, err.message, err.status || 500);
  }
}
```

**OTP Start (server/controllers/AccountController.js)**:
```javascript
async startOTP(req, res) {
  const { rotationManager } = await import('../services/rotation-manager.js');
  
  const loginCheck = rotationManager.recordLoginAttempt(req.params.id);
  if (!loginCheck.allowed) {
    return this.error(
      res,
      `Too many OTP requests. Please wait ${Math.ceil(loginCheck.cooldown / 60000)} minutes.`,
      429,
      'OTP_RATE_LIMITED'
    );
  }
  
  const { signInId, clientCookie } = await clerkAuth.startEmailOTP(email);
  // ...
  return this.success(res, { signInId, message: `OTP sent`, remainingAttempts: loginCheck.remaining });
}
```

**OTP Verify (server/controllers/AccountController.js)**:
```javascript
async verifyOTP(req, res) {
  try {
    const session = await clerkAuth.completeEmailOTP(signInId, code, clientCookie);
    await store.updateAccountSession(req.user.id, req.params.id, ...);
    
    // SUCCESS - reset the counter
    const { rotationManager } = await import('../services/rotation-manager.js');
    rotationManager.resetLoginAttempts(req.params.id);
    
    return this.success(res, { sessionExpiry: session.sessionExpiry, status: 'active' });
  } catch (err) {
    return this.error(res, err.message, err.status || 500);
  }
}
```

**Admin Panel Login (server/controllers/AuthController.js)**:
```javascript
async login(req, res) {
  const { rotationManager } = await import('../services/rotation-manager.js');
  
  // IP-based tracking for admin logins
  const clientId = req.ip || req.connection?.remoteAddress || 'admin';
  const loginCheck = rotationManager.recordLoginAttempt(`admin:${clientId}`);
  
  if (!loginCheck.allowed) {
    return this.error(res, `Too many failed attempts. Wait ${Math.ceil(loginCheck.cooldown / 60000)} minutes.`, 429);
  }
  
  try {
    const token = await auth.login(password);
    rotationManager.resetLoginAttempts(`admin:${clientId}`);
    return this.success(res, { token });
  } catch (err) {
    return this.error(res, err.message, 401);
  }
}
```

### Key Insight
- **Proxy**: 10 failures = drop key (availability focused)
- **Auth**: 4 failures = 1hr cooldown (protection focused)
- Always reset on success
- 1-hour auto-reset prevents permanent lockout
- Account lockouts (like delilah-zayd) happen when you exceed 4-5 attempts within short period

## OTP Completion Automation Scripts (2025-04-04)

Two scripts created for handling OTP completion without timing issues:

### `complete-otp.js` - One-shot OTP completion

**Purpose**: Complete OTP sign-in for a single account without re-triggering

**Usage**:
```bash
# When you receive OTP code via email:
node complete-otp.js <alias> <6-digit-code>

# Examples:
node complete-otp.js delilah-zayd 771709
node complete-otp.js zayd-zayd 912740
```

**Implementation**:
```javascript
import { startEmailOTP, completeEmailOTP } from "./server/services/clerk-auth.js";
import { PrismaClient } from "@prisma/client";
import { encrypt, encryptConfig } from "./server/services/storage-codec.js";

const ACCOUNTS = {
  'delilah-zayd': { id: '529c3bc9-...', email: 'delilah@zayd.wtf' },
  'zayd-zayd': { id: '09f8cc49-...', email: 'zayd@zayd.wtf' }
};

async function completeOtp(alias, code) {
  const account = ACCOUNTS[alias];
  
  // Start AND complete in single execution (no re-triggering)
  const start = await startEmailOTP(account.email);
  console.log(`Started: ${start.signInId.slice(0, 20)}...`);
  
  const complete = await completeEmailOTP(start.signInId, code, start.clientCookie);
  console.log("✅ Session obtained!");
  
  // Save to database
  await prisma.account.update({
    where: { id: account.id },
    data: {
      sessionToken: encrypt(complete.sessionCookie),
      config: encryptConfig({
        email: account.email,
        authMethod: 'otp',
        clientCookie: complete.clientCookie,
        sessionExpiry: complete.sessionExpiry
      })
    }
  });
}
```

**Why this works**: Single Node.js execution - `startEmailOTP()` and `completeEmailOTP()` happen in the same process without delay, so the code is still valid.

### `complete-and-test.js` - Continuous automated testing

**Purpose**: Test all accounts repeatedly, handling OTP completion asynchronously

**Usage**:
```bash
# Start automated testing in background
node complete-and-test.js &

# Monitor logs
tail -f /tmp/complete-test.log

# When you receive OTP codes:
node complete-otp.js delilah-zayd <code>
node complete-otp.js zayd-zayd <code>

# Stop automation
pkill -f "complete-and-test"
```

**Key Features**:
- Tests all 3 accounts every 30 seconds
- Checks if OTP completion needed (no session token)
- Auto-refreshes valid sessions via Clerk /client
- Skips accounts needing OTP (doesn't block on them)
- Logs everything to `/tmp/complete-test.log`

**Account State Machine**:
```
Account States:
  → needs_otp: No session token or empty config
     └─ Skip testing, wait for manual OTP completion
  → has_session: Has valid session token
     ├─ session_fresh (< 1 hour): Test immediately
     └─ session_expiring: Refresh via Clerk, then test
```

## Automated Testing Workflow (2025-04-04)

For continuous testing of multiple accounts with OTP completion:

### Scripts Created

**`complete-and-test.js`** - Non-stop automated testing:
```javascript
// Runs indefinitely, testing all accounts every 30 seconds
// - Checks session health
// - Auto-refreshes expired sessions via Clerk /client
// - Tests Playwright provisioning
// - Tests request-based alternatives
// - Logs everything to /tmp/complete-test.log

node complete-and-test.js
```

**`complete-otp.js`** - Complete OTP sign-in for pending accounts:
```bash
# When OTP email arrives:
node complete-otp.js delilah-zayd 123456
node complete-otp.js zayd-zayd 654321
```

### Multi-Account Testing Setup

**Account definitions** (in automation scripts):
```javascript
const ACCOUNTS = [
  { id: 'cecff6a9-cbcc-4110-93ec-409299474b82', email: 'iam@zayd.wtf', alias: 'iam-zayd' },
  { id: '529c3bc9-d8b4-49c7-8fee-957e54db4c50', email: 'delilah@zayd.wtf', alias: 'delilah-zayd' },
  { id: '09f8cc49-9308-4977-9f18-15d1a7e13216', email: 'zayd@zayd.wtf', alias: 'zayd-zayd' }
];
```

**Create OTP stubs via API**:
```bash
curl -X POST http://localhost:3001/api/accounts/bulk-otp-stubs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"emails": ["Delilah@zayd.wtf", "zayd@zayd.wtf"]}'
```

**Loop until flawless** approach:
```javascript
async function runTestLoop() {
  while (true) {
    for (const account of ACCOUNTS) {
      // 1. Check if needs OTP
      if (await needsOtpCompletion(account)) {
        log(`${account.alias} needs OTP - check email`);
        continue;
      }
      
      // 2. Ensure session valid (refresh if needed)
      const sessionOk = await refreshSession(account);
      
      // 3. Test Playwright provision
      if (sessionOk) await testPlaywrightProvision(account);
      
      // 4. Test request-based alternatives
      await testRequestBased(account);
    }
    await sleep(30000);
  }
}
```

**Session refresh via Clerk**:
```javascript
async function refreshSession(account) {
  const session = await getAccountSession(account.id);
  
  // Test if current session works
  const testRes = await fetch('https://openrouter.ai/settings/management-keys', {
    headers: { 
      'Cookie': `__session=${session.sessionCookie}; ${session.clientCookie}`,
      'Accept': 'text/html'
    },
    redirect: 'manual'
  });
  
  if (testRes.status === 200) return true;
  
  // Get fresh JWT from Clerk
  const clerkRes = await fetch('https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0', {
    headers: {
      'Cookie': session.clientCookie,  // Just client cookie, no session
      'Origin': 'https://openrouter.ai'
    }
  });
  
  const data = await clerkRes.json();
  const newJwt = data?.response?.sessions?.[0]?.last_active_token?.jwt;
  
  if (newJwt) {
    // Save new session
    await saveSession(account.id, newJwt, session.clientCookie);
    return true;
  }
  return false;
}
```

### Automation Scripts for Multi-Account Testing

**`complete-and-test.js`** - Non-stop automated testing loop:
```javascript
// Tests all accounts every 30 seconds
// - Checks if OTP completion needed
// - Auto-refreshes sessions via Clerk /client
// - Tests Playwright provisioning
// - Tests request-based alternatives
// Logs to /tmp/complete-test.log

// Usage:
node complete-and-test.js &
tail -f /tmp/complete-test.log
```

**`complete-otp.js`** - Complete OTP sign-in for pending account:
```javascript
// Usage - when you receive OTP code via email:
node complete-otp.js <alias> <6-digit-code>

// Examples:
node complete-otp.js delilah-zayd 545801
node complete-otp.js zayd-zayd 845685
```

**Account aliases mapping** (for reference):
```javascript
const ACCOUNTS = {
  'delilah-zayd': { id: '529c3bc9-d8b4-49c7-8fee-957e54db4c50', email: 'delilah@zayd.wtf' },
  'zayd-zayd':    { id: '09f8cc49-9308-4977-9f18-15d1a7e13216', email: 'zayd@zayd.wtf' },
  'iam-zayd':     { id: 'cecff6a9-cbcc-4110-93ec-409299474b82', email: 'iam@zayd.wtf' }
};
```

### Monitoring Commands

```bash
# Watch live test results
tail -f /tmp/complete-test.log

# Check all accounts status
sqlite3 prisma/dev.db "SELECT id, alias, openRouterId, sessionToken FROM Account"

# Check automated test process
pgrep -f "complete-and-test"

# Complete OTP when code arrives
node complete-otp.js <alias> <6-digit-code>

# Stop automation
pkill -f "complete-and-test"
```

## End-to-End Success (2025-04-03)

**Fresh OTP Test - COMPLETE SUCCESS**:

```bash
# 1. Create OTP stub
curl -X POST http://localhost:3001/api/accounts/bulk-otp-stubs \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"emails":["iam@zayd.wtf"]}'
# → Account: cecff6a9-cbcc-4110-93ec-409299474b82

# 2. Start OTP
curl -X POST http://localhost:3001/api/accounts/{id}/otp/start \
  -H "Authorization: Bearer $TOKEN"
# → signInId: sia_3BrtMnkIrgI8BM1604iOtZ2V2yz
# → Email sent to iam@zayd.wtf

# 3. User provides code: 314397

# 4. Verify OTP
curl -X POST http://localhost:3001/api/accounts/{id}/otp/verify \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"signInId": "sia_...", "code": "314397"}'
# → SUCCESS
# {
#   "sessionExpiry": "2026-04-03T23:31:10.000Z",  // 420 minutes = 7 hours!
#   "status": "active",
#   "autoProvision": "failed",  // tRPC failed but...
#   "managementKey": false
# }

# 5. Manual provision (or re-enable auto-provision)
curl -X POST http://localhost:3001/api/accounts/{id}/provision \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"keyName": "Hydra Test"}'
# → SUCCESS!
# {
#   "key": "sk-or-v1-e7e...367",
#   "source": "playwright"
# }
```

**Provisioning Flow (Working)**:
```
tRPC routes (12 variants) with fresh JWT → All return HTML (Next.js route collision)
  ↓
REST API fallback (4 endpoints) with fresh JWT → All fail (401 or HTML)
  ↓
Playwright browser automation with fresh JWT → SUCCESS! 🎉
  ↓
Key captured: sk-or-v1-e7e...367
```

**Cookie verification in successful request**:
```
[dashboard-api] tRPC cookies sent: __session, __client_uat, __client, __cf_bm, __client_uat_NO6jtgZM, _cfuvid
```

**Playwright success log**:
```
[playwrightCookiesForOpenRouter] Using fresh JWT for session
provision after goto management-keys { url: 'https://openrouter.ai/settings/management-keys', title: 'Management Keys | OpenRouter' }
after create/add control click attempt { clicked: true }
Found name input (trying to fill: "Hydra Fresh Test 2")
after fill name and submit
provision non-tRPC response contains management key
```

## Testing Methodology

1. **Create fresh OTP stub**: `POST /api/accounts/bulk-otp-stubs`
2. **Start OTP**: `POST /api/accounts/:id/otp/start` → get `signInId`
3. **Get email code** from user
4. **Verify immediately** (within 60s): `POST /api/accounts/:id/otp/verify`
   - Gets fresh JWT before auto-provisioning
   - Returns session expiry (should be ~420 minutes)
5. **Check result**: 
   - `{managementKey: true}` = immediate success
   - `{autoProvision: "failed"}` = manual provision needed
6. **Manual provision if needed**: `POST /api/accounts/:id/provision`
   - Tries tRPC with fresh JWT
   - Falls back to REST API
   - Falls back to Playwright (this works!)

**Debug checks**:
```bash
# Check if getFreshJwt works
node -e "
import * as store from './server/services/store.js';
const session = await store.getAccountSession(userId, accountId);
const fullCookie = \`__session=\${session.sessionCookie}; \${session.clientCookie}\`;
const res = await fetch('https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0', {
  headers: { 'Cookie': fullCookie }
});
const data = await res.json();
const freshJwt = data?.response?.sessions?.[0]?.last_active_token?.jwt;
console.log('Fresh JWT obtained:', !!freshJwt);
"

# Check tRPC with fresh JWT
curl -s 'https://openrouter.ai/api/trpc/managementKeys.list?batch=1' \
  -H "Cookie: __session=<fresh_jwt>; __client=<device>; __cf_bm=<cf>" \
  -H "Origin: https://openrouter.ai" \
  -H "Content-Type: application/json" \
  -d '{"0":{"json":{}}}'

# If tRPC returns HTML, check matched-path
# If REST API works, check /api/v1/auth/key
```

**If provisioning fails**, check logs for:
- `getFreshJwt` returning null (Clerk /client failing)
- `trpcCall` returning HTML (tRPC endpoint issue)
- `tryRestApiCreateKey` trying endpoints
- Browser automation starting (final fallback)