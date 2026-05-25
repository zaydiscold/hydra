import { createHmac } from 'node:crypto';

import { prisma } from './db.js';
import { getProxyMasterSecret } from './local-secrets.js';
import { decrypt, decryptConfig, encrypt, encryptConfig } from './storage-codec.js';
import { logger } from './logger.js';
import { refreshSession, SESSION_EXPIRING_SOON_MS, validateSession } from './clerk-auth.js';
import {
  backfillLegacyManagementKey,
  getBestManagementKey,
  storeManagementKey,
} from './management-key-store.js';

// In-memory cache for live session probe results.
// Key: accountId (string), Value: { status: string, expiresAt: number }
const _sessionStatusCache = new Map();
const SESSION_STATUS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function invalidateSessionStatusCache(accountId) {
  _sessionStatusCache.delete(accountId);
}

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
 * @param {string|null} accountId - account id for cache lookup
 * @param {string|null} userId - owner user id; when provided, persists fresh cookies returned by Clerk
 * @returns {Promise<string>} session status: 'active', 'expiring', 'expired', 'none', 'error', 'unknown'
 */
async function getSessionStatusAsync(config, sessionTokenPlain, sessionDecryptFailed, accountId = null, userId = null, { bypassCache = false } = {}) {
  if (sessionDecryptFailed) return 'error';

  const sessionCookie = sessionTokenPlain || config.sessionCookie || '';
  const hasSession = !!sessionCookie.trim();
  if (!hasSession) return 'none';

  // Check in-memory cache first to avoid hammering Clerk (skipped when bypassCache=true).
  if (accountId && !bypassCache) {
    const cached = _sessionStatusCache.get(accountId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.status;
    }
  }

  // Live probe: call GET /v1/client with __client cookie — ground truth for session health.
  // Exploit #14: Pass full cookie stack so refreshSession tries newest-first automatically.
  // Use normalizeClientCookies to cover both legacy string field AND new array field.
  const cookieStack = normalizeClientCookies(config);
  if (cookieStack.length > 0) {
    let status;
    let result;
    try {
      const cookieInput = cookieStack;
      result = await refreshSession(cookieInput, sessionCookie);
      status = result ? 'active' : 'expired';
    } catch (err) {
      logger.warn(`[SESSION] Live refresh probe failed for account=${accountId || 'unknown'}: ${err.message}`);
      status = 'error';
    }

    // Persist the fresh __client cookie Clerk returned — prevents false 'expired' on next probe.
    // Fire-and-forget: don't block the status response on a DB write.
    if (result && userId && accountId) {
      updateAccountSession(
        userId, accountId,
        result.sessionToken || result.sessionCookie || undefined,
        result.clientCookie || undefined,
        result.sessionExpiry || undefined,
      ).catch((err) => {
        logger.warn(`[SESSION] Failed to persist refreshed session probe result for account=${accountId}: ${err.message}`);
      });
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
  } catch (err) {
    logger.warn(`[STORE] Stored session token decrypt failed for account=${account.id}: ${err.message}`);
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

function clerkSessionIdFromJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1] || '', 'base64url').toString('utf8'));
    return payload?.sid || payload?.session_id || payload?.sessionId || null;
  } catch {
    return null;
  }
}

export async function revokeSessionsByClerkSessionId(clerkSessionId, reason = 'clerk_webhook') {
  const targetSid = String(clerkSessionId || '').trim();
  if (!targetSid) return { matched: 0, revoked: 0 };

  const accounts = await prisma.account.findMany({
    select: {
      id: true,
      userId: true,
      sessionToken: true,
      config: true,
    },
  });

  let matched = 0;
  let revoked = 0;
  for (const account of accounts) {
    const { plain } = readSessionPlainResult(account);
    if (clerkSessionIdFromJwt(plain) !== targetSid) continue;

    matched++;
    const config = readConfig(account);
    config.sessionExpiry = null;
    config.sessionRevokedAt = new Date().toISOString();
    config.sessionRevokedReason = reason;
    config.sessionRefreshedAt = null;
    config.events = Array.isArray(config.events) ? config.events : [];
    config.events.unshift({
      type: 'SESSION_REVOKED',
      message: `Clerk session ${targetSid} revoked via webhook (${reason})`,
      timestamp: new Date().toISOString(),
    });
    if (config.events.length > 20) config.events = config.events.slice(0, 20);

    await prisma.account.update({
      where: { id: account.id },
      data: {
        sessionToken: encrypt(''),
        config: encryptConfig(config),
      },
    });
    invalidateSessionStatusCache(account.id);
    revoked++;
  }

  return { matched, revoked };
}

async function canonicalizeManagementKeyState(account) {
  const config = readConfig(account);
  const legacyManagementKey = typeof config.managementKey === 'string' ? config.managementKey.trim() : '';
  let bestManagementKey = await getBestManagementKey(account.id);

  if (legacyManagementKey) {
    try {
      const backfill = await backfillLegacyManagementKey(account.id, legacyManagementKey);
      if (backfill?.backfilled) {
        bestManagementKey = await getBestManagementKey(account.id);
      }
    } catch (err) {
      logger.warn(`[STORE] Failed to backfill legacy management key for account=${account.id}: ${err.message}`);
    }

    const cleanedConfig = { ...config };
    delete cleanedConfig.managementKey;
    try {
      await prisma.account.update({
        where: { id: account.id },
        data: { config: encryptConfig(cleanedConfig) },
      });
    } catch (err) {
      logger.warn(`[STORE] Failed to clear legacy management key config for account=${account.id}: ${err.message}`);
    }

    return {
      config: cleanedConfig,
      bestManagementKey,
      managementKey: bestManagementKey?.key || null,
    };
  }

  return {
    config,
    bestManagementKey,
    managementKey: bestManagementKey?.key || null,
  };
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
    } catch (err) {
      logger.warn(`[STORE] Skipping unreadable account during uniqueness check id=${account.id}: ${err.message}`);
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
  // Pass userId so fresh cookies are persisted after probe — prevents false 'expired' on next cache miss.
  return getSessionStatusAsync(config, plain, decryptFailed, id, userId);
}

/** Session row for `GET /api/accounts/:id/session-status` — cached/heuristic display read.
 * Never performs a live Clerk probe directly. Use probeSessionLive() for action-gated truth.
 */
export async function getStoredSessionStatusPayload(userId, id) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw new Error('Account not found');
  const config = readConfig(account);
  const { plain, decryptFailed } = readSessionPlainResult(account);
  // Display-only status: can read prior async probe cache, but does not trigger a new live probe.
  const status = getSessionStatus(config, plain, decryptFailed, id);
  return {
    status,
    sessionExpiry: config.sessionExpiry ?? null,
    sessionDecryptFailed: decryptFailed,
  };
}

/**
 * Force a fresh live Clerk probe, bypassing the 5-minute session status cache.
 * Use for `GET /api/accounts/:id/session-check` (manual re-check button).
 * More expensive than getStoredSessionStatusPayload — only call on user demand.
 */
export async function probeSessionLive(userId, id) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw new Error('Account not found');
  const config = readConfig(account);
  const { plain, decryptFailed } = readSessionPlainResult(account);
  // bypassCache: true — skip the in-memory TTL so Clerk is always queried
  const status = await getSessionStatusAsync(config, plain, decryptFailed, id, userId, { bypassCache: true });
  return {
    status,
    sessionExpiry: config.sessionExpiry ?? null,
    sessionDecryptFailed: decryptFailed,
    live: true, // signal to the client that this was a real probe
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

  const shaped = await Promise.all(accounts.map(async (account) => {
    const { config, managementKey } = await canonicalizeManagementKeyState(account);
    const { plain, decryptFailed } = readSessionPlainResult(account);
    return {
      id: account.id,
      alias: account.alias,
      email: config.email,
      authMethod: config.authMethod,
      hasManagementKey: !!managementKey,
      /** True when a non-empty password is stored (encrypted). OTP-only accounts are false. */
      passwordOnFile: !!config.password,
      hasCredentials: !!(config.email && (config.password || config.authMethod === 'otp' || config.authMethod === 'password')),
      // Sync version checks async cache first, falls back to JWT heuristic on cache miss
      sessionStatus: getSessionStatus(config, plain, decryptFailed, account.id),
      sessionDecryptFailed: decryptFailed,
      lastSync: config.lastSync,
      lastLoginAt: config.lastLoginAt || null,
      sessionRefreshedAt: config.sessionRefreshedAt || null,
      sessionExpiry: config.sessionExpiry || null,
      events: config.events || [],
      createdAt: account.createdAt,
      // Accounts in the OTP wizard that haven't verified yet are hidden from the dashboard.
      pendingVerification: !!config.pendingVerification,
    };
  }));

  // Hide OTP stub accounts that haven't completed sign-in yet.
  return shaped.filter((a) => !a.pendingVerification);
}

export async function getAccountWithKey(userId, id) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw new Error('Account not found');

  const { config, managementKey } = await canonicalizeManagementKeyState(account);
  // Exploit #14: Cookie stacking — normalize clientCookies array
  const clientCookiesStack = normalizeClientCookies(config);
  return {
    ...account,
    ...config,
    clientCookies: clientCookiesStack,
    password: config.password,
    sessionCookie: readSessionToken(account),
    managementKey,
  };
}

export async function getAllAccountsWithKeys(userId) {
  const accounts = await prisma.account.findMany({ where: { userId } });

  const hydrated = await Promise.all(accounts.map(async (account) => {
    try {
      const { config, managementKey } = await canonicalizeManagementKeyState(account);
      const { plain, decryptFailed } = readSessionPlainResult(account);
      // Exploit #14: Cookie stacking — normalize clientCookies array for hydrated accounts
      const clientCookiesStack = normalizeClientCookies(config);
      return [{
        ...account,
        ...config,
        email: config.email,
        authMethod: config.authMethod,
        hasManagementKey: !!managementKey,
        passwordOnFile: !!config.password,
        hasCredentials: !!(config.email && (config.password || config.authMethod === 'otp' || config.authMethod === 'password')),
        sessionStatus: getSessionStatus(config, plain, decryptFailed, account.id),
        sessionDecryptFailed: decryptFailed,
        clientCookies: clientCookiesStack,
        managementKey,
        sessionCookie: readSessionToken(account),
      }];
    } catch (err) {
      // Log and auto-purge accounts whose encrypted config is unreadable (stale secrets, schema mismatch)
      logger.error(`[STORE] Corrupt account detected (id=${account.id}, alias="${account.alias}") — purging: ${err.message}`);
      prisma.account.delete({ where: { id: account.id } }).catch((deleteErr) => {
        logger.error(`[STORE] Failed to purge corrupt account id=${account.id}: ${deleteErr.message}`);
      });
      return [];
    }
  }));

  return hydrated.flat().filter((a) => !a.pendingVerification);
}

export async function addAccount(userId, alias, managementKey) {
  await assertAccountUniqueForUser(userId, { alias });
  const config = { email: null, password: null, authMethod: null };
  const account = await prisma.account.create({
    data: {
      user: { connect: { id: userId } },
      alias,
      sessionToken: encrypt(''),
      config: encryptConfig(config),
    },
  });

  if (managementKey) {
    await storeManagementKey(account.id, managementKey, 'Hydra Initial Key', {
      importedAt: new Date().toISOString(),
      via: 'account.create',
    });
  }

  return { id: account.id, alias, createdAt: account.createdAt };
}

export async function addAccountWithCredentials(userId, alias, email, password, authMethod, managementKey = null, { pendingVerification = false } = {}) {
  await assertAccountUniqueForUser(userId, { alias, email });
  const config = { email, password, authMethod: authMethod || 'password', pendingVerification: pendingVerification || undefined };
  const account = await prisma.account.create({
    data: {
      user: { connect: { id: userId } },
      alias,
      sessionToken: encrypt(''),
      config: encryptConfig(config),
    },
  });

  if (managementKey) {
    await storeManagementKey(account.id, managementKey, 'Hydra Initial Key', {
      importedAt: new Date().toISOString(),
      via: 'account.create_with_credentials',
    });
  }

  return { id: account.id, alias, email, authMethod: config.authMethod, createdAt: account.createdAt };
}

/**
 * Clear the pendingVerification flag after OTP is successfully verified.
 * This makes the account visible on the dashboard.
 */
export async function clearPendingVerification(userId, id) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) return;
  const config = readConfig(account);
  if (!config.pendingVerification) return; // already clear — skip unnecessary write
  delete config.pendingVerification;
  await prisma.account.update({ where: { id }, data: { config: encryptConfig(config) } });
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
  const managementKey = updates.managementKey;

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
      alias: updates.alias !== undefined ? updates.alias : account.alias,
      config: encryptConfig(config),
    },
  });

  if (managementKey !== undefined) {
    await updateAccountManagementKey(userId, id, managementKey, {
      name: 'Hydra Updated Key',
      metadata: { via: 'account.update' },
    });
  }

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
 * @param {Array<{cookie: string, issuedAt?: string}>} [options.replaceClientCookies] - Replace stored cookie stack before optional append
 */
/** Maximum stacked __client cookies per account (Exploit #14: Cookie stacking). */
const MAX_STACKED_CLIENT_COOKIES = 25;

/**
 * Normalize config.clientCookie / config.clientCookies into the new array format.
 * Backward compat: if readConfig returns a string clientCookie, convert to single-element array.
 * Exploit #14: Cookie stacking — clientCookie string → clientCookies array of {cookie, issuedAt}.
 */
export function normalizeClientCookies(config) {
  // New format already present
  if (Array.isArray(config.clientCookies) && config.clientCookies.length > 0) {
    return config.clientCookies;
  }
  // Legacy: string clientCookie → single-element array
  const cc = config.clientCookie ? String(config.clientCookie).trim() : '';
  if (cc && cc !== 'undefined') {
    const issuedAt = config.clientCookieIssuedAt || new Date().toISOString();
    return [{ cookie: cc, issuedAt }];
  }
  // Neither — empty array
  return [];
}

/**
 * Append a new client cookie to the stack (Exploit #14).
 * Does NOT overwrite existing cookies — stacks them newest-first.
 * Enforces MAX_STACKED_CLIENT_COOKIES cap (25).
 * @param {Array<{cookie: string, issuedAt: string}>} existing
 * @param {string} newCookie - New __client cookie string from Set-Cookie
 * @returns {Array<{cookie: string, issuedAt: string}>} Updated stack
 */
export function appendClientCookie(existing, newCookie) {
  if (!newCookie || typeof newCookie !== 'string') return existing;
  const trimmed = newCookie.trim();
  if (!trimmed || trimmed === 'undefined') return existing;

  const stack = Array.isArray(existing) ? [...existing] : normalizeClientCookies({ clientCookie: existing });

  // Dedup: if this exact cookie string already exists, move it to front (renew)
  const dupIdx = stack.findIndex(e => e.cookie === trimmed);
  if (dupIdx >= 0) {
    const [dup] = stack.splice(dupIdx, 1);
    dup.issuedAt = new Date().toISOString();
    stack.unshift(dup);
    return stack.slice(0, MAX_STACKED_CLIENT_COOKIES);
  }

  // Append newest-first
  stack.unshift({ cookie: trimmed, issuedAt: new Date().toISOString() });
  return stack.slice(0, MAX_STACKED_CLIENT_COOKIES);
}

/**
 * Get the most recent (newest) client cookie from the stack.
 * Falls back to legacy config.clientCookie string for backward compat.
 */
export function getLatestClientCookie(config) {
  const stack = normalizeClientCookies(config);
  return stack.length > 0 ? stack[0].cookie : '';
}


export async function updateAccountSession(userId, id, sessionCookie, clientCookie, sessionExpiry, options = {}) {
  const preserveSessionToken = options.preserveSessionToken === true;
  const cfCookieExpirations = options.cfCookieExpirations;
  const replaceClientCookies = Array.isArray(options.replaceClientCookies)
    ? options.replaceClientCookies
        .filter((entry) => entry && typeof entry.cookie === 'string' && entry.cookie.trim() && entry.cookie.trim() !== 'undefined')
        .map((entry) => ({ cookie: entry.cookie.trim(), issuedAt: entry.issuedAt || new Date().toISOString() }))
        .slice(0, MAX_STACKED_CLIENT_COOKIES)
    : null;
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw new Error('Account not found');

  const config = readConfig(account);

  if (replaceClientCookies) {
    config.clientCookies = replaceClientCookies;
    config.clientCookie = replaceClientCookies[0]?.cookie || '';
    config.clientCookieIssuedAt = replaceClientCookies[0]?.issuedAt || null;
  }

  // Exploit #14: Cookie stacking — append new clientCookie instead of overwrite.
  // If clientCookie is provided and non-empty, stack it onto clientCookies array.
  if (clientCookie != null && String(clientCookie).trim() !== '' && String(clientCookie).trim() !== 'undefined') {
    const newCookieStr = String(clientCookie).trim();
    const existingStack = normalizeClientCookies(config);
    config.clientCookies = appendClientCookie(existingStack, newCookieStr);
    // Keep legacy clientCookie in sync for backward compat readers
    config.clientCookie = config.clientCookies[0]?.cookie || config.clientCookie;
    config.clientCookieIssuedAt = config.clientCookies[0]?.issuedAt || new Date().toISOString();
  }

  // Record when a new login session is established (not refreshes).
  // Enables session age display and auto-refresh scheduling.
  if (options.isNewLogin) {
    config.lastLoginAt = new Date().toISOString();
  }

  config.sessionRefreshedAt = new Date().toISOString();

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
  invalidateSessionStatusCache(id);

  return true;
}

export async function getAccountSession(userId, id) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw new Error('Account not found');

  const config = readConfig(account);
  // Exploit #14: Cookie stacking — return clientCookies array alongside legacy clientCookie
  const clientCookiesStack = normalizeClientCookies(config);
  return {
    sessionCookie: readSessionToken(account),
    clientCookie: config.clientCookie,
    clientCookies: clientCookiesStack,
    sessionExpiry: config.sessionExpiry,
    cfCookieExpirations: config.cfCookieExpirations || {},
    clientCookieIssuedAt: config.clientCookieIssuedAt || null,
  };
}

export async function updateAccountManagementKey(userId, id, managementKey, { name = 'Hydra Auto Key', metadata = {} } = {}) {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw new Error('Account not found');

  const config = readConfig(account);
  config.lastSync = new Date().toISOString();

  await storeManagementKey(id, managementKey, name, {
    provisionedAt: new Date().toISOString(),
    via: 'updateAccountManagementKey',
    ...metadata,
  });
  delete config.managementKey;

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
  } catch (err) {
    logger.warn(`[STORE] Failed to decrypt first stored API key hash=${keyRecord.hash}: ${err.message}`);
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
      } catch (err) {
        logger.warn(`[STORE] Failed to decrypt local key hash=${keyRecord.hash}: ${err.message}`);
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
  const operations = liveKeys.map((keyRecord) => {
    return prisma.key.upsert({
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
  });

  await prisma.$transaction(operations);
}


export async function getAccountOwnerOfKey(userId, hash) {
  const key = await prisma.key.findFirst({
    where: { hash, account: { userId } },
    include: { account: true },
  });
  if (!key) return null;
  const { managementKey } = await canonicalizeManagementKeyState(key.account);
  return { ...key.account, managementKey };
}

export async function deleteKey(userId, hash) {
  await prisma.key.deleteMany({ where: { hash, account: { userId } } });
}
