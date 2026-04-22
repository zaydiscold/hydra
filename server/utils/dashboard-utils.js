/**
 * Dashboard Utility Functions
 *
 * Extracted pure formatting and parsing logic.
 */

// Management key material in tRPC JSON or page text (OpenRouter prefix).
// NOTE: OpenRouter management keys use 'sk-or-v1-' prefix, NOT 'sk-or-mgmt-'
export const MGMT_KEY_RE = /sk-or-v1-[A-Za-z0-9_.-]+/;

export function truncateForLog(s, max = 2000) {
  if (!s || typeof s !== 'string') return '';
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

export function findManagementKeyDeep(value, depth = 0) {
  if (depth > 14 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const m = value.normalize('NFC').match(MGMT_KEY_RE);
    return m ? m[0] : null;
  }
  if (typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const k = findManagementKeyDeep(item, depth + 1);
      if (k) return k;
    }
    return null;
  }
  const direct =
    value.key ??
    value.managementKey ??
    value.apiKey ??
    value.secret ??
    value.token ??
    value.management_key ??
    value.api_key;
  if (typeof direct === 'string' && direct.startsWith('sk-or-v1-')) return direct;
  for (const v of Object.values(value)) {
    const k = findManagementKeyDeep(v, depth + 1);
    if (k) return k;
  }
  return null;
}

export function extractManagementKeyFromResponseBody(body) {
  if (!body || typeof body !== 'string') return null;
  body = body.normalize('NFC');
  // Use global match to find ALL occurrences — the RSC/server-action response may contain the
  // masked preview key FIRST (e.g. "sk-or-v1-0b5...ecf") followed by the full key later in the
  // payload. body.match() (non-global) would stop at the masked first match and reject it,
  // missing the full key. matchAll finds every candidate; we return the first valid one.
  const allMatches = [...body.matchAll(/sk-or-v1-[A-Za-z0-9_.-]+/g)].map(m => m[0]);
  for (const potentialKey of allMatches) {
    if (potentialKey.includes('...') || potentialKey.length < 40) {
      console.error(`[dashboard-api] extractManagementKeyFromResponseBody: skipping masked/short match (len=${potentialKey.length}): ${potentialKey.slice(0, 20)}…`);
      continue;
    }
    return potentialKey;
  }
  if (allMatches.length > 0 && !allMatches.some(k => !k.includes('...') && k.length >= 40)) {
    console.error(`[dashboard-api] extractManagementKeyFromResponseBody: found ${allMatches.length} key-like match(es) but all masked/short`);
    return null;
  }
  try {
    const data = JSON.parse(body);
    const fromPayload = (d) => {
      if (!d || typeof d !== 'object') return null;
      const key =
        d.key ??
        d.managementKey ??
        d.apiKey ??
        d.secret ??
        d.token ??
        d.management_key ??
        d.api_key;
      // Reject masked/preview keys from JSON payloads too
      if (typeof key === 'string' && key.startsWith('sk-or-v1-')) {
        if (key.includes('...') || key.length < 40) {
          console.error(`[dashboard-api] fromPayload: rejecting masked/preview key (length: ${key.length})`);
          return null;
        }
        return key;
      }
      return null;
    };
    if (Array.isArray(data)) {
      for (const item of data) {
        const inner = item?.result?.data?.json ?? item?.result?.data ?? item?.result;
        const k = fromPayload(inner) ?? findManagementKeyDeep(item) ?? findManagementKeyDeep(inner);
        if (k) return k;
      }
    }
    if (data?.result) {
      const inner = data.result?.data?.json ?? data.result?.data;
      const k = fromPayload(inner);
      if (k) return k;
    }
    const deep = findManagementKeyDeep(data);
    if (deep) return deep;
  } catch {
    /* not JSON */
  }
  return null;
}

export function normalizeDiscoveredCreateRoute(pathSegment) {
  if (!pathSegment) return null;
  const decoded = decodeURIComponent(pathSegment.split('?')[0] || '');
  const parts = decoded.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return decoded || null;
  const prefer = parts.find((p) => /create/i.test(p) && /management|key/i.test(p));
  if (prefer) return prefer;
  const createish = parts.find((p) => /create/i.test(p));
  return createish || parts[0];
}

export function decodeJwtPayloadUnsafe(jwt) {
  if (!jwt || typeof jwt !== 'string') return null;
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function redactSensitiveForProvisionLog(s, max = 480) {
  if (!s || typeof s !== 'string') return '';
  const clipped = s.length > max ? `${s.slice(0, max)}…` : s;
  return clipped.replace(/sk-or-[a-z0-9_.-]{8,}/gi, '[REDACTED]');
}

export function extractManagementKeyFromServerActionResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') {
    return null;
  }

  // Try direct regex match first
  const directMatch = responseText.match(MGMT_KEY_RE);
  if (directMatch) {
    return directMatch[0];
  }

  // RSC format uses special delimiters and encoding
  // Try to find JSON-encoded keys in the response
  try {
    // Look for JSON strings that might contain the key
    const jsonStringPattern = /"((?:[^"\\]|\\.)*)"/g;
    let match;
    while ((match = jsonStringPattern.exec(responseText)) !== null) {
      const decoded = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      const keyMatch = decoded.match(MGMT_KEY_RE);
      if (keyMatch) {
        return keyMatch[0];
      }
    }
  } catch {
    // Ignore parsing errors
  }

  // Try to parse as RSC payload chunks
  // RSC uses format like: "0:{...}" or "1:[...]" with newlines
  try {
    const chunks = responseText.split('\n').filter(line => line.trim());
    for (const chunk of chunks) {
      // Remove leading chunk ID if present (e.g., "0:")
      const jsonPart = chunk.replace(/^\d+:/, '');
      try {
        const data = JSON.parse(jsonPart);
        const key = findKeyInObject(data);
        if (key) return key;
      } catch {
        // Not valid JSON, try regex on raw chunk
        const keyMatch = chunk.match(MGMT_KEY_RE);
        if (keyMatch) return keyMatch[0];
      }
    }
  } catch {
    // Ignore parsing errors
  }

  return null;
}

export function findKeyInObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return null;
  }

  // Check if this object has a key field
  const keyFields = ['key', 'managementKey', 'apiKey', 'api_key', 'secret', 'token', 'value'];
  for (const field of keyFields) {
    const value = obj[field];
    if (typeof value === 'string' && value.startsWith('sk-or-v1-')) {
      return value;
    }
  }

  // Recurse into arrays and objects
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findKeyInObject(item);
      if (found) return found;
    }
  } else {
    for (const key of Object.keys(obj)) {
      const found = findKeyInObject(obj[key]);
      if (found) return found;
    }
  }

  return null;
}

