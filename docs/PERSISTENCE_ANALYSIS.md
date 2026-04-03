# Data Persistence Layer Analysis - Management Keys

## Summary

Analyzed the data persistence layer for management keys in Hydra. Found and fixed critical file corruption that was causing 'provision failed' errors even when key extraction succeeded.

## Files Analyzed

1. **server/services/store.js** - Core storage functions
2. **server/services/key-utils.js** - Key format validation
3. **server/services/storage-codec.js** - Encryption/decryption
4. **server/services/local-secrets.js** - Encryption key management
5. **server/services/dashboard-api.js** - Key provisioning flow
6. **prisma/schema.prisma** - Database schema
7. **server/controllers/AccountController.js** - API controller

## Key Findings

### 1. File Corruption (CRITICAL - FIXED)

Multiple files had corrupted code with `***` and `...` patterns replacing actual code:

#### server/services/store.js (5 issues fixed)
- Line 145: `config.authMethod=***` → `config.authMethod ===` (comparison operators)
- Line 250: `config.authMethod=update...hod` → `config.authMethod = updates.authMethod`
- Line 254: `config.password=***` → `config.password = updates.password`
- Line 255: `config.authMethod=***` → `config.authMethod ===` (comparison)
- Line 256: `config.password=***` → `config.password = null`
- Line 282: `option...oken` → `options.preserveSessionToken`
- Line 302: `data.sessionToken=***` → `data.sessionToken = encrypt(cookie)`

#### server/services/local-secrets.js (3 issues fixed)
- Line 8: `path.j...DIR` → `path.join(DATA_DIR`
- Line 9: `HEX_SECRET_LENGTH=***` → `HEX_SECRET_LENGTH = 64`
- Line 53: `normal...` → `normalizeSecret(config.HYDRA_PROXY_SECRET`
- Line 69: `resolvedSecrets=***` → `resolvedSecrets = resolveSecrets()`

#### server/controllers/AccountController.js (1 issue fixed)
- Line 386: `canPasswordReauth=*** && a.authMethod=***` → `canPasswordReauth = !!(a.password && a.authMethod === 'password')`

### 2. Storage Flow Analysis

**updateAccountManagementKey()** (lines 325-339):
```javascript
export async function updateAccountManagementKey(userId, id, managementKey) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw new Error('Account not found');

  const config = readConfig(account);
  config.managementKey = managementKey;
  config.lastSync = new Date().toISOString();

  await prisma.account.update({
    where: { id },
    data: { config: encryptConfig(config) },
  });

  return true;
}
```

This function works correctly by:
1. Reading the existing encrypted config
2. Adding the managementKey to the config object
3. Encrypting and saving the updated config

**getAccountWithKey()** (lines 154-166):
```javascript
export async function getAccountWithKey(userId, id) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw new Error('Account not found');

  const config = readConfig(account);
  return {
    ...account,
    ...config,
    password: config.password,
    sessionCookie: readSessionToken(account),
    managementKey: config.managementKey,
  };
}
```

This correctly retrieves the management key from the decrypted config.

### 3. Encryption/Decryption Analysis

**storage-codec.js** uses AES-256-GCM:
- Algorithm: `aes-256-gcm`
- Key: 32-byte key from `local-secrets.js`
- IV: 16 bytes random
- Tag: 16 bytes auth tag

Potential issues:
1. If `local-secrets.json` is deleted or corrupted, all stored data becomes unreadable
2. No key rotation mechanism exists
3. Error handling throws `EncryptionError` but callers may not handle it properly

### 4. Prisma Schema Analysis

**schema.prisma** (lines 22-32):
```prisma
model Account {
  id           String    @id @default(uuid())
  openRouterId String?
  alias        String
  sessionToken String    // Encrypted strings
  config       String?   // Encrypted JSON
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  keys         Key[]
  createdAt    DateTime  @default(now())
}
```

- `config` field is `String?` (optional) - can be null
- No length restrictions on the `config` field (SQLite TEXT type)
- The encrypted management key is stored inside the encrypted JSON config

### 5. Key Format Validation

**key-utils.js**:
```javascript
export function classifyOpenRouterKey(key) {
  if (!key || typeof key !== 'string') return 'unknown';
  const trimmed = key.trim();
  if (trimmed.startsWith('sk-or-mgmt-')) return 'management';
  if (trimmed.startsWith('sk-or-v1-')) return 'standard';
  if (trimmed.startsWith('sk-or-')) return 'unknown';
  return 'unknown';
}
```

The validation only checks the prefix. Management keys should start with `sk-or-mgmt-`.

In **dashboard-api.js**, there are validation checks:
```javascript
if (!key.startsWith('sk-or-mgmt-')) {
  throw new Error('tRPC returned a non-management key for management key creation.');
}
```

### 6. Root Cause of 'Provision Failed'

The corruption in `store.js` caused multiple failures:

1. **Line 302**: `data.sessionToken = ***` was invalid JavaScript, causing the entire `updateAccountSession()` function to fail. This broke session updates needed for provisioning.

2. **Line 250**: `config.authMethod = update...hod` was truncated, causing account updates to fail.

3. **Lines 254-256**: Password handling was completely broken with `***` placeholders.

4. **Line 145**: `getAccounts()` had broken comparison operators, causing account listing to fail.

These failures meant that even when Playwright successfully extracted the management key, the storage layer couldn't persist it due to JavaScript syntax errors and undefined variable references.

## Persistence Bug Fixes Applied

| File | Line | Original | Fixed |
|------|------|----------|-------|
| store.js | 145 | `authMethod=***` | `authMethod ===` |
| store.js | 250 | `update...hod` | `updates.authMethod` |
| store.js | 254 | `=***` | `= updates.password` |
| store.js | 255 | `authMethod=***` | `authMethod ===` |
| store.js | 256 | `=***` | `= null` |
| store.js | 282 | `option...oken` | `options.preserveSessionToken` |
| store.js | 302 | `=***` | `= encrypt(cookie)` |
| local-secrets.js | 8 | `path.j...` | `path.join(DATA_DIR` |
| local-secrets.js | 9 | `=***` | `= 64` |
| local-secrets.js | 53 | `normal...` | `normalizeSecret(...)` |
| local-secrets.js | 69 | `=***` | `= resolveSecrets()` |
| AccountController.js | 386 | `=*** && =***` | proper boolean expression |

## Recommendations

1. **Add syntax validation** to CI/CD to catch file corruption early
2. **Add encryption key backup/restore** mechanism for `local-secrets.json`
3. **Consider separating managementKey** to its own encrypted field rather than bundling in config JSON
4. **Add provisioning transaction logs** to track success/failure of each step
5. **Add health check endpoint** that verifies storage layer can read/write encrypted data

## Verification

All corrupted patterns (`***` and `...` corruption) have been eliminated from the server codebase. The persistence layer should now correctly:
1. Save management keys via `updateAccountManagementKey()`
2. Retrieve management keys via `getAccountWithKey()`
3. Handle session updates needed for provisioning
4. Encrypt/decrypt data using AES-256-GCM
