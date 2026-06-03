import { logger } from './logger.js';
import { combineAbortSignals, sleepWithSignal, throwIfAborted } from '../lib/abort.js';

const BASE_URL = 'https://openrouter.ai/api/v1';

const RETRY_DELAYS = [500, 1000, 2000];
const DEFAULT_TIMEOUT_MS = 30000;
export const KEY_METADATA_PATH = '/key';
export const LEGACY_KEY_METADATA_PATH = '/auth/key';

export async function fetchKeyMetadataResponse(apiKey, {
  baseUrl = BASE_URL,
  signal = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  headers = {},
} = {}) {
  const fetchPath = (path) => fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      ...headers,
    },
    signal: combineAbortSignals(signal, AbortSignal.timeout(timeoutMs)),
  });

  const canonical = await fetchPath(KEY_METADATA_PATH);
  if (canonical.status !== 404) return canonical;

  logger.warn(`[OpenRouter] ${KEY_METADATA_PATH} returned 404; trying legacy ${LEGACY_KEY_METADATA_PATH}`);
  return fetchPath(LEGACY_KEY_METADATA_PATH);
}

async function apiRequest(path, managementKey, options = {}) {
  const { method = 'GET', body, retries = 2, timeoutMs = DEFAULT_TIMEOUT_MS, signal = null } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfAborted(signal);
    try {
      const fetchOptions = {
        method,
        headers: {
          'Authorization': `Bearer ${managementKey}`,
          'Content-Type': 'application/json',
        },
      };

      if (body && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body);
      }

      fetchOptions.signal = combineAbortSignals(signal, AbortSignal.timeout(timeoutMs));

      const response = await fetch(`${BASE_URL}${path}`, fetchOptions);

      if (response.status === 429) {
        if (attempt < retries) {
          await sleepWithSignal(RETRY_DELAYS[attempt] || 2000, signal);
          continue;
        }
        throw new Error('Rate limited by OpenRouter. Please try again later.');
      }

      if (!response.ok) {
        const errorBody = await response.text();
        let message;
        try {
          const parsed = JSON.parse(errorBody);
          message = parsed.error?.message || parsed.message || errorBody;
        } catch {
          message = errorBody;
        }
        const err = new Error(`OpenRouter API error (${response.status}): ${message}`);
        err.status = response.status;
        throw err;
      }

      return await response.json();
    } catch (err) {
      throwIfAborted(signal);
      if (attempt < retries && (err.code === 'ECONNRESET' || err.name === 'TimeoutError')) {
        await sleepWithSignal(RETRY_DELAYS[attempt] || 1000, signal);
        continue;
      }
      if (err.name === 'TimeoutError') {
        throw new Error(`OpenRouter API request timed out after ${timeoutMs}ms: ${path}`);
      }
      throw err;
    }
  }
}

// Credits
export async function getCredits(managementKey, options = {}) {
  const result = await apiRequest('/credits', managementKey, options);
  const d = result.data ?? {};
  const total = Number(d.total_credits ?? d.total ?? 0);
  const used = Number(d.total_usage ?? d.used ?? 0);
  const safeTotal = Number.isFinite(total) ? total : 0;
  const safeUsed = Number.isFinite(used) ? used : 0;
  return {
    total: safeTotal,
    used: safeUsed,
    remaining: safeTotal - safeUsed,
  };
}

// API Keys
export async function listKeys(managementKey, includeDisabled = true, options = {}) {
  const qs = includeDisabled ? '?include_disabled=true' : '';
  const result = await apiRequest(`/keys${qs}`, managementKey, options);
  const data = result?.data;
  return Array.isArray(data) ? data : [];
}

export async function createKey(managementKey, { name, limit, limitReset, includeByokInLimit, expiresAt }, options = {}) {
  const body = { name };
  if (limit !== undefined && limit !== null) body.limit = limit;
  if (limitReset) body.limit_reset = limitReset;
  if (includeByokInLimit !== undefined) body.include_byok_in_limit = includeByokInLimit;
  if (expiresAt) body.expires_at = expiresAt;

  const result = await apiRequest('/keys', managementKey, { ...options, method: 'POST', body });
  return { data: result.data, key: result.key };
}

// GET /keys/{hash} exists upstream but returns metadata only (no secret per OpenRouter OpenAPI).
// Do not add a wrapper that implies we can "fetch" a lost sk-or-v1 string.

export async function updateKey(managementKey, hash, updates, options = {}) {
  const body = {};
  if (updates.name !== undefined) body.name = updates.name;
  if (updates.disabled !== undefined) body.disabled = updates.disabled;
  if (updates.limit !== undefined) body.limit = updates.limit;
  if (updates.limitReset !== undefined) body.limit_reset = updates.limitReset;
  if (updates.includeByokInLimit !== undefined) body.include_byok_in_limit = updates.includeByokInLimit;

  const result = await apiRequest(`/keys/${hash}`, managementKey, { ...options, method: 'PATCH', body });
  return result.data;
}

export async function deleteKey(managementKey, hash, options = {}) {
  const result = await apiRequest(`/keys/${hash}`, managementKey, { ...options, method: 'DELETE' });
  return result;
}

// Full account snapshot (balance + keys)
export async function getAccountSnapshot(managementKey, { signal = null } = {}) {
  const [credits, keys] = await Promise.all([
    getCredits(managementKey, { signal }).catch((err) => {
      throwIfAborted(signal);
      logger.warn(`[OpenRouter] Account snapshot credits lookup failed: ${err?.message || err}`);
      return { total: 0, used: 0, remaining: 0 };
    }),
    listKeys(managementKey, true, { signal }).catch((err) => {
      throwIfAborted(signal);
      logger.warn(`[OpenRouter] Account snapshot key list lookup failed: ${err?.message || err}`);
      return [];
    }),
  ]);

  const safeKeys = keys || [];
  const activeKeys = safeKeys.filter(k => !k.disabled);
  const disabledKeys = safeKeys.filter(k => k.disabled);

  return {
    credits,
    keys: {
      total: safeKeys.length,
      active: activeKeys.length,
      disabled: disabledKeys.length,
      list: safeKeys.map(k => ({
        hash: k.hash,
        name: k.name,
        label: k.label,
        usage: k.usage,
        usage_monthly: k.usage_monthly ?? k.usage ?? 0,
        limit: k.limit ?? null,
        limit_remaining: (k.limit != null) ? Math.max(0, k.limit - (k.usage_monthly ?? k.usage ?? 0)) : null,
        created_at: k.created_at,
        disabled: k.disabled,
      })),
    }
  };
}
