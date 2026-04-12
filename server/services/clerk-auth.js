/**
 * Clerk FAPI Authentication Service
 *
 * Handles all authentication against OpenRouter's Clerk instance.
 * Base URL: https://clerk.openrouter.ai/v1
 *
 * Key facts:
 * - All POST bodies use application/x-www-form-urlencoded (NOT JSON)
 * - captcha_on_signin: false — no CAPTCHA on this instance
 * - Password accounts: pure HTTP, ~100ms, zero browser
 * - Google OAuth accounts: OTP fallback (email code) or Playwright
 */

import https from 'node:https';
import { URL } from 'node:url';
import { USER_AGENT, randomUserAgent, CLERK_BASE, CLERK_ORIGIN, CLERK_REFERER, OR_BASE } from '../config.js';
import { logger } from './logger.js';

// Clerk JS version sent with all FAPI requests.
// Real version per: curl https://clerk.openrouter.ai/npm/@clerk/clerk-js@5/package.json
// OpenRouter's Clerk instance checks major version only, so 5.x.x all work.
// Override with HYDRA_CLERK_JS_VERSION env var if OpenRouter upgrades to v6+.
const CLERK_JS_VERSION = process.env.HYDRA_CLERK_JS_VERSION || '5.125.7';

// =============================================================================
// COOKIE SECURITY LIMITS (minimal defaults)
// =============================================================================
const COOKIE_LIMITS = {
  MAX_COOKIE_NAME_LENGTH: 128,
  MAX_COOKIE_VALUE_LENGTH: 4096,
  MAX_TOTAL_HEADER_SIZE: 8192,
  MAX_COOKIE_COUNT: 50,
};

function isValidCookieName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length === 0 || name.length > COOKIE_LIMITS.MAX_COOKIE_NAME_LENGTH) return false;
  const validToken = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;
  return validToken.test(name);
}

function encodeCookieValue(value) {
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

function validateCookieJar(jar) {
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

function getCookieHeaderSize(cookieHeader) {
  if (!cookieHeader) return 0;
  return Buffer.byteLength(cookieHeader, 'utf8');
}

function validateCookieHeaderSize(cookieHeader) {
  const size = getCookieHeaderSize(cookieHeader);
  if (size > COOKIE_LIMITS.MAX_TOTAL_HEADER_SIZE) {
    return { valid: false, size };
  }
  return { valid: true, size };
}

// =============================================================================
/** Thrown when password first factor succeeds but Clerk requires a second factor (e.g. TOTP). */
export class NeedSecondFactorError extends Error {
  constructor(signInId, clientCookie) {
    super('NEEDS_2FA');
    this.name = 'NeedSecondFactorError';
    this.signInId = signInId;
    this.clientCookie = clientCookie;
  }
}

// Parse a Set-Cookie header string into { name, value } pairs
function parseCookies(setCookieHeaders) {
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

/**
 * Parse cookie expiration from Set-Cookie header attributes.
 * Extracts Expires and Max-Age attributes to calculate expiration timestamp.
 * @param {string} setCookieHeader - Raw Set-Cookie header string
 * @returns {number|null} Expiration timestamp in milliseconds, or null if no expiration
 */
function parseCookieExpiration(setCookieHeader) {
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
      // Negative or zero Max-Age means session cookie (expires immediately)
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

/**
 * Parse all Cloudflare cookies with their expiration timestamps from Set-Cookie headers.
 * @param {string[]} setCookieHeaders - Array of Set-Cookie header strings
 * @returns {Record<string, {value: string, expires: number|null}>} Object mapping cookie names to {value, expires}
 */
function parseCloudflareCookiesWithExpiration(setCookieHeaders) {
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

/** Time window before expiration to trigger proactive refresh (6 hours) */
export const CF_COOKIE_EXPIRING_SOON_MS = 6 * 60 * 60 * 1000;

/**
 * Check if Cloudflare cookies in the stored jar are expired or expiring soon.
 * @param {string} storedCookieJar - The stored client cookie string
 * @param {Record<string, number>} cfCookieExpirations - Object mapping CF cookie names to expiration timestamps
 * @returns {{expired: boolean, expiringSoon: boolean, details: Record<string, {expired: boolean, expiringSoon: boolean, expiresIn: number|null}>}}
 */
export function checkCloudflareCookieExpiration(storedCookieJar, cfCookieExpirations = {}) {
  const jar = parseAllDeviceCookies(storedCookieJar);
  const now = Date.now();
  const details = {};
  let anyExpired = false;
  let anyExpiringSoon = false;

  // Key CF cookies to check
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
      // Cookie exists but no expiration info - treat as expiring soon to be safe
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

/**
 * Quick check if Cloudflare cookies need refresh (missing, expired, or expiring soon).
 * This is the primary helper for ensureSession() to decide if CF cookies are usable.
 * @param {string} storedCookieJar - The stored client cookie string
 * @param {Record<string, number>} cfCookieExpirations - Stored expiration timestamps
 * @returns {boolean} true if CF cookies need refresh
 */
export function areCloudflareCookiesExpired(storedCookieJar, cfCookieExpirations = {}) {
  const check = checkCloudflareCookieExpiration(storedCookieJar, cfCookieExpirations);
  return check.expired || check.expiringSoon;
}

/** Clerk / OpenRouter device cookies we persist and replay on FAPI (not __session). */
function isClerkDeviceCookieName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name === '__client') return true;
  if (name === '__client_uat') return true;
  if (name.startsWith('__client_uat_')) return true;
  return false;
}

/** Cloudflare cookies required for openrouter.ai dashboard access (anti-bot/challenge). */
function isCloudflareCookieName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name === '__cf_bm') return true;      // Bot management cookie
  if (name === '_cfuvid') return true;      // Unique visitor ID
  if (name === 'cf_clearance') return true;  // Challenge clearance token
  return false;
}

/** All device cookies needed for dashboard (Clerk + Cloudflare). */
function isDashboardDeviceCookieName(name) {
  return isClerkDeviceCookieName(name) || isCloudflareCookieName(name);
}

function mergeDeviceCookiesFromParsed(into, parsed, filterFn = isClerkDeviceCookieName) {
  if (!parsed || typeof parsed !== 'object') return into;
  for (const [k, v] of Object.entries(parsed)) {
    if (!filterFn(k)) continue;
    const s = v != null ? String(v).trim() : '';
    if (s !== '') into[k] = s;
  }
  return into;
}

/**
 * Parse vault `clientCookie`: legacy single token (treated as __client), or `__client=a; __client_uat=b`.
 * 
 * SECURITY: Validates cookie names and rejects dangerous values during parsing.
 * @returns {Record<string, string>}
 */
export function parseClerkDeviceCookieJar(stored) {
  const t = stored != null ? String(stored).trim() : '';
  if (!t || t === 'undefined') return {};
  
  // Check for potential injection attacks in the raw input
  if (t.includes('\n') || t.includes('\r')) {
    logger.error('[COOKIE_SECURITY] parseClerkDeviceCookieJar: rejecting cookie string containing newlines (possible header injection)');
    return {};
  }
  
  if (t.includes('\x00')) {
    logger.error('[COOKIE_SECURITY] parseClerkDeviceCookieJar: rejecting cookie string containing null bytes');
    return {};
  }
  
  // Legacy single token format (no semicolon)
  if (!t.includes(';')) {
    // Validate the single token value
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
    
    // Validate name
    if (!isValidCookieName(k)) {
      logger.warn(`[COOKIE_SECURITY] parseClerkDeviceCookieJar: skipping invalid cookie name "${k.slice(0, 32)}"`);
      continue;
    }
    
    // Check value for injection attempts
    if (v.includes('\n') || v.includes('\r') || v.includes(';')) {
      logger.warn(`[COOKIE_SECURITY] parseClerkDeviceCookieJar: skipping cookie "${k}" with dangerous characters in value`);
      continue;
    }
    
    if (isClerkDeviceCookieName(k) && v) jar[k] = v;
  }
  return Object.keys(jar).length ? jar : { __client: t };
}

/**
 * Parse ALL device cookies from stored string (Clerk + Cloudflare + any others).
 * This preserves all cookies needed for dashboard access, not just Clerk ones.
 * 
 * SECURITY: Validates cookie names and rejects dangerous values during parsing.
 * @returns {Record<string, string>}
 */
function parseAllDeviceCookies(stored) {
  const t = stored != null ? String(stored).trim() : '';
  if (!t || t === 'undefined') return {};
  
  // Check for potential injection attacks in the raw input
  // Look for newlines that could indicate HTTP header injection
  if (t.includes('\n') || t.includes('\r')) {
    logger.error('[COOKIE_SECURITY] parseAllDeviceCookies: rejecting cookie string containing newlines (possible header injection)');
    return {};
  }
  
  // Check for null bytes
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
    
    // Validate name - reject invalid names
    if (!isValidCookieName(k)) {
      logger.warn(`[COOKIE_SECURITY] parseAllDeviceCookies: skipping invalid cookie name "${k.slice(0, 32)}"`);
      continue;
    }
    
    // Check value for obvious injection attempts
    if (v.includes('\n') || v.includes('\r') || v.includes(';')) {
      logger.warn(`[COOKIE_SECURITY] parseAllDeviceCookies: skipping cookie "${k}" with dangerous characters in value`);
      continue;
    }
    
    // Preserve ALL non-empty cookies except __session (handled separately)
    if (k && v && k !== '__session') jar[k] = v;
  }
  return jar;
}

/**
 * Cookie header value for Clerk FAPI (clerk.openrouter.ai): Clerk device cookies only, sorted.
 * 
 * SECURITY: Validates cookie names and values to prevent header injection.
 * Rejects cookies with control chars, semicolons, or newlines.
 */
export function clerkFapiDeviceCookieHeader(stored) {
  const jar = parseClerkDeviceCookieJar(stored);
  
  // Validate the jar for security
  const validation = validateCookieJar(jar);
  if (!validation.valid && validation.errors.length > 0) {
    logger.warn(`[COOKIE_SECURITY] clerkFapiDeviceCookieHeader validation errors: ${validation.errors.join(', ')}`);
  }
  const validJar = validation.valid ? jar : validation.jar;
  
  const keys = Object.keys(validJar).filter((k) => isClerkDeviceCookieName(k) && validJar[k]).sort();
  if (!keys.length) return '';
  
  // Build cookie string with validated/encoded values
  const parts = [];
  for (const k of keys) {
    const encodedValue = encodeCookieValue(validJar[k]);
    if (encodedValue !== null) {
      parts.push(`${k}=${encodedValue}`);
    }
  }
  
  const result = parts.join('; ');
  
  // Check total header size
  const sizeCheck = validateCookieHeaderSize(result);
  if (!sizeCheck.valid) {
    logger.error(`[COOKIE_SECURITY] clerkFapiDeviceCookieHeader: total header size exceeds limit (${sizeCheck.size} bytes)`);
    // Return minimal essential cookie as fallback
    const client = encodeCookieValue(validJar.__client);
    const uat = encodeCookieValue(validJar.__client_uat);
    if (uat) return `__client_uat=${uat}`;
    if (client) return `__client=${client}`;
    return '';
  }
  
  return result;
}

/**
 * Device cookie fragment for openrouter.ai dashboard tRPC (after __session).
 * Includes ALL device cookies: Clerk + Cloudflare (cf_bm, cfuvid, cf_clearance).
 * 
 * SECURITY: Validates cookie names and values to prevent header injection.
 * Rejects cookies with control chars, semicolons, or newlines.
 */
export function openRouterDashboardDeviceCookies(stored) {
  const jar = parseAllDeviceCookies(stored);
  
  // Validate the jar for security
  const validation = validateCookieJar(jar);
  if (!validation.valid && validation.errors.length > 0) {
    logger.warn(`[COOKIE_SECURITY] openRouterDashboardDeviceCookies validation errors: ${validation.errors.join(', ')}`);
  }
  const validJar = validation.valid ? jar : validation.jar;
  
  const out = [];
  const uat = validJar.__client_uat;
  const client = validJar.__client;
  const legacySingle = Object.keys(validJar).length === 1 && client && !uat;
  
  // Validate and encode values before adding
  const encodedUat = uat ? encodeCookieValue(uat) : null;
  const encodedClient = client ? encodeCookieValue(client) : null;
  
  if (encodedUat) out.push(`__client_uat=${encodedUat}`);
  else if (legacySingle && encodedClient) out.push(`__client_uat=${encodedClient}`);
  if (encodedClient && encodedClient !== encodedUat) out.push(`__client=${encodedClient}`);
  
  for (const k of Object.keys(validJar).sort()) {
    // Skip already-added Clerk cookies to avoid duplicates
    if (k === '__client' || k === '__client_uat') continue;
    // Include both Clerk cookies AND Cloudflare cookies
    if (isDashboardDeviceCookieName(k)) {
      const encoded = encodeCookieValue(validJar[k]);
      if (encoded !== null) {
        out.push(`${k}=${encoded}`);
      }
    }
  }
  
  const result = out.join('; ');
  
  // Check total header size
  const sizeCheck = validateCookieHeaderSize(result);
  if (!sizeCheck.valid) {
    logger.error(`[COOKIE_SECURITY] openRouterDashboardDeviceCookies: total header size exceeds limit (${sizeCheck.size} bytes)`);
    // Return minimal essential cookies as fallback
    if (encodedClient || encodedUat) {
      const minimal = encodedUat ? `__client_uat=${encodedUat}` : `__client=${encodedClient}`;
      return minimal;
    }
    return '';
  }
  
  return result;
}

/**
 * Playwright cookie injection for openrouter.ai - includes ALL device cookies.
 * 
 * SECURITY: Validates cookie names and values to prevent header injection.
 * Rejects cookies with control chars, semicolons, or newlines in names/values.
 */
export function openRouterPlaywrightDeviceCookies(stored) {
  const jar = parseAllDeviceCookies(stored);
  
  // Validate the jar for security
  const validation = validateCookieJar(jar);
  if (!validation.valid && validation.errors.length > 0) {
    logger.warn(`[COOKIE_SECURITY] openRouterPlaywrightDeviceCookies validation errors: ${validation.errors.join(', ')}`);
  }
  const validJar = validation.valid ? jar : validation.jar;
  
  const list = [];
  const uat = validJar.__client_uat ?? (Object.keys(validJar).length === 1 && validJar.__client ? validJar.__client : null);
  const client = validJar.__client;
  
  // Validate and encode values before adding
  const encodedUat = uat ? encodeCookieValue(uat) : null;
  const encodedClient = client ? encodeCookieValue(client) : null;
  
  // Validate cookie names (Playwright will use these in browser context)
  if (encodedUat && isValidCookieName('__client_uat')) {
    list.push({ name: '__client_uat', value: encodedUat, domain: 'openrouter.ai', path: '/' });
  }
  if (encodedClient && encodedClient !== encodedUat && isValidCookieName('__client')) {
    list.push({ name: '__client', value: encodedClient, domain: 'openrouter.ai', path: '/' });
  }
  
  for (const k of Object.keys(validJar)) {
    // Skip already-added Clerk cookies to avoid duplicates
    if (k === '__client' || k === '__client_uat') continue;
    // Include ALL dashboard cookies (Clerk + Cloudflare)
    if (isDashboardDeviceCookieName(k)) {
      // Validate both name and value before adding to Playwright
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
  
  // Check for excessive cookie count (DoS protection)
  if (list.length > COOKIE_LIMITS.MAX_COOKIE_COUNT) {
    logger.error(`[COOKIE_SECURITY] Too many cookies for Playwright (${list.length} > ${COOKIE_LIMITS.MAX_COOKIE_COUNT}), truncating to essential cookies only`);
    // Return only essential Clerk cookies
    return list.filter(c => c.name === '__client' || c.name === '__client_uat');
  }
  
  return list;
}

function mergeDeviceJar(priorJar, lines, filterFn = isClerkDeviceCookieName) {
  const next = { ...priorJar };
  mergeDeviceCookiesFromParsed(next, parseCookies(lines), filterFn);
  return next;
}

/**
 * Persist device jar: single __client only stays legacy string; multiple keys → `a=b; c=d`.
 * 
 * SECURITY: Validates cookie names and values to prevent header injection.
 */
function serializeClerkDeviceCookieJar(jar) {
  // Validate the entire jar first
  const validation = validateCookieJar(jar);
  if (!validation.valid) {
    if (validation.errors.length > 0) {
      logger.warn(`[COOKIE_SECURITY] serializeClerkDeviceCookieJar validation errors: ${validation.errors.join(', ')}`);
    }
    // If no valid cookies remain, return empty string
    if (Object.keys(validation.jar).length === 0) return '';
  }
  
  const validJar = validation.jar;
  const keys = Object.keys(validJar).filter((k) => isClerkDeviceCookieName(k) && validJar[k]).sort();
  if (!keys.length) return '';
  if (keys.length === 1 && keys[0] === '__client') return validJar.__client;
  
  // Build cookie string with validated/encoded values
  const parts = [];
  for (const k of keys) {
    const encodedValue = encodeCookieValue(validJar[k]);
    if (encodedValue !== null) {
      parts.push(`${k}=${encodedValue}`);
    }
  }
  
  const result = parts.join('; ');
  
  // Check total header size
  const sizeCheck = validateCookieHeaderSize(result);
  if (!sizeCheck.valid) {
    logger.error(`[COOKIE_SECURITY] serializeClerkDeviceCookieJar: total header size exceeds limit, returning truncated cookies`);
    // Return just the __client cookie if available as fallback
    if (validJar.__client && encodeCookieValue(validJar.__client) !== null) {
      return validJar.__client;
    }
    return '';
  }
  
  return result;
}

/**
 * Node fetch (Undici) does not expose Set-Cookie via headers.get('set-cookie').
 * Use getSetCookie() (Node.js 18.14+ / 20+) which returns one string per Set-Cookie header.
 */
function getSetCookieHeaderLines(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie().filter(Boolean);
  }
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

/**
 * Extract new __client cookie value from Set-Cookie lines.
 * Clerk does NOT invalidate old device cookies — old __client values remain valid.
 * Returns the raw __client value if found, or null.
 */
export function extractNewClientCookie(setCookieLines) {
  if (!setCookieLines || !Array.isArray(setCookieLines)) return null;
  const parsed = parseCookies(setCookieLines);
  const c = parsed['__client']?.trim();
  return (c && c !== '') ? c : null;
}

/** Merge ALL device cookies from Set-Cookie into stored jar (survives OTP / touch).
 *  COOKIE STACKING (Exploit #14): When a new __client cookie arrives from Set-Cookie
 *  and differs from the one already in the jar, we do NOT overwrite. Instead, the
 *  caller (store.js / session-refresher.js) is responsible for appending the new
 *  cookie string to the clientCookies array. This function simply returns the
 *  merged jar as a string (same as before), and the caller decides whether to stack.
 */
function clientCookieAfterSetCookieLines(prior, setCookieLines) {
  // Use parseAllDeviceCookies to preserve ALL cookies (Clerk + Cloudflare)
  const jar = parseAllDeviceCookies(prior);
  // Merge using dashboard filter to include Cloudflare cookies from Set-Cookie
  const merged = mergeDeviceJar(jar, setCookieLines, isDashboardDeviceCookieName);
  const s = serializeAllDeviceCookies(merged);
  return s || prior;
}

/**
 * Extract Cloudflare cookie expirations from Set-Cookie headers.
 * Returns an object mapping cookie names to expiration timestamps.
 * @param {string[]} setCookieLines - Array of Set-Cookie header strings
 * @returns {Record<string, number>} Object mapping CF cookie names to expiration timestamps (ms)
 */
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

/**
 * Merge new Cloudflare cookie expirations into existing expirations object.
 * Only updates timestamps for cookies that are present in the new response.
 * @param {Record<string, number>} existing - Existing CF cookie expirations
 * @param {Record<string, number>} incoming - New CF cookie expirations from Set-Cookie
 * @returns {Record<string, number>} Merged expirations object
 */
export function mergeCloudflareCookieExpirations(existing, incoming) {
  const merged = { ...(existing || {}) };

  for (const [name, expires] of Object.entries(incoming || {})) {
    if (isCloudflareCookieName(name)) {
      merged[name] = expires;
    }
  }

  return merged;
}

/**
 * Serialize all device cookies for storage (Clerk + Cloudflare).
 * Single __client only stays legacy string; multiple keys → `a=b; c=d`.
 * 
 * SECURITY: Validates cookie names and values to prevent header injection.
 * Rejects cookies with control chars, semicolons, or newlines.
 */
function serializeAllDeviceCookies(jar) {
  // Validate the entire jar first
  const validation = validateCookieJar(jar);
  if (!validation.valid) {
    if (validation.errors.length > 0) {
      logger.warn(`[COOKIE_SECURITY] serializeAllDeviceCookies validation errors: ${validation.errors.join(', ')}`);
    }
    // If no valid cookies remain, return empty string
    if (Object.keys(validation.jar).length === 0) return '';
  }
  
  const validJar = validation.jar;
  const keys = Object.keys(validJar).filter((k) => isDashboardDeviceCookieName(k) && validJar[k]).sort();
  if (!keys.length) return '';
  if (keys.length === 1 && keys[0] === '__client') return validJar.__client;
  
  // Build cookie string with validated/encoded values
  const parts = [];
  for (const k of keys) {
    const encodedValue = encodeCookieValue(validJar[k]);
    if (encodedValue !== null) {
      parts.push(`${k}=${encodedValue}`);
    }
  }
  
  const result = parts.join('; ');
  
  // Check total header size
  const sizeCheck = validateCookieHeaderSize(result);
  if (!sizeCheck.valid) {
    logger.error(`[COOKIE_SECURITY] serializeAllDeviceCookies: total header size exceeds limit, returning truncated cookies`);
    // Return just the __client cookie if available as fallback
    if (validJar.__client && encodeCookieValue(validJar.__client) !== null) {
      return validJar.__client;
    }
    return '';
  }
  
  return result;
}

function sessionCookieFromSetCookieLines(setCookieLines) {
  return parseCookies(setCookieLines)['__session'] || null;
}

function setCookieNamesForDebug(setCookieLines) {
  return setCookieLines.map((l) => l.split('=')[0]?.trim()).filter(Boolean);
}

function clerkDebugOtpEnabled() {
  return process.env.CLERK_DEBUG_OTP === '1';
}

/** GET /client and POST responses may nest the Client resource under `response` instead of `client`. */
function isClientLikeRoot(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    ('session' in obj ||
      'sessions' in obj ||
      'last_active_session' in obj ||
      'lastActiveSession' in obj ||
      'last_active_session_id' in obj ||
      'lastActiveSessionId' in obj)
  );
}

/** Ordered list of objects that may carry an embedded session JWT (FAPI envelope variants). */
function clerkClientLikeObjects(data) {
  const out = [];
  const c = data?.client;
  if (c && typeof c === 'object') out.push(c);
  const r = data?.response;
  if (r && typeof r === 'object' && isClientLikeRoot(r)) out.push(r);
  return out;
}

function jwtFromSessionShape(s) {
  if (!s || typeof s !== 'object') return null;
  if (typeof s.jwt === 'string' && s.jwt.startsWith('eyJ')) return s.jwt;
  const lat = s.last_active_token ?? s.lastActiveToken;
  if (lat && typeof lat === 'object' && typeof lat.jwt === 'string' && lat.jwt.startsWith('eyJ')) return lat.jwt;
  return null;
}

function extractJwtFromClientLikeObject(root) {
  if (!root || typeof root !== 'object') return null;
  if (typeof root.session === 'string' && root.session.startsWith('eyJ')) return root.session;
  const sess = root.session;
  if (sess && typeof sess === 'object') {
    const j = jwtFromSessionShape(sess);
    if (j) return j;
  }
  const las = root.last_active_session ?? root.lastActiveSession;
  if (las && typeof las === 'object') {
    const j = jwtFromSessionShape(las);
    if (j) return j;
  }
  const sessions = root.sessions;
  if (Array.isArray(sessions)) {
    for (const s of sessions) {
      const j = jwtFromSessionShape(s);
      if (j) return j;
    }
  }
  return null;
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Clerk browser SDK calls POST /v1/client/sessions/{id}/touch after setActive — establishes session cookie for some tenants.
 * @param {string} sessionId
 * @param {string} clientCookie
 * @returns {{ data: object, setCookieLines: string[], clientCookie: string }}
 */
async function touchClerkSession(sessionId, clientCookie) {
  const path = `client/sessions/${encodeURIComponent(sessionId)}/touch?_clerk_js_version=${CLERK_JS_VERSION}`;
  const { data, setCookieLines } = await clerkHttpsJson('POST', path, {
    cookieClient: clientCookie,
    extraHeaders: {
      Origin: CLERK_ORIGIN,
      Referer: CLERK_REFERER,
    },
    body: formBody({}),
  });
  const cc = clientCookieAfterSetCookieLines(clientCookie, setCookieLines);
  return { data, setCookieLines, clientCookie: cc };
}

function logClerkDebugGetClient(phase, { statusCode, data, setCookieLines }) {
  if (!clerkDebugOtpEnabled()) return;
  const names = setCookieNamesForDebug(setCookieLines);
  logger.info(
    `[CLERK_DEBUG_OTP] GET /client (${phase}) status=${statusCode ?? 'n/a'} topKeys=${data && typeof data === 'object' ? Object.keys(data).join(', ') : 'n/a'}`,
  );
  logger.info(
    `[CLERK_DEBUG_OTP] GET /client (${phase}) hasClient=${!!data?.client} hasResponse=${!!data?.response} clientLikeRoots=${clerkClientLikeObjects(data).length}`,
  );
  logger.info(`[CLERK_DEBUG_OTP] GET /client (${phase}) Set-Cookie names: ${names.join(', ') || '(none)'}`);
  for (const root of clerkClientLikeObjects(data)) {
    const id = root.last_active_session_id ?? root.lastActiveSessionId;
    if (id != null && id !== '') {
      logger.info(`[CLERK_DEBUG_OTP] GET /client (${phase}) last_active_session_id present (len=${String(id).length})`);
    }
  }
}

function logClerkDebugSignInSessionHints(label, result) {
  if (!clerkDebugOtpEnabled() || !result || typeof result !== 'object') return;
  const c = (k) => (result[k] != null && result[k] !== '' ? 'yes' : 'no');
  logger.info(
    `[CLERK_DEBUG_OTP] ${label} session hints: created_session_id=${c('created_session_id')} createdSessionId=${c('createdSessionId')} last_active_session_id=${c('last_active_session_id')} lastActiveSessionId=${c('lastActiveSessionId')}`,
  );
}

/**
 * Clerk FAPI via raw `https` so `Set-Cookie` is always visible (fetch/Undici can hide it).
 * @param {string} method
 * @param {string} pathAndQuery - e.g. `client/sign_ins/x/attempt_first_factor?_clerk_js_version=${CLERK_JS_VERSION}`
 * @param {{ cookieClient?: string, extraHeaders?: Record<string, string>, body?: string }} opts
 */
function clerkHttpsJson(method, pathAndQuery, opts = {}) {
  const { cookieClient, sessionCookie, extraHeaders = {}, body } = opts;
  const url = new URL(pathAndQuery.replace(/^\//, ''), `${CLERK_BASE}/`);
  const headers = {
    'User-Agent': randomUserAgent(),
    ...extraHeaders,
  };
  const deviceCookie = cookieClient ? clerkFapiDeviceCookieHeader(cookieClient) : '';
  // Include session cookie for refresh (even if expired - Clerk uses it to identify the session)
  const cookieHeader = sessionCookie 
    ? `__session=${sessionCookie}${deviceCookie ? `; ${deviceCookie}` : ''}`
    : deviceCookie;
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  const bodyStr = body != null ? body : undefined;
  if (bodyStr !== undefined) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers['Content-Length'] = String(Buffer.byteLength(bodyStr, 'utf8'));
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data;
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            data = {
              errors: [{ message: 'Invalid JSON from Clerk', long_message: text.slice(0, 240) }],
            };
          }
          const raw = res.headers['set-cookie'];
          const setCookieLines = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
          resolve({ statusCode: res.statusCode, data, setCookieLines });
        });
      },
    );
    req.on('error', reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

/** Try to read a session JWT embedded in Clerk Client JSON when Set-Cookie is absent (multiple FAPI envelopes). */
function sessionJwtFromClerkClientPayload(data) {
  const seen = new Set();
  const roots = [];
  function add(obj) {
    if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
    seen.add(obj);
    roots.push(obj);
  }
  for (const root of clerkClientLikeObjects(data)) add(root);
  add(data?.response);
  add(data?.client?.sign_in);
  for (const root of roots) {
    const j = extractJwtFromClientLikeObject(root);
    if (j) return j;
  }
  return null;
}

/** Clerk often returns fresh device cookies on sign_in / prepare / attempt. */
function clientCookieAfterResponse(prior, headers) {
  const lines = getSetCookieHeaderLines(headers);
  return clientCookieAfterSetCookieLines(prior, lines);
}

/**
 * When global fetch omits Set-Cookie (no getSetCookie, broken undici build, some proxies),
 * raw node https still exposes headers['set-cookie'] reliably.
 */
/** @returns {Promise<string[]>} raw Set-Cookie lines */
function fetchClerkClientCookieViaHttps() {
  return new Promise((resolve, reject) => {
    const u = new URL(`${CLERK_BASE}/client`);
    u.searchParams.set('_clerk_js_version', CLERK_JS_VERSION);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': randomUserAgent(),
          Origin: CLERK_ORIGIN,
          Referer: CLERK_REFERER,
        },
      },
      (res) => {
        res.resume();
        const raw = res.headers['set-cookie'];
        const lines = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
        resolve(lines);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function deviceJarFromBootstrapLines(lines) {
  let jar = mergeDeviceJar({}, lines);
  const parsed = parseCookies(lines);
  const c = parsed['__client']?.trim();
  const uat = parsed['__client_uat']?.trim();
  if (c) jar.__client = c;
  else if (uat && uat !== '0' && (uat.length > 20 || uat.startsWith('eyJ'))) jar.__client = uat;
  if (uat) jar.__client_uat = uat;
  return jar;
}

async function obtainClerkClientCookie() {
  const clientRes = await fetch(`${CLERK_BASE}/client?_clerk_js_version=${CLERK_JS_VERSION}`, {
    headers: {
      'User-Agent': randomUserAgent(),
      'Origin': CLERK_ORIGIN,
      'Referer': CLERK_REFERER,
    },
  });

  const lines1 = getSetCookieHeaderLines(clientRes.headers);
  let jar = deviceJarFromBootstrapLines(lines1);

  try {
    await clientRes.text();
  } catch {
    /* drain body for undici connection reuse */
  }

  if (!jar.__client) {
    logger.warn('[CLERK] fetch() did not expose __client cookie; retrying bootstrap via https');
    try {
      const lines2 = await fetchClerkClientCookieViaHttps();
      jar = mergeDeviceJar(jar, lines2);
      const p2 = parseCookies(lines2);
      const c = p2['__client']?.trim();
      const uat = p2['__client_uat']?.trim();
      if (c) jar.__client = c;
      else if (uat && uat !== '0' && (uat.length > 20 || uat.startsWith('eyJ'))) jar.__client = uat;
      if (uat) jar.__client_uat = uat;
    } catch (err) {
      logger.error(`[CLERK] https bootstrap failed: ${err.message}`);
    }
  }

  const clientCookie = serializeClerkDeviceCookieJar(jar);
  if (!clientCookie || !jar.__client) {
    throw new Error(
      'Failed to get __client cookie from Clerk. Use Node.js 18.14+ or check outbound HTTPS to clerk.openrouter.ai (no MITM stripping Set-Cookie).',
    );
  }

  return clientCookie;
}

const DEFAULT_SESSION_TTL_MS = 86400000; // 24h — used when JWT has no exp or payload is unreadable

// Clerk sessions backed by __client cookie last ~7 days.
// JWT exp (~2.5 min) is just a short-lived proof token, NOT the session lifetime.
const CLERK_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Realistic session expiry for storage — use this instead of JWT exp. */
function realisticSessionExpiry() {
  return new Date(Date.now() + CLERK_SESSION_TTL_MS).toISOString();
}

// Decode JWT exp claim without a library. Never returns null: missing exp breaks dashboard session UX (sessionStatus stays "unknown").
export function getJwtExpiry(jwt) {
  const fallback = () => new Date(Date.now() + DEFAULT_SESSION_TTL_MS).toISOString();
  if (!jwt || typeof jwt !== 'string' || !jwt.trim()) return fallback();
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return fallback();
    const payload = parts[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const exp = decoded?.exp;
    if (exp != null && Number.isFinite(Number(exp))) {
      return new Date(Number(exp) * 1000).toISOString();
    }
    return fallback();
  } catch {
    return fallback();
  }
}

function formBody(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** User-facing text from Clerk `errors[0]` — prefer `long_message` (e.g. "`code` is required…") over short `message` ("is missing"). */
function clerkApiErrorText(errors) {
  const e = errors?.[0];
  if (!e) return 'Unknown error';
  const text = String(e.long_message || e.message || 'Unknown error').trim();
  if (e.long_message && e.message && e.long_message !== e.message) {
    logger.warn(
      `[CLERK] ${e.message} (long_message: ${e.long_message}${e.code != null ? `, code: ${e.code}` : ''})`,
    );
  }
  return text;
}

/** Clerk FAPI returns snake_case; JS SDK types use camelCase — accept both. */
function emailAddressIdFromEmailCodeFactor(factor) {
  if (!factor || factor.strategy !== 'email_code') return null;
  return factor.email_address_id ?? factor.emailAddressId ?? null;
}

/**
 * Step 1: Get the __client cookie (identifies our "device" to Clerk)
 * Also starts a sign_in attempt to detect what auth strategies are available.
 *
 * @param {string} email
 * @returns {{ signInId, clientCookie, strategies, method, emailAddressId }}
 */
export async function detectAuthMethod(email) {
  let clientCookie = await obtainClerkClientCookie();

  // Step 1b: POST /v1/client/sign_ins with just the identifier to get strategies
  const signInRes = await fetch(`${CLERK_BASE}/client/sign_ins?_clerk_js_version=${CLERK_JS_VERSION}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': clerkFapiDeviceCookieHeader(clientCookie),
      'User-Agent': randomUserAgent(),
      'Origin': CLERK_ORIGIN,
      'Referer': CLERK_REFERER,
    },
    body: formBody({ identifier: email }),
  });

  clientCookie = clientCookieAfterResponse(clientCookie, signInRes.headers);

  const signInData = await signInRes.json();

  if (signInData.errors?.length) {
    throw new Error(`Clerk error: ${clerkApiErrorText(signInData.errors)}`);
  }

  const signIn = signInData.response || signInData.client?.sign_in;
  if (!signIn) throw new Error('Unexpected Clerk response shape');

  const factors = signIn.supported_first_factors || [];
  const strategies = factors.map((f) => f.strategy);
  const signInId = signIn.id;

  const emailCodeFactor = factors.find((f) => f.strategy === 'email_code');
  const emailAddressId = emailAddressIdFromEmailCodeFactor(emailCodeFactor);

  // Determine primary auth method
  let method = 'otp';
  if (strategies.includes('password')) method = 'password';
  else if (strategies.includes('oauth_google')) method = 'google';

  return { signInId, clientCookie, strategies, method, emailAddressId };
}

/**
 * Full password sign-in. Returns session cookies on success.
 *
 * @param {string} email
 * @param {string} password
 * @returns {{ sessionCookie, clientCookie, sessionExpiry }}
 */
export async function signInWithPassword(email, password) {
  let { signInId, clientCookie } = await detectAuthMethod(email);

  const attemptPath = `client/sign_ins/${encodeURIComponent(signInId)}/attempt_first_factor?_clerk_js_version=${CLERK_JS_VERSION}`;
  const { data: attemptData, setCookieLines } = await clerkHttpsJson('POST', attemptPath, {
    cookieClient: clientCookie,
    extraHeaders: {
      Origin: CLERK_ORIGIN,
      Referer: CLERK_REFERER,
    },
    body: formBody({ strategy: 'password', password }),
  });

  const clientCookiePrior = clientCookie;
  clientCookie = clientCookieAfterSetCookieLines(clientCookie, setCookieLines);

  if (attemptData.errors?.length) {
    throw new Error(`Auth failed: ${clerkApiErrorText(attemptData.errors)}`);
  }

  const result = attemptData.response || attemptData.client?.sign_in;
  if (!result || result.status !== 'complete') {
    // May need 2FA
    if (result?.status === 'needs_second_factor') {
      throw new NeedSecondFactorError(signInId, clientCookie);
    }
    throw new Error(`Sign-in incomplete: status=${result?.status}`);
  }

  const resolved = await resolveSessionAfterCompletedAttempt(
    attemptData,
    setCookieLines,
    clientCookiePrior,
    signInId,
    'password',
  );
  if (!resolved) throw new Error('No __session cookie returned');
  return resolved;
}

const GET_CLIENT_MAX_ATTEMPTS = 3;
const GET_CLIENT_RETRY_MS = 150;

// OTP-specific constants: Clerk session propagation after OTP can take 2-4 seconds
const GET_CLIENT_MAX_ATTEMPTS_OTP = 8;
const GET_CLIENT_RETRY_MS_OTP = 500;

/**
 * GET /v1/client with optional retries; merges __client from Set-Cookie; extracts __session or embedded JWT.
 * @param {string} clientCookie - The __client cookie
 * @param {string} [sessionCookie] - Optional __session cookie (needed for refresh even if expired)
 * @param {{ debugPhase?: string, maxAttempts?: number, retryMs?: number }} [opts]
 * @returns {{ sessionCookie, clientCookie, sessionExpiry, setCookieLines } | null}
 */
async function clerkGetClientSession(clientCookie, sessionCookie, { debugPhase = 'client', maxAttempts = 1, retryMs = 150 } = {}) {
  let cc = clientCookie;
  let lastSetCookieLines = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { statusCode, data, setCookieLines } = await clerkHttpsJson('GET', `client?_clerk_js_version=${CLERK_JS_VERSION}`, {
      cookieClient: cc,
      sessionCookie, // Pass session for refresh
      extraHeaders: {
        Origin: CLERK_ORIGIN,
        Referer: CLERK_REFERER,
      },
    });
    logClerkDebugGetClient(`${debugPhase} attempt ${attempt}/${maxAttempts}`, { statusCode, data, setCookieLines });
    logClerkDebugSignInSessionHints(`${debugPhase} GET /client`, data.response || data.client?.sign_in);

    lastSetCookieLines = setCookieLines || [];
    cc = clientCookieAfterSetCookieLines(cc, setCookieLines);
    let newSessionCookie = sessionCookieFromSetCookieLines(setCookieLines);
    if (!newSessionCookie) newSessionCookie = sessionJwtFromClerkClientPayload(data);
    if (newSessionCookie) return { sessionCookie: newSessionCookie, clientCookie: cc, sessionExpiry: realisticSessionExpiry(), setCookieLines: lastSetCookieLines };
    if (attempt < maxAttempts) await sleepMs(retryMs);
  }
  return null;
}

/**
 * Some Clerk flows return the session object inline rather than in cookies.
 * Retries GET /client a few times when the first response has no session (timing / propagation).
 * OTP/2FA paths use a longer window (8 × 500ms = 4s) since Clerk propagation is slower after email codes.
 */
async function getSessionToken(signInId, clientCookie, debugPhase = 'fallback', { maxAttempts, retryMs } = {}) {
  const phase = `${debugPhase} signIn=${String(signInId).slice(0, 12)}…`;
  const isOtpPath = /^(otp|2fa)\b/i.test(debugPhase);
  return clerkGetClientSession(clientCookie, {
    debugPhase: phase,
    maxAttempts: maxAttempts ?? (isOtpPath ? GET_CLIENT_MAX_ATTEMPTS_OTP : GET_CLIENT_MAX_ATTEMPTS),
    retryMs: retryMs ?? (isOtpPath ? GET_CLIENT_RETRY_MS_OTP : GET_CLIENT_RETRY_MS),
  });
}

/**
 * After attempt_first_factor / attempt_second_factor with status=complete: cookies, embedded JWT,
 * optional POST .../sessions/{id}/touch (browser setActive parity), then GET /client fallback.
 * @returns {{ sessionCookie, clientCookie, sessionExpiry, setCookieLines } | null}
 */
async function resolveSessionAfterCompletedAttempt(attemptData, setCookieLines, clientCookieIn, signInId, debugLabel) {
  let cc = clientCookieAfterSetCookieLines(clientCookieIn, setCookieLines);
  let sessionCookie = sessionCookieFromSetCookieLines(setCookieLines);
  if (!sessionCookie) sessionCookie = sessionJwtFromClerkClientPayload(attemptData);

  // Accumulate all Set-Cookie lines throughout the flow
  let allSetCookieLines = [...(setCookieLines || [])];

  const result = attemptData.response || attemptData.client?.sign_in;
  logClerkDebugSignInSessionHints(`${debugLabel} after attempt`, result);

  const createdId = result?.created_session_id || result?.createdSessionId;
  if (!sessionCookie && createdId) {
    if (clerkDebugOtpEnabled()) {
      logger.info(
        `[CLERK_DEBUG_OTP] ${debugLabel} POST client/sessions/.../touch (session id len=${String(createdId).length})`,
      );
    }
    try {
      const touch = await touchClerkSession(createdId, cc);
      cc = touch.clientCookie;
      if (touch.data?.errors?.length) {
        logger.warn(`[CLERK] session touch (${debugLabel}): ${clerkApiErrorText(touch.data.errors)}`);
      } else {
        sessionCookie = sessionCookieFromSetCookieLines(touch.setCookieLines);
        if (!sessionCookie) sessionCookie = sessionJwtFromClerkClientPayload(touch.data);
      }
      if (clerkDebugOtpEnabled()) {
        const n = setCookieNamesForDebug(touch.setCookieLines);
        logger.info(`[CLERK_DEBUG_OTP] ${debugLabel} touch Set-Cookie names: ${n.join(', ') || '(none)'}`);
      }
      // Add touch Set-Cookie lines to accumulated list
      if (touch.setCookieLines) {
        allSetCookieLines = [...allSetCookieLines, ...touch.setCookieLines];
      }
    } catch (err) {
      logger.warn(`[CLERK] session touch (${debugLabel}) failed: ${err.message}`);
    }
  }

  if (!sessionCookie) {
    const tokenResult = await getSessionToken(signInId, cc, debugLabel);
    if (tokenResult?.setCookieLines) {
      allSetCookieLines = [...allSetCookieLines, ...tokenResult.setCookieLines];
    }
    return tokenResult ? { ...tokenResult, setCookieLines: allSetCookieLines } : null;
  }
  return { sessionCookie, clientCookie: cc, sessionExpiry: realisticSessionExpiry(), setCookieLines: allSetCookieLines };
}

/**
 * Trigger an email OTP to the account's email.
 * Works for ALL account types (password, google, etc.) as fallback.
 *
 * @param {string} email
 * @returns {{ signInId, clientCookie, emailAddressId }}
 */
export async function startEmailOTP(email) {
  const { signInId, clientCookie, strategies, emailAddressId } = await detectAuthMethod(email);

  if (!strategies.includes('email_code')) {
    throw new Error(`email_code strategy not available for ${email}. Available: ${strategies.join(', ')}`);
  }

  if (!emailAddressId) {
    throw new Error(
      'Clerk did not return email_address_id for email_code. OpenRouter may have changed sign-in; check supported_first_factors.',
    );
  }

  /** Send OTP email — must use prepare_first_factor; attempt_first_factor with email_code requires `code` (verify step only). */
  const otpRes = await fetch(
    `${CLERK_BASE}/client/sign_ins/${signInId}/prepare_first_factor?_clerk_js_version=${CLERK_JS_VERSION}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': clerkFapiDeviceCookieHeader(clientCookie),
        'User-Agent': randomUserAgent(),
        'Origin': CLERK_ORIGIN,
        'Referer': CLERK_REFERER,
      },
      body: formBody({ strategy: 'email_code', email_address_id: emailAddressId }),
    }
  );

  const mergedClient = clientCookieAfterResponse(clientCookie, otpRes.headers);

  const otpData = await otpRes.json();
  if (otpData.errors?.length) throw new Error(clerkApiErrorText(otpData.errors));

  const prepared = otpData.response || otpData.client?.sign_in;
  const resolvedSignInId = prepared?.id && typeof prepared.id === 'string' ? prepared.id : signInId;

  return {
    signInId: resolvedSignInId,
    clientCookie: mergedClient,
    emailAddressId,
  };
}

/**
 * Send a Clerk magic-link (email_link strategy) to the given email.
 * The user clicks the link → Clerk redirects to `redirectUrl` with a token.
 * Hydra's callback handler (`GET /api/auth/magic-callback`) completes the sign-in.
 *
 * @param {string} email
 * @param {string} redirectUrl  e.g. "http://localhost:3001/api/auth/magic-callback?accountId=xxx"
 * @returns {{ signInId, clientCookie, emailAddressId }}
 */
export async function sendMagicLink(email, redirectUrl) {
  const { signInId, clientCookie, strategies, emailAddressId } = await detectAuthMethod(email);

  if (!strategies.includes('email_link')) {
    // Many OpenRouter accounts support email_link; throw with available list so caller can fall back
    throw new Error(`email_link strategy not available for ${email}. Available: ${strategies.join(', ')}`);
  }

  if (!emailAddressId) {
    throw new Error('Clerk did not return email_address_id for email_link strategy.');
  }

  const prepRes = await fetch(
    `${CLERK_BASE}/client/sign_ins/${signInId}/prepare_first_factor?_clerk_js_version=${CLERK_JS_VERSION}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': clerkFapiDeviceCookieHeader(clientCookie),
        'User-Agent': randomUserAgent(),
        'Origin': CLERK_ORIGIN,
        'Referer': CLERK_REFERER,
      },
      body: formBody({
        strategy: 'email_link',
        email_address_id: emailAddressId,
        redirect_url: redirectUrl,
      }),
    }
  );

  const mergedClient = clientCookieAfterResponse(clientCookie, prepRes.headers);
  const prepData = await prepRes.json();
  if (prepData.errors?.length) throw new Error(clerkApiErrorText(prepData.errors));

  const prepared = prepData.response || prepData.client?.sign_in;
  const resolvedSignInId = prepared?.id ?? signInId;

  return {
    signInId: resolvedSignInId,
    clientCookie: mergedClient,
    emailAddressId,
  };
}

/**
 * Complete email OTP sign-in with 6-digit code from email.
 *
 * @param {string} signInId
 * @param {string} code
 * @param {string} clientCookie
 * @returns {{ sessionCookie, clientCookie, sessionExpiry }}
 */
export async function completeEmailOTP(signInId, code, clientCookie) {
  const attemptPath = `client/sign_ins/${encodeURIComponent(signInId)}/attempt_first_factor?_clerk_js_version=${CLERK_JS_VERSION}`;
  const { data, setCookieLines } = await clerkHttpsJson('POST', attemptPath, {
    cookieClient: clientCookie,
    extraHeaders: {
      Origin: CLERK_ORIGIN,
      Referer: CLERK_REFERER,
    },
    body: formBody({ strategy: 'email_code', code }),
  });

  if (clerkDebugOtpEnabled()) {
    const names = setCookieNamesForDebug(setCookieLines);
    logger.info(`[CLERK_DEBUG_OTP] attempt_first_factor Set-Cookie names: ${names.join(', ') || '(none)'}`);
    const dbgResult = data.response || data.client?.sign_in;
    logger.info(
      `[CLERK_DEBUG_OTP] sign_in keys: ${dbgResult ? Object.keys(dbgResult).join(', ') : 'no result'}`,
    );
    logClerkDebugSignInSessionHints('otp attempt_first_factor', dbgResult);
  }

  if (data.errors?.length) throw new Error(`OTP error: ${clerkApiErrorText(data.errors)}`);

  const result = data.response || data.client?.sign_in;
  if (!result) {
    throw new Error('Sign-in incomplete after OTP: Clerk returned no sign_in object.');
  }
  if (result.status !== 'complete') {
    throw new Error(`Sign-in incomplete after OTP: status=${result.status ?? 'unknown'}`);
  }

  const resolved = await resolveSessionAfterCompletedAttempt(data, setCookieLines, clientCookie, signInId, 'otp');
  if (!resolved) {
    throw new Error(
      'Clerk sign-in completed after OTP but no __session was returned (Set-Cookie or client payload). Set CLERK_DEBUG_OTP=1 and retry.',
    );
  }
  return resolved;
}

/**
 * Complete an email_link (magic link) sign-in.
 * When Clerk redirects the user's browser to our callback URL it appends `__clerk_ticket=<token>`.
 * We POST that token via attempt_first_factor with strategy: email_link.
 *
 * @param {string} signInId    - from pendingMagicLinks (set when we called sendMagicLink)
 * @param {string} clientCookie - stored device cookie from pendingMagicLinks
 * @param {string} [clerkTicket] - the __clerk_ticket query param from the redirect URL (if available)
 * @returns {{ sessionCookie, clientCookie, sessionExpiry }}
 */
export async function completeEmailLink(signInId, clientCookie, clerkTicket) {
  const attemptPath = `client/sign_ins/${encodeURIComponent(signInId)}/attempt_first_factor?_clerk_js_version=${CLERK_JS_VERSION}`;
  const body = clerkTicket
    ? formBody({ strategy: 'email_link', token: clerkTicket })
    : formBody({ strategy: 'email_link' });

  const { data, setCookieLines } = await clerkHttpsJson('POST', attemptPath, {
    cookieClient: clientCookie,
    extraHeaders: {
      Origin: CLERK_ORIGIN,
      Referer: CLERK_REFERER,
    },
    body,
  });

  if (data.errors?.length) throw new Error(`Magic link error: ${clerkApiErrorText(data.errors)}`);

  const result = data.response || data.client?.sign_in;
  if (!result) throw new Error('Magic link sign-in returned no sign_in object from Clerk.');
  if (result.status !== 'complete') {
    throw new Error(`Magic link sign-in incomplete: status=${result.status ?? 'unknown'}`);
  }

  const resolved = await resolveSessionAfterCompletedAttempt(data, setCookieLines, clientCookie, signInId, 'email_link');
  if (!resolved) {
    throw new Error('Clerk magic link completed but no __session cookie returned. This may be a Clerk config issue.');
  }
  return resolved;
}

/**
 * Complete TOTP 2FA (for accounts that have authenticator app enabled)
 *
 * @param {string} signInId
 * @param {string} totpCode
 * @param {string} clientCookie
 * @returns {{ sessionCookie, clientCookie, sessionExpiry }}
 */
export async function completeSecondFactor(signInId, totpCode, clientCookie) {
  const path2 = `client/sign_ins/${encodeURIComponent(signInId)}/attempt_second_factor?_clerk_js_version=${CLERK_JS_VERSION}`;
  const { data, setCookieLines } = await clerkHttpsJson('POST', path2, {
    cookieClient: clientCookie,
    extraHeaders: {
      Origin: CLERK_ORIGIN,
      Referer: CLERK_REFERER,
    },
    body: formBody({ strategy: 'totp', code: totpCode }),
  });

  if (data.errors?.length) throw new Error(`2FA error: ${clerkApiErrorText(data.errors)}`);

  const result2 = data.response || data.client?.sign_in;
  if (!result2 || result2.status !== 'complete') {
    throw new Error(`2FA incomplete: status=${result2?.status ?? 'unknown'}`);
  }

  const resolved = await resolveSessionAfterCompletedAttempt(data, setCookieLines, clientCookie, signInId, '2fa');
  if (!resolved) throw new Error('2FA complete but no session cookie or embedded JWT');
  return resolved;
}

/**
 * Refresh a session using the existing __client cookie and (optionally) expired __session.
 * Avoids a full re-login if the session has expired but client cookie is still valid.
 * The expired __session is used by Clerk to identify which session to refresh.
 *
 * Exploit #14: Cookie stacking — if clientCookie is an array of {cookie, issuedAt},
 * tries each newest-first and returns on the first success. Dead cookies are noted
 * in the result so callers can prune them.
 *
 * @param {string|Array<{cookie: string, issuedAt: string}>} clientCookie - Single cookie string or stacked array
 * @param {string} [sessionCookie] - Optional expired __session cookie (highly recommended for refresh)
 * @returns {{ sessionCookie, clientCookie, sessionExpiry, deadClientCookies? } | null}
 */
export async function refreshSession(clientCookie, sessionCookie) {
  // Exploit #14: If caller passes a stacked array, try newest-first
  if (Array.isArray(clientCookie) && clientCookie.length > 0) {
    const deadClientCookies = [];
    for (const entry of clientCookie) {
      try {
        const result = await clerkGetClientSession(entry.cookie, sessionCookie, {
          debugPhase: 'refresh',
          maxAttempts: GET_CLIENT_MAX_ATTEMPTS,
          retryMs: GET_CLIENT_RETRY_MS,
        });
        if (result) {
          return { ...result, deadClientCookies };
        }
      } catch {
        // This cookie is dead — record it
      }
      deadClientCookies.push(entry);
    }
    // All cookies in the stack failed
    return null;
  }

  // Single cookie string (original behavior)
  try {
    return await clerkGetClientSession(clientCookie, sessionCookie, {
      debugPhase: 'refresh',
      maxAttempts: GET_CLIENT_MAX_ATTEMPTS,
      retryMs: GET_CLIENT_RETRY_MS,
    });
  } catch {
    return null;
  }
}

/**
 * Time remaining below which a session is "expiring" in the UI.
 * Sessions backed by __client cookie last ~7 days. Show "expiring" warning in the last 24h
 * so the auto-refresher and user have time to act.
 */
export const SESSION_EXPIRING_SOON_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if stored session expiry is still in the future.
 * `sessionExpiry` is now a realistic 7-day TTL (set at login/refresh), not JWT exp.
 * For ground-truth validation, use validateSession() (makes an API call).
 *
 * @param {string} sessionExpiry - ISO date string (7-day TTL from login/refresh)
 * @returns {boolean} true if session TTL hasn't elapsed
 */
export function isSessionValid(sessionExpiry) {
  if (!sessionExpiry) return false;
  const expiry = new Date(sessionExpiry).getTime();
  return expiry > Date.now();
}

/**
 * Check if session is ACTUALLY valid by making an API call.
 * This is the ONLY reliable way to determine session status.
 * Clerk JWTs expire quickly (~2.5 min) but sessions auto-refresh and last 12+ hours.
 * 
 * @param {string} sessionCookie - The __session cookie value
 * @returns {Promise<boolean>} true if session is actually valid
 */
export async function isSessionActuallyValid(sessionCookie) {
  if (!sessionCookie || typeof sessionCookie !== 'string') return false;
  return validateSession(sessionCookie);
}

/**
 * Validate a session cookie by calling the OpenRouter credits API
 */
export async function validateSession(sessionCookie) {
  try {
    const res = await fetch(`${OR_BASE}/api/v1/credits`, {
      headers: {
        'Cookie': `__session=${sessionCookie}`,
        'User-Agent': randomUserAgent(),
      },
    });
    return res.status !== 401 && res.status !== 403;
  } catch (err) {
    logger.error(`[CLERK] Session validation failed: ${err.message}`);
    return false;
  }
}
