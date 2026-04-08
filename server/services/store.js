import { createHmac } from 'node:crypto';

import { prisma } from './db.js';
import { getProxyMasterSecret } from './local-secrets.js';
import { decrypt, decryptConfig, encrypt, encryptConfig } from './storage-codec.js';
import { logger } from './logger.js';
import { refreshSession, SESSION_EXPIRING_SOON_MS, validateSession } from './clerk-auth.js';

// In-memory cache for live session probe results.
// Key: accountId (string), Value: { status: string, expiresAt: number }
const _sessionStatusCache = new Map();
const SESSION_STATUS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Effective session expiry from stored config.
 *
 * Previously this took the min of JWT exp and stored expiry, but JWT exp (~2.5 min)
 * is NOT the session lifetime — it's just a short-lived proof token. The actual Clerk
 * session (backed by __client cookie) lasts ~7 days. We now store a realistic 7-day
 * expiry at login/refresh time, so just return that.
 *
 * @param {object} config - decrypted account config (sessionExpiry field)
 * @param {string} _sessionTokenPlain - unused (kept for call-site compat)
 */
export function resolveEffectiveSessionExpiry(config, _sessionTokenPlain) {
  return config.sessionExpiry || null;
}

/**
 * Determine session status based on actual API validation, NOT just JWT expiry.
 * 
 * User sessions last 12+ hours, but JWTs expire in ~2.5 minutes. 
 * We cannot rely on JWT expiry alone to determine session validity.
 * 
 * This function uses actual API call success (validateSession) to determine status.
 * 
 * @param {object} config - decrypted account config
 * @param {string} sessionTokenPlain - decrypted __session JWT or ''
 * @param {boolean} sessionDecryptFailed - whether decryption failed
 * @returns {Promise<string>} session status: 'active', 'expiring', 'expired', 'none', 'error', 'unknown'
 */
async function getSessionStatusAsync(config, sessionTokenPlain, sessionDecryptFailed, accountId = null) {
  if (sessionDecryptFailed) return 'error';

  const sessionCookie = sessionTokenPlain || config.sessionCookie || '';
  const hasSession = !!sessionCookie.trim();
  if (!hasSession) return 'none';

  const clientCookie = config.clientCookie ? String(config.clientCookie).trim() : '';
  const hasClientCookie = !!clientCookie;

  // Check in-memory cache first to avoid hammering Clerk.
  if (accountId) {
    const cached = _sessionStatusCache.get(accountId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.status;
    }
  }

  // Live probe: call GET /v1/client with __client cookie — ground truth for session health.
  // refreshSession returns non-null (with fresh JWT) if __client is valid, null if 401/dead.
  if (hasClientCookie) {
    let status;
    try {
      const result = await refreshSession(clientCookie, sessionCookie);
      status = result ? 'active' : 'expired';
    } catch {
      status = 'error';
    }
    if (accountId) {
      _sessionStatusCache.set(accountId, { status, expiresAt: Date.now() + SESSION_STATUS_CACHE_TTL_MS });
    }
    return status;
  }

  // No __client cookie — fall back to direct JWT validation.
  const isValid = await validateSession(sessionCookie);
  return isValid ? 'active' : 'expired';
}

/**
 * SYNC VERSION: Determine session status based on available data.
 * 
 * Checks the async validation cache first — if a recent getSessionStatusAsync()
 * result exists (from Dashboard probeAll or getStoredSessionStatus), returns
 * that immediately instead of the JWT heuristic.  This prevents false
 * "expiring" signals caused by short-lived JWTs on perfectly healthy 12-hour
 * Clerk sessions.
 * 
 * Falls back to JWT-based heuristic only on cold start / cache miss.
 * 
 * @param {object} config - decrypted account config
 * @param {string} sessionTokenPlain - decrypted __session JWT or ''
 * @param {boolean} sessionDecryptFailed - whether decryption failed
 * @param {string} [accountId] - account id for cache lookup
 * @returns {string} session status: 'active', 'expiring', 'expired', 'none', 'error', 'unknown'
 */
function getSessionStatus(config, sessionTokenPlain, sessionDecryptFailed, accountId) {
  if (sessionDecryptFailed) return 'error';

  const sessionCookie = sessionTokenPlain || config.sessionCookie || '';
  const hasSession = !!sessionCookie.trim();
  if (!hasSession) return 'none';

  // Prefer cached async validation result (ground truth) over JWT heuristic.
  if (accountId) {
    const cached = _sessionStatusCache.get(accountId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.status;
    }
  }

  // Fallback: stored sessionExpiry heuristic (cold start / cache miss only).
  // sessionExpiry is now a realistic 7-day TTL set at login/refresh, not JWT exp.
  const effective = resolveEffectiveSessionExpiry(config, sessionTokenPlain);
  if (!effective) return 'unknown';

  const expiryMs = new Date(effective).getTime();
  if (Number.isNaN(expiryMs)) return 'unknown';

  const now = Date.now();
  const remainingMs = expiryMs - now;

  // Session expired (realistic TTL, not JWT)
  if (remainingMs <= 0) return 'expired';

  // Expiring within 24h — warn user, auto-refresher will try
  if (remainingMs <= SESSION_EXPIRING_SOON_MS) return 'expiring';

  return 'active';
}

function readSessionPlainResult(account) {
  try {
    return { plain: decrypt(account.sessionToken) || '', decryptFailed: false };
  } catch {
    return { plain: '', decryptFailed: true };
  }
}

function readConfig(account) {
  try {
    return decryptConfig(account.config);
  } catch (err) {
    const error = new Error('Local vault unreadable. Restart Hydra or use Nuclear Reset to recreate local secrets.');
    error.cause = err;
    throw error;
  }
}

function readSessionToken(account) {
  try {
    return decrypt(account.sessionToken);
  } catch (err) {
    const error = new Error('Local session data unreadable. Restart Hydra or use Nuclear Reset to recreate local secrets.');
    error.cause = err;
    throw error;
  }
}

async function assertAccountUniqueForUser(userId, { alias, email }, excludeAccountId) {
  const normalizedAlias = (alias || '').trim().toLowerCase();
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedAlias && !normalizedEmail) return;

  const existing = await prisma.account.findMany({ where: { userId } });

  for (const account of existing) {
    if (excludeAccountId && account.id === excludeAccountId) continue;
    let config;
    try {
      config = readConfig(account);
    } catch {
      // Skip corrupt records; they will be purged by getAllAccountsWithKeys().
      continue;
    }

    if (normalizedAlias && (account.alias || '').trim().toLowerCase() === normalizedAlias) {
      const err = new Error(`Account alias already exists: "${alias}"`);
      err.status = 409;
      throw err;
    }

    if (normalizedEmail && (config.email || '').trim().toLowerCase() === normalizedEmail) {
      const err = new Error(`Account email already exists: "${email}"`);
      err.status = 409;
      throw err;
    }
  }
}

/** Session lifecycle label for one vault row (used by API and AccountController). 
 * Uses ACTUAL API VALIDATION to determine true session status.
 */
export async function getStoredSessionStatus(userId, id) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw new Error('Account not found');
  const config = readConfig(account);
  const { plain, decryptFailed } = readSessionPlainResult(account);
  // Use async version that validates via actual Clerk API call
  return getSessionStatusAsync(config, plain, decryptFailed, id);
}

/** Session row for `GET /api/accounts/:id/session-status` — never throws on decrypt (uses `readSessionPlainResult`).
 * Uses ACTUAL API VALIDATION to determine true session status.
 */
export async function getStoredSessionStatusPayload(userId, id) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw new Error('Account not found');
  const config = readConfig(account);
  const { plain, decryptFailed } = readSessionPlainResult(account);
  // Use async version that validates via actual Clerk API call
  const status = await getSessionStatusAsync(config, plain, decryptFailed, id);
  return {
    status,
    sessionExpiry: config.sessionExpiry ?? null,
    sessionDecryptFailed: decryptFailed,
  };
}

/**
 * Get all accounts for a user.
 * 
 * NOTE: Uses SYNC session status check (heuristic-based) for performance.
 * Sessions marked as 'expiring' will be validated via API before use.
 * For ACTUAL session validation, use getStoredSessionStatus() or ensureSession().
 */
export async function getAccounts(userId) {
  const accounts = await prisma.account.findMany({ where: { userId } });

  return accounts.map((account) => {
    const config = readConfig(account);
    const { plain, decryptFailed } = readSessionPlainResult(account);
    return {
      id: account.id,
      alias: account.alias,
      email: config.email,
      authMethod: config.authMethod,
      hasManagementKey: !!config.managementKey,
      /** True when a non-empty password is stored (encrypted). OTP-only accounts are false. */
      passwordOnFile: !!config.password,
      hasCredentials: !!(config.email && (config.password || config.authMethod === 'otp' || config.authMethod === 'password')),
      // Sync version checks async cache first, falls back to JWT heuristic on cache miss
      sessionStatus: getSessionStatus(config, plain, decryptFailed, account.id),
      sessionDecryptFailed: decryptFailed,
      lastSync: config.lastSync,
      lastLoginAt: config.lastLoginAt || null,
      sessionExpiry: config.sessionExpiry || null,
      events: config.events || [],
      createdAt: account.createdAt,
    };
  });
}

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

export async function getAllAccountsWithKeys(userId) {
  const accounts = await prisma.account.findMany({ where: { userId } });

  return accounts.flatMap((account) => {
    try {
      const config = readConfig(account);
      return [{
        ...account,
        ...config,
        sessionCookie: readSessionToken(account),
      }];
    } catch (err) {
      // Log and auto-purge accounts whose encrypted config is unreadable (stale secrets, schema mismatch)
      logger.error(`[STORE] Corrupt account detected (id=${account.id}, alias="${account.alias}") — purging: ${err.message}`);
      prisma.account.delete({ where: { id: account.id } }).catch(() => { });
      return [];
    }
  });
}

export async function addAccount(userId, alias, managementKey) {
  await assertAccountUniqueForUser(userId, { alias });
  const config = { managementKey, email: null, password: null, authMethod: null };
  const account = await prisma.account.create({
    data: {
      user: { connect: { id: userId } },
      alias,
      sessionToken: encrypt(''),
      config: encryptConfig(config),
    },
  });

  return { id: account.id, alias, createdAt: account.createdAt };
}

export async function addAccountWithCredentials(userId, alias, email, password, authMethod, managementKey = null) {
  await assertAccountUniqueForUser(userId, { alias, email });
  const config = { managementKey, email, password, authMethod: authMethod || 'password' };
  const account = await prisma.account.create({
    data: {
      user: { connect: { id: userId } },
      alias,
      sessionToken: encrypt(''),
      config: encryptConfig(config),
    },
  });

  return { id: account.id, alias, email, authMethod: config.authMethod, createdAt: account.createdAt };
}

export async function addAccountWithSessionCookie(userId, alias, sessionCookie) {
  await assertAccountUniqueForUser(userId, { alias });
  const config = { authMethod: 'oauth', email: null, password: null };
  const account = await prisma.account.create({
    data: {
      user: { connect: { id: userId } },
      alias,
      sessionToken: encrypt(sessionCookie || ''),
      config: encryptConfig(config),
    },
  });

  return { id: account.id, alias, authMethod: config.authMethod, createdAt: account.createdAt };
}

export async function updateAccount(userId, id, updates) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw new Error('Account not found');

  const config = readConfig(account);
  if (updates.managementKey !== undefined) config.managementKey = updates.managementKey;

  if (updates.email !== undefined) {
    const normalizedNew = updates.email.trim().toLowerCase();
    const currentEmail = (config.email || '').trim().toLowerCase();
    if (normalizedNew !== currentEmail) {
      await assertAccountUniqueForUser(userId, { email: updates.email }, id);
    }
    config.email = updates.email;
  }

  if (updates.authMethod !== undefined) {
    config.authMethod = updates.authMethod;
  }

  if (updates.password !== undefined && String(updates.password).length > 0) {
    config.password = updates.password;
  } else if (updates.email !== undefined && config.authMethod === 'otp') {
    config.password = null;
  }

  const updated = await prisma.account.update({
    where: { id },
    data: {
      alias: updates.alias || account.alias,
      config: encryptConfig(config),
    },
  });

  const next = readConfig(updated);
  return { id: updated.id, alias: updated.alias, email: next.email, authMethod: next.authMethod };
}

export async function deleteAccount(userId, id) {
  await prisma.account.deleteMany({ where: { id, userId } });
  return true;
}

/**
 * Log an event to the account's encrypted config (e.g. session changes, auth attempts).
 * Keeps the last 20 events.
 */
export async function logAccountEvent(userId, id, type, message) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) return;

  const config = readConfig(account);
  if (!config.events) config.events = [];
  
  config.events.unshift({
    type,
    message,
    timestamp: new Date().toISOString()
  });
  
  if (config.events.length > 20) {
    config.events = config.events.slice(0, 20);
  }

  await prisma.account.update({
    where: { id },
    data: { config: encryptConfig(config) }
  });
}

/**
 * @param {string|null|undefined} sessionCookie - JWT or empty; `null` clears; `undefined` with `preserveSessionToken` leaves vault token unchanged
 * @param {object} [options]
 * @param {boolean} [options.preserveSessionToken] - If true, do not write `sessionToken` (e.g. OTP start: refresh device cookie only)
 * @param {Record<string, number>} [options.cfCookieExpirations] - Cloudflare cookie expiration timestamps {cookieName: timestampMs}
 */
export async function updateAccountSession(userId, id, sessionCookie, clientCookie, sessionExpiry, options = {}) {
  const preserveSessionToken = options.preserveSessionToken === true;
  const cfCookieExpirations = options.cfCookieExpirations;
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw new Error('Account not found');

  const config = readConfig(account);
  if (clientCookie != null && String(clientCookie).trim() !== '' && String(clientCookie).trim() !== 'undefined') {
    config.clientCookie = String(clientCookie).trim();
    config.clientCookieIssuedAt = new Date().toISOString();
  }

  // Record when a new login session is established (not refreshes).
  // Enables session age display and auto-refresh scheduling.
  if (options.isNewLogin) {
    config.lastLoginAt = new Date().toISOString();
  }

  if (sessionExpiry !== undefined) {
    if (sessionExpiry === null && !preserveSessionToken) {
      config.sessionExpiry = null;
    } else if (sessionExpiry !== null) {
      config.sessionExpiry = sessionExpiry;
    }
  }

  // Store Cloudflare cookie expirations if provided
  if (cfCookieExpirations && typeof cfCookieExpirations === 'object') {
    config.cfCookieExpirations = { ...(config.cfCookieExpirations || {}), ...cfCookieExpirations };
  }

  const data = { config: encryptConfig(config) };
  if (!preserveSessionToken) {
    const cookie = sessionCookie == null ? '' : String(sessionCookie);
    data.sessionToken = encrypt(cookie);
  }

  await prisma.account.update({
    where: { id },
    data,
  });

  return true;
}

export async function getAccountSession(userId, id) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw new Error('Account not found');

  const config = readConfig(account);
  return {
    sessionCookie: readSessionToken(account),
    clientCookie: config.clientCookie,
    sessionExpiry: config.sessionExpiry,
    cfCookieExpirations: config.cfCookieExpirations || {},
    clientCookieIssuedAt: config.clientCookieIssuedAt || null,
  };
}

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

export async function updateAccountBalance(id, { remaining, total }) {
  await prisma.account.update({
    where: { id },
    data: {
      lastKnownBalance: remaining ?? null,
      totalCredits: total ?? null,
      lastKnownBalanceAt: new Date(),
    },
  });
}

export async function updateAccountLastSync(userId, id) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) return;

  const config = readConfig(account);
  config.lastSync = new Date().toISOString();

  await prisma.account.update({
    where: { id },
    data: { config: encryptConfig(config) },
  });
}

export async function getAllAccountsNeedingRefresh(userId) {
  const accounts = await getAllAccountsWithKeys(userId);
  const now = Date.now();

  return accounts.filter((account) => {
    const eff = resolveEffectiveSessionExpiry(account, account.sessionCookie || '');
    if (!eff) return !!(account.sessionCookie && String(account.sessionCookie).trim());
    return new Date(eff).getTime() - now < SESSION_EXPIRING_SOON_MS;
  });
}

export async function getDiscoveredEndpoints() {
  try {
    const discovery = await prisma.discovery.findUnique({ where: { id: 'singleton' } });
    return discovery ? JSON.parse(discovery.data) : {};
  } catch (err) {
    console.error('[STORE] Failed to get discovered endpoints:', err.message);
    return {};
  }
}

export async function saveDiscoveredEndpoints(newEndpoints) {
  try {
    const current = await getDiscoveredEndpoints();
    const updated = { ...current, ...newEndpoints };
    await prisma.discovery.upsert({
      where: { id: 'singleton' },
      update: { data: JSON.stringify(updated) },
      create: { id: 'singleton', data: JSON.stringify(updated) },
    });
    return updated;
  } catch (err) {
    console.error('[STORE] Failed to save discovered endpoints:', err.message);
    return {};
  }
}

export async function saveKey(userId, accountId, keyData) {
  const { hash, name, key: keyString, limit, limitRemaining, limitReset, isProvisioningKey } = keyData;

  return prisma.key.upsert({
    where: { hash },
    update: {
      name,
      limit,
      limitRemaining,
      limitReset,
      ...(keyString ? { key: encrypt(keyString) } : {}),
    },
    create: {
      hash,
      key: keyString ? encrypt(keyString) : null,
      name: name || 'Unnamed Key',
      label: name || 'Unnamed Key',
      isProvisioningKey: !!isProvisioningKey,
      limit,
      limitRemaining,
      limitReset,
      accountId,
    },
  });
}

export async function updateKeyPooledStatus(userId, hash, isPooled) {
  const keyRecord = await prisma.key.findFirst({
    where: { hash, account: { userId } },
  });
  if (!keyRecord) throw new Error('Key not found or access denied');
  if (isPooled && !keyRecord.key) {
    throw new Error('Cannot pool a key until its raw key string has been saved.');
  }

  return prisma.key.update({
    where: { hash },
    data: { isPooled },
  });
}

/**
 * First decrypted standard (non-provisioning) API key for the user — e.g. catalog fetch when pool is empty.
 */
export async function getFirstStoredApiKeyString(userId) {
  const keyRecord = await prisma.key.findFirst({
    where: {
      account: { userId },
      NOT: { key: null },
      disabled: false,
      isProvisioningKey: false,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!keyRecord?.key) return null;
  try {
    return decrypt(keyRecord.key);
  } catch {
    return null;
  }
}

export async function getPooledKeys(userId) {
  const keys = await prisma.key.findMany({
    where: {
      isPooled: true,
      disabled: false,
      account: { userId },
    },
    include: { account: true },
  });

  return keys
    .map((keyRecord) => ({
      ...keyRecord,
      keyString: keyRecord.key ? decrypt(keyRecord.key) : null,
    }))
    .filter((keyRecord) => keyRecord.keyString);
}

export async function getLocalKeys(userId, accountId) {
  const keys = await prisma.key.findMany({
    where: { accountId, account: { userId } },
  });

  return keys.map((keyRecord) => {
    let key = null;
    if (keyRecord.key) {
      try {
        key = decrypt(keyRecord.key) || null;
      } catch {
        key = null;
      }
    }
    return {
      ...keyRecord,
      key,
    };
  });
}

export async function registerKeyString(userId, hash, rawKeyString) {
  const normalizedKey = rawKeyString?.trim();
  if (!normalizedKey) {
    throw new Error('Invalid key format. Key cannot be empty.');
  }

  const keyRecord = await prisma.key.findFirst({
    where: { hash, account: { userId } },
  });
  if (!keyRecord) throw new Error('Key not found or access denied');

  return prisma.key.update({
    where: { hash },
    data: { key: encrypt(normalizedKey) },
  });
}

export async function bulkUpdateAccountPooled(userId, accountId, isPooled) {
  const { count } = await prisma.key.updateMany({
    where: { accountId, account: { userId }, NOT: { key: null } },
    data: { isPooled },
  });
  return count;
}

export function getMasterProxyKey() {
  const hmac = createHmac('sha256', getProxyMasterSecret());
  hmac.update('hydra-master-proxy');
  return `sk-hydra-${hmac.digest('hex').slice(0, 32)}`;
}

export function getGenericProxyKey() {
  const hmac = createHmac('sha256', getProxyMasterSecret());
  hmac.update('hydra-generic-proxy');
  return `sk-proj-${hmac.digest('hex').slice(0, 48)}`;
}

export async function syncKeysFromOpenRouter(userId, accountId, liveKeys) {
  for (const keyRecord of liveKeys) {
    await prisma.key.upsert({
      where: { hash: keyRecord.hash },
      update: {
        name: keyRecord.name || keyRecord.label || 'Unnamed',
        limit: keyRecord.limit ?? null,
        limitRemaining: keyRecord.limit_remaining ?? null,
        limitReset: keyRecord.limit_reset ?? null,
        usage: keyRecord.usage_including_upstream ?? null,
        disabled: keyRecord.disabled ?? false,
      },
      create: {
        hash: keyRecord.hash,
        label: keyRecord.label || keyRecord.name || 'Unnamed',
        name: keyRecord.name || keyRecord.label || 'Unnamed',
        isProvisioningKey: keyRecord.is_provisioning_key ?? false,
        disabled: keyRecord.disabled ?? false,
        isPooled: false,
        limit: keyRecord.limit ?? null,
        limitRemaining: keyRecord.limit_remaining ?? null,
        limitReset: keyRecord.limit_reset ?? null,
        usage: keyRecord.usage_including_upstream ?? null,
        accountId,
      },
    });
  }
}

export async function getSettings() {
  return { refreshInterval: 300000, theme: 'dark' };
}

export async function updateSettings(settings) {
  return settings;
}

export async function getAccountOwnerOfKey(userId, hash) {
  const key = await prisma.key.findFirst({
    where: { hash, account: { userId } },
    include: { account: true },
  });
  if (!key) return null;
  const config = readConfig(key.account);
  return { ...key.account, managementKey: config.managementKey };
}

export async function deleteKey(userId, hash) {
  await prisma.key.deleteMany({ where: { hash, account: { userId } } });
}
