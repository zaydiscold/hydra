/**
 * Cookie parsing, validation, formatting, and serialization utilities.
 */

import { logger } from '../services/logger.js';

// =============================================================================
// COOKIE SECURITY LIMITS (minimal defaults)
// =============================================================================
export const COOKIE_LIMITS = {
  MAX_COOKIE_NAME_LENGTH: 128,
  MAX_COOKIE_VALUE_LENGTH: 4096,
  MAX_TOTAL_HEADER_SIZE: 8192,
  MAX_COOKIE_COUNT: 50,
};

export function isValidCookieName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length === 0 || name.length > COOKIE_LIMITS.MAX_COOKIE_NAME_LENGTH) return false;
  const validToken = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;
  return validToken.test(name);
}

export function encodeCookieValue(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.length > COOKIE_LIMITS.MAX_COOKIE_VALUE_LENGTH) return null;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const code = str.charCodeAt(i);
    if ((code <= 0x1F && code !== 0x09) || code === 0x7F || char === ';' || char === '\n' || char === '\r' || code === 0x00) {
      return null;
    }
  }
  return str;
}

export function validateCookieJar(jar) {
  const errors = [];
  const validatedJar = {};
  if (!jar || typeof jar !== 'object') {
    return { valid: true, jar: {}, errors: [] };
  }
  for (const [name, value] of Object.entries(jar)) {
    if (!isValidCookieName(name)) {
      errors.push(`Invalid name: ${name.slice(0, 20)}`);
      continue;
    }
    const encoded = encodeCookieValue(value);
    if (encoded === null) {
      errors.push(`Invalid value: ${name}`);
      continue;
    }
    validatedJar[name] = encoded;
  }
  return { valid: errors.length === 0, jar: validatedJar, errors };
}

export function getCookieHeaderSize(cookieHeader) {
  if (!cookieHeader) return 0;
  return Buffer.byteLength(cookieHeader, 'utf8');
}

export function validateCookieHeaderSize(cookieHeader) {
  const size = getCookieHeaderSize(cookieHeader);
  if (size > COOKIE_LIMITS.MAX_TOTAL_HEADER_SIZE) {
    return { valid: false, size };
  }
  return { valid: true, size };
}

export function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders) return {};
  const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  const result = {};
  for (const raw of arr) {
    const [pair] = raw.split(';');
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 0) continue;
    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    result[name] = value;
  }
  return result;
}

export function parseCookieExpiration(setCookieHeader) {
  if (!setCookieHeader || typeof setCookieHeader !== 'string') return null;

  const parts = setCookieHeader.split(';').map(p => p.trim());

  // Check for Max-Age first (takes precedence)
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower.startsWith('max-age=')) {
      const maxAge = parseInt(part.slice(8), 10);
      if (!isNaN(maxAge) && maxAge > 0) {
        return Date.now() + (maxAge * 1000);
      }
      return null;
    }
  }

  // Check for Expires attribute
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower.startsWith('expires=')) {
      const expiresStr = part.slice(8);
      const expiresDate = new Date(expiresStr);
      if (!isNaN(expiresDate.getTime())) {
        return expiresDate.getTime();
      }
    }
  }

  return null;
}

export function parseCloudflareCookiesWithExpiration(setCookieHeaders) {
  if (!setCookieHeaders || !Array.isArray(setCookieHeaders)) return {};

  const result = {};
  for (const raw of setCookieHeaders) {
    const [pair] = raw.split(';');
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 0) continue;

    const name = pair.slice(0, eqIdx).trim();
    if (!isCloudflareCookieName(name)) continue;

    const value = pair.slice(eqIdx + 1).trim();
    const expires = parseCookieExpiration(raw);

    result[name] = { value, expires };
  }
  return result;
}

export const CF_COOKIE_EXPIRING_SOON_MS = 6 * 60 * 60 * 1000;

export function checkCloudflareCookieExpiration(storedCookieJar, cfCookieExpirations = {}) {
  const jar = parseAllDeviceCookies(storedCookieJar);
  const now = Date.now();
  const details = {};
  let anyExpired = false;
  let anyExpiringSoon = false;

  const cfCookieNames = ['__cf_bm', '_cfuvid', 'cf_clearance'];

  for (const name of cfCookieNames) {
    const hasCookie = !!jar[name];
    const expiration = cfCookieExpirations?.[name];

    if (!hasCookie) {
      details[name] = { expired: true, expiringSoon: true, expiresIn: null, missing: true };
      anyExpired = true;
      continue;
    }

    if (!expiration) {
      details[name] = { expired: false, expiringSoon: true, expiresIn: null, missing: false };
      anyExpiringSoon = true;
      continue;
    }

    const expiresIn = expiration - now;
    const expired = expiresIn <= 0;
    const expiringSoon = expiresIn <= CF_COOKIE_EXPIRING_SOON_MS;

    details[name] = { expired, expiringSoon, expiresIn, expiresAt: expiration, missing: false };

    if (expired) anyExpired = true;
    if (expiringSoon) anyExpiringSoon = true;
  }

  return { expired: anyExpired, expiringSoon: anyExpiringSoon, details };
}

export function areCloudflareCookiesExpired(storedCookieJar, cfCookieExpirations = {}) {
  const check = checkCloudflareCookieExpiration(storedCookieJar, cfCookieExpirations);
  return check.expired || check.expiringSoon;
}

export function isClerkDeviceCookieName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name === '__client') return true;
  if (name === '__client_uat') return true;
  if (name.startsWith('__client_uat_')) return true;
  return false;
}

export function isCloudflareCookieName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name === '__cf_bm') return true;
  if (name === '_cfuvid') return true;
  if (name === 'cf_clearance') return true;
  return false;
}

export function isDashboardDeviceCookieName(name) {
  return isClerkDeviceCookieName(name) || isCloudflareCookieName(name);
}

export function mergeDeviceCookiesFromParsed(into, parsed, filterFn = isClerkDeviceCookieName) {
  if (!parsed || typeof parsed !== 'object') return into;
  for (const [k, v] of Object.entries(parsed)) {
    if (!filterFn(k)) continue;
    const s = v != null ? String(v).trim() : '';
    if (s !== '') into[k] = s;
  }
  return into;
}

export function parseClerkDeviceCookieJar(stored) {
  const t = stored != null ? String(stored).trim() : '';
  if (!t || t === 'undefined') return {};
  
  if (t.includes('\n') || t.includes('\r')) {
    logger.error('[COOKIE_SECURITY] parseClerkDeviceCookieJar: rejecting cookie string containing newlines (possible header injection)');
    return {};
  }
  
  if (t.includes('\x00')) {
    logger.error('[COOKIE_SECURITY] parseClerkDeviceCookieJar: rejecting cookie string containing null bytes');
    return {};
  }
  
  if (!t.includes(';')) {
    if (t.includes(';') || t.includes('\n') || t.includes('\r')) {
      logger.error('[COOKIE_SECURITY] parseClerkDeviceCookieJar: rejecting invalid legacy token with dangerous characters');
      return {};
    }
    return { __client: t };
  }
  
  const jar = {};
  for (const part of t.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    
    if (!isValidCookieName(k)) {
      logger.warn(`[COOKIE_SECURITY] parseClerkDeviceCookieJar: skipping invalid cookie name "${k.slice(0, 32)}"`);
      continue;
    }
    
    if (v.includes('\n') || v.includes('\r') || v.includes(';')) {
      logger.warn(`[COOKIE_SECURITY] parseClerkDeviceCookieJar: skipping cookie "${k}" with dangerous characters in value`);
      continue;
    }
    
    if (isClerkDeviceCookieName(k) && v) jar[k] = v;
  }
  return Object.keys(jar).length ? jar : { __client: t };
}

export function parseAllDeviceCookies(stored) {
  const t = stored != null ? String(stored).trim() : '';
  if (!t || t === 'undefined') return {};
  
  if (t.includes('\n') || t.includes('\r')) {
    logger.error('[COOKIE_SECURITY] parseAllDeviceCookies: rejecting cookie string containing newlines (possible header injection)');
    return {};
  }
  
  if (t.includes('\x00')) {
    logger.error('[COOKIE_SECURITY] parseAllDeviceCookies: rejecting cookie string containing null bytes');
    return {};
  }
  
  const jar = {};
  for (const part of t.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    
    if (!isValidCookieName(k)) {
      logger.warn(`[COOKIE_SECURITY] parseAllDeviceCookies: skipping invalid cookie name "${k.slice(0, 32)}"`);
      continue;
    }
    
    if (v.includes('\n') || v.includes('\r') || v.includes(';')) {
      logger.warn(`[COOKIE_SECURITY] parseAllDeviceCookies: skipping cookie "${k}" with dangerous characters in value`);
      continue;
    }
    
    if (k && v && k !== '__session') jar[k] = v;
  }
  return jar;
}

export function clerkFapiDeviceCookieHeader(stored) {
  const jar = parseClerkDeviceCookieJar(stored);
  
  const validation = validateCookieJar(jar);
  if (!validation.valid && validation.errors.length > 0) {
    logger.warn(`[COOKIE_SECURITY] clerkFapiDeviceCookieHeader validation errors: ${validation.errors.join(', ')}`);
  }
  const validJar = validation.valid ? jar : validation.jar;
  
  const keys = Object.keys(validJar).filter((k) => isClerkDeviceCookieName(k) && validJar[k]).sort();
  if (!keys.length) return '';
  
  const parts = [];
  for (const k of keys) {
    const encodedValue = encodeCookieValue(validJar[k]);
    if (encodedValue !== null) {
      parts.push(`${k}=${encodedValue}`);
    }
  }
  
  const result = parts.join('; ');
  
  const sizeCheck = validateCookieHeaderSize(result);
  if (!sizeCheck.valid) {
    logger.error(`[COOKIE_SECURITY] clerkFapiDeviceCookieHeader: total header size exceeds limit (${sizeCheck.size} bytes)`);
    const client = encodeCookieValue(validJar.__client);
    const uat = encodeCookieValue(validJar.__client_uat);
    if (uat) return `__client_uat=${uat}`;
    if (client) return `__client=${client}`;
    return '';
  }
  
  return result;
}

export function openRouterDashboardDeviceCookies(stored) {
  const jar = parseAllDeviceCookies(stored);
  
  const validation = validateCookieJar(jar);
  if (!validation.valid && validation.errors.length > 0) {
    logger.warn(`[COOKIE_SECURITY] openRouterDashboardDeviceCookies validation errors: ${validation.errors.join(', ')}`);
  }
  const validJar = validation.valid ? jar : validation.jar;
  
  const out = [];
  const uat = validJar.__client_uat;
  const client = validJar.__client;
  const legacySingle = Object.keys(validJar).length === 1 && client && !uat;
  
  const encodedUat = uat ? encodeCookieValue(uat) : null;
  const encodedClient = client ? encodeCookieValue(client) : null;
  
  if (encodedUat) out.push(`__client_uat=${encodedUat}`);
  else if (legacySingle && encodedClient) out.push(`__client_uat=${encodedClient}`);
  if (encodedClient && encodedClient !== encodedUat) out.push(`__client=${encodedClient}`);
  
  for (const k of Object.keys(validJar).sort()) {
    if (k === '__client' || k === '__client_uat') continue;
    if (isDashboardDeviceCookieName(k)) {
      const encoded = encodeCookieValue(validJar[k]);
      if (encoded !== null) {
        out.push(`${k}=${encoded}`);
      }
    }
  }
  
  const result = out.join('; ');
  
  const sizeCheck = validateCookieHeaderSize(result);
  if (!sizeCheck.valid) {
    logger.error(`[COOKIE_SECURITY] openRouterDashboardDeviceCookies: total header size exceeds limit (${sizeCheck.size} bytes)`);
    if (encodedClient || encodedUat) {
      const minimal = encodedUat ? `__client_uat=${encodedUat}` : `__client=${encodedClient}`;
      return minimal;
    }
    return '';
  }
  
  return result;
}

export function openRouterPlaywrightDeviceCookies(stored) {
  const jar = parseAllDeviceCookies(stored);
  
  const validation = validateCookieJar(jar);
  if (!validation.valid && validation.errors.length > 0) {
    logger.warn(`[COOKIE_SECURITY] openRouterPlaywrightDeviceCookies validation errors: ${validation.errors.join(', ')}`);
  }
  const validJar = validation.valid ? jar : validation.jar;
  
  const list = [];
  const uat = validJar.__client_uat ?? (Object.keys(validJar).length === 1 && validJar.__client ? validJar.__client : null);
  const client = validJar.__client;
  
  const encodedUat = uat ? encodeCookieValue(uat) : null;
  const encodedClient = client ? encodeCookieValue(client) : null;
  
  if (encodedUat && isValidCookieName('__client_uat')) {
    list.push({ name: '__client_uat', value: encodedUat, domain: 'openrouter.ai', path: '/' });
  }
  if (encodedClient && encodedClient !== encodedUat && isValidCookieName('__client')) {
    list.push({ name: '__client', value: encodedClient, domain: 'openrouter.ai', path: '/' });
  }
  
  for (const k of Object.keys(validJar)) {
    if (k === '__client' || k === '__client_uat') continue;
    if (isDashboardDeviceCookieName(k)) {
      if (isValidCookieName(k)) {
        const encoded = encodeCookieValue(validJar[k]);
        if (encoded !== null) {
          list.push({ name: k, value: encoded, domain: 'openrouter.ai', path: '/' });
        }
      } else {
        logger.warn(`[COOKIE_SECURITY] Skipping invalid cookie name for Playwright: "${k.slice(0, 32)}"`);
      }
    }
  }
  
  if (list.length > COOKIE_LIMITS.MAX_COOKIE_COUNT) {
    logger.error(`[COOKIE_SECURITY] Too many cookies for Playwright (${list.length} > ${COOKIE_LIMITS.MAX_COOKIE_COUNT}), truncating to essential cookies only`);
    return list.filter(c => c.name === '__client' || c.name === '__client_uat');
  }
  
  return list;
}

export function mergeDeviceJar(priorJar, lines, filterFn = isClerkDeviceCookieName) {
  const next = { ...priorJar };
  mergeDeviceCookiesFromParsed(next, parseCookies(lines), filterFn);
  return next;
}

export function serializeClerkDeviceCookieJar(jar) {
  const validation = validateCookieJar(jar);
  if (!validation.valid) {
    if (validation.errors.length > 0) {
      logger.warn(`[COOKIE_SECURITY] serializeClerkDeviceCookieJar validation errors: ${validation.errors.join(', ')}`);
    }
    if (Object.keys(validation.jar).length === 0) return '';
  }
  
  const validJar = validation.jar;
  const keys = Object.keys(validJar).filter((k) => isClerkDeviceCookieName(k) && validJar[k]).sort();
  if (!keys.length) return '';
  if (keys.length === 1 && keys[0] === '__client') return validJar.__client;
  
  const parts = [];
  for (const k of keys) {
    const encodedValue = encodeCookieValue(validJar[k]);
    if (encodedValue !== null) {
      parts.push(`${k}=${encodedValue}`);
    }
  }
  
  const result = parts.join('; ');
  
  const sizeCheck = validateCookieHeaderSize(result);
  if (!sizeCheck.valid) {
    logger.error(`[COOKIE_SECURITY] serializeClerkDeviceCookieJar: total header size exceeds limit, returning truncated cookies`);
    if (validJar.__client && encodeCookieValue(validJar.__client) !== null) {
      return validJar.__client;
    }
    return '';
  }
  
  return result;
}

export function extractNewClientCookie(setCookieLines) {
  if (!setCookieLines || !Array.isArray(setCookieLines)) return null;
  const parsed = parseCookies(setCookieLines);
  const c = parsed['__client']?.trim();
  return (c && c !== '') ? c : null;
}

export function clientCookieAfterSetCookieLines(prior, setCookieLines) {
  const jar = parseAllDeviceCookies(prior);
  const merged = mergeDeviceJar(jar, setCookieLines, isDashboardDeviceCookieName);
  const s = serializeAllDeviceCookies(merged);
  return s || prior;
}

export function extractCloudflareCookieExpirations(setCookieLines) {
  if (!setCookieLines || !Array.isArray(setCookieLines)) return {};

  const expirations = {};
  for (const raw of setCookieLines) {
    const [pair] = raw.split(';');
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 0) continue;

    const name = pair.slice(0, eqIdx).trim();
    if (!isCloudflareCookieName(name)) continue;

    const expires = parseCookieExpiration(raw);
    if (expires) {
      expirations[name] = expires;
    }
  }

  return expirations;
}

export function mergeCloudflareCookieExpirations(existing, incoming) {
  const merged = { ...(existing || {}) };

  for (const [name, expires] of Object.entries(incoming || {})) {
    if (isCloudflareCookieName(name)) {
      merged[name] = expires;
    }
  }

  return merged;
}

export function serializeAllDeviceCookies(jar) {
  const validation = validateCookieJar(jar);
  if (!validation.valid) {
    if (validation.errors.length > 0) {
      logger.warn(`[COOKIE_SECURITY] serializeAllDeviceCookies validation errors: ${validation.errors.join(', ')}`);
    }
    if (Object.keys(validation.jar).length === 0) return '';
  }
  
  const validJar = validation.jar;
  const keys = Object.keys(validJar).filter((k) => isDashboardDeviceCookieName(k) && validJar[k]).sort();
  if (!keys.length) return '';
  if (keys.length === 1 && keys[0] === '__client') return validJar.__client;
  
  const parts = [];
  for (const k of keys) {
    const encodedValue = encodeCookieValue(validJar[k]);
    if (encodedValue !== null) {
      parts.push(`${k}=${encodedValue}`);
    }
  }
  
  const result = parts.join('; ');
  
  const sizeCheck = validateCookieHeaderSize(result);
  if (!sizeCheck.valid) {
    logger.error(`[COOKIE_SECURITY] serializeAllDeviceCookies: total header size exceeds limit, returning truncated cookies`);
    if (validJar.__client && encodeCookieValue(validJar.__client) !== null) {
      return validJar.__client;
    }
    return '';
  }
  
  return result;
}
