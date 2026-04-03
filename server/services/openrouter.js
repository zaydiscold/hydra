const BASE_URL = 'https://openrouter.ai/api/v1';

const RETRY_DELAYS = [500, 1000, 2000];

async function apiRequest(path, managementKey, options = {}) {
  const { method = 'GET', body, retries = 2 } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
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

      const response = await fetch(`${BASE_URL}${path}`, fetchOptions);

      if (response.status === 429) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt] || 2000));
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
        throw new Error(`OpenRouter API error (${response.status}): ${message}`);
      }

      return await response.json();
    } catch (err) {
      if (attempt < retries && err.code === 'ECONNRESET') {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt] || 1000));
        continue;
      }
      throw err;
    }
  }
}

// Credits
export async function getCredits(managementKey) {
  const result = await apiRequest('/credits', managementKey);
  const d = result.data ?? {};
  const total = d.total_credits ?? d.total ?? 0;
  const used = d.total_usage ?? d.used ?? 0;
  return {
    total,
    used,
    remaining: total - used,
  };
}

// API Keys
export async function listKeys(managementKey, includeDisabled = true) {
  const qs = includeDisabled ? '?include_disabled=true' : '';
  const result = await apiRequest(`/keys${qs}`, managementKey);
  const data = result?.data;
  return Array.isArray(data) ? data : [];
}

export async function createKey(managementKey, { name, limit, limitReset, includeByokInLimit, expiresAt }) {
  const body = { name };
  if (limit !== undefined && limit !== null) body.limit = limit;
  if (limitReset) body.limit_reset = limitReset;
  if (includeByokInLimit !== undefined) body.include_byok_in_limit = includeByokInLimit;
  if (expiresAt) body.expires_at = expiresAt;

  const result = await apiRequest('/keys', managementKey, { method: 'POST', body });
  return { data: result.data, key: result.key };
}

// GET /keys/{hash} exists upstream but returns metadata only (no secret per OpenRouter OpenAPI).
// Do not add a wrapper that implies we can "fetch" a lost sk-or-v1 string.

export async function updateKey(managementKey, hash, updates) {
  const body = {};
  if (updates.name !== undefined) body.name = updates.name;
  if (updates.disabled !== undefined) body.disabled = updates.disabled;
  if (updates.limit !== undefined) body.limit = updates.limit;
  if (updates.limitReset !== undefined) body.limit_reset = updates.limitReset;
  if (updates.includeByokInLimit !== undefined) body.include_byok_in_limit = updates.includeByokInLimit;

  const result = await apiRequest(`/keys/${hash}`, managementKey, { method: 'PATCH', body });
  return result.data;
}

export async function deleteKey(managementKey, hash) {
  const result = await apiRequest(`/keys/${hash}`, managementKey, { method: 'DELETE' });
  return result;
}

// Full account snapshot (balance + keys)
export async function getAccountSnapshot(managementKey) {
  const [credits, keys] = await Promise.all([
    getCredits(managementKey).catch(() => ({ total: 0, used: 0, remaining: 0 })),
    listKeys(managementKey).catch(() => []),
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
      list: safeKeys.map(k => ({ hash: k.hash, name: k.name, label: k.label, usage: k.usage, disabled: k.disabled })),
    }
  };
}
