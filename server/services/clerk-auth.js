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
import { USER_AGENT, CLERK_BASE, CLERK_ORIGIN, CLERK_REFERER, OR_BASE } from '../config.js';
import { logger } from './logger.js';

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
 * @returns {Record<string, string>}
 */
export function parseClerkDeviceCookieJar(stored) {
  const t = stored != null ? String(stored).trim() : '';
  if (!t || t === 'undefined') return {};
  if (!t.includes(';')) {
    return { __client: t };
  }
  const jar = {};
  for (const part of t.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (isClerkDeviceCookieName(k) && v) jar[k] = v;
  }
  return Object.keys(jar).length ? jar : { __client: t };
}

/**
 * Parse ALL device cookies from stored string (Clerk + Cloudflare + any others).
 * This preserves all cookies needed for dashboard access, not just Clerk ones.
 * @returns {Record<string, string>}
 */
function parseAllDeviceCookies(stored) {
  const t = stored != null ? String(stored).trim() : '';
  if (!t || t === 'undefined') return {};
  const jar = {};
  for (const part of t.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    // Preserve ALL non-empty cookies except __session (handled separately)
    if (k && v && k !== '__session') jar[k] = v;
  }
  return jar;
}

/**
 * Cookie header value for Clerk FAPI (clerk.openrouter.ai): Clerk device cookies only, sorted.
 */
export function clerkFapiDeviceCookieHeader(stored) {
  const jar = parseClerkDeviceCookieJar(stored);
  const keys = Object.keys(jar).filter((k) => isClerkDeviceCookieName(k) && jar[k]).sort();
  if (!keys.length) return '';
  return keys.map((k) => `${k}=${jar[k]}`).join('; ');
}

/**
 * Device cookie fragment for openrouter.ai dashboard tRPC (after __session).
 * Includes ALL device cookies: Clerk + Cloudflare (cf_bm, cfuvid, cf_clearance).
 */
export function openRouterDashboardDeviceCookies(stored) {
  const jar = parseAllDeviceCookies(stored);
  const out = [];
  const uat = jar.__client_uat;
  const client = jar.__client;
  const legacySingle = Object.keys(jar).length === 1 && client && !uat;
  if (uat) out.push(`__client_uat=${uat}`);
  else if (legacySingle) out.push(`__client_uat=${client}`);
  if (client && client !== uat) out.push(`__client=${client}`);
  for (const k of Object.keys(jar).sort()) {
    // Skip already-added Clerk cookies to avoid duplicates
    if (k === '__client' || k === '__client_uat') continue;
    // Include both Clerk cookies AND Cloudflare cookies
    if (isDashboardDeviceCookieName(k)) out.push(`${k}=${jar[k]}`);
  }
  return out.join('; ');
}

/** Playwright cookie injection for openrouter.ai - includes ALL device cookies. */
export function openRouterPlaywrightDeviceCookies(stored) {
  const jar = parseAllDeviceCookies(stored);
  const list = [];
  const uat = jar.__client_uat ?? (Object.keys(jar).length === 1 && jar.__client ? jar.__client : null);
  if (uat) list.push({ name: '__client_uat', value: uat, domain: 'openrouter.ai', path: '/' });
  if (jar.__client && jar.__client !== uat) {
    list.push({ name: '__client', value: jar.__client, domain: 'openrouter.ai', path: '/' });
  }
  for (const k of Object.keys(jar)) {
    // Skip already-added Clerk cookies to avoid duplicates
    if (k === '__client' || k === '__client_uat') continue;
    // Include ALL dashboard cookies (Clerk + Cloudflare)
    if (isDashboardDeviceCookieName(k)) {
      list.push({ name: k, value: jar[k], domain: 'openrouter.ai', path: '/' });
    }
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
 */
function serializeClerkDeviceCookieJar(jar) {
  const keys = Object.keys(jar).filter((k) => isClerkDeviceCookieName(k) && jar[k]).sort();
  if (!keys.length) return '';
  if (keys.length === 1 && keys[0] === '__client') return jar.__client;
  return keys.map((k) => `${k}=${jar[k]}`).join('; ');
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

/** Merge ALL device cookies from Set-Cookie into stored jar (survives OTP / touch). */
function clientCookieAfterSetCookieLines(prior, setCookieLines) {
  // Use parseAllDeviceCookies to preserve ALL cookies (Clerk + Cloudflare)
  const jar = parseAllDeviceCookies(prior);
  // Merge using dashboard filter to include Cloudflare cookies from Set-Cookie
  const merged = mergeDeviceJar(jar, setCookieLines, isDashboardDeviceCookieName);
  const s = serializeAllDeviceCookies(merged);
  return s || prior;
}

/**
 * Serialize all device cookies for storage (Clerk + Cloudflare).
 * Single __client only stays legacy string; multiple keys → `a=b; c=d`.
 */
function serializeAllDeviceCookies(jar) {
  const keys = Object.keys(jar).filter((k) => isDashboardDeviceCookieName(k) && jar[k]).sort();
  if (!keys.length) return '';
  if (keys.length === 1 && keys[0] === '__client') return jar.__client;
  return keys.map((k) => `${k}=${jar[k]}`).join('; ');
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
  const path = `client/sessions/${encodeURIComponent(sessionId)}/touch?_clerk_js_version=5.0.0`;
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
 * @param {string} pathAndQuery - e.g. `client/sign_ins/x/attempt_first_factor?_clerk_js_version=5.0.0`
 * @param {{ cookieClient?: string, extraHeaders?: Record<string, string>, body?: string }} opts
 */
function clerkHttpsJson(method, pathAndQuery, opts = {}) {
  const { cookieClient, extraHeaders = {}, body } = opts;
  const url = new URL(pathAndQuery.replace(/^\//, ''), `${CLERK_BASE}/`);
  const headers = {
    'User-Agent': USER_AGENT,
    ...extraHeaders,
  };
  const deviceCookie = cookieClient ? clerkFapiDeviceCookieHeader(cookieClient) : '';
  if (deviceCookie) headers['Cookie'] = deviceCookie;
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
    u.searchParams.set('_clerk_js_version', '5.0.0');
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
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
  const clientRes = await fetch(`${CLERK_BASE}/client?_clerk_js_version=5.0.0`, {
    headers: {
      'User-Agent': USER_AGENT,
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
  const signInRes = await fetch(`${CLERK_BASE}/client/sign_ins?_clerk_js_version=5.0.0`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': clerkFapiDeviceCookieHeader(clientCookie),
      'User-Agent': USER_AGENT,
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

  const attemptPath = `client/sign_ins/${encodeURIComponent(signInId)}/attempt_first_factor?_clerk_js_version=5.0.0`;
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
 */
async function clerkGetClientSession(clientCookie, { debugPhase = 'client', maxAttempts = 1, retryMs = 150 } = {}) {
  let cc = clientCookie;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { statusCode, data, setCookieLines } = await clerkHttpsJson('GET', 'client?_clerk_js_version=5.0.0', {
      cookieClient: cc,
    extraHeaders: {
      Origin: CLERK_ORIGIN,
      Referer: CLERK_REFERER,
    },
    });
    logClerkDebugGetClient(`${debugPhase} attempt ${attempt}/${maxAttempts}`, { statusCode, data, setCookieLines });
    logClerkDebugSignInSessionHints(`${debugPhase} GET /client`, data.response || data.client?.sign_in);

    cc = clientCookieAfterSetCookieLines(cc, setCookieLines);
    let sessionCookie = sessionCookieFromSetCookieLines(setCookieLines);
    if (!sessionCookie) sessionCookie = sessionJwtFromClerkClientPayload(data);
    if (sessionCookie) return { sessionCookie, clientCookie: cc, sessionExpiry: getJwtExpiry(sessionCookie) };
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
 */
async function resolveSessionAfterCompletedAttempt(attemptData, setCookieLines, clientCookieIn, signInId, debugLabel) {
  let cc = clientCookieAfterSetCookieLines(clientCookieIn, setCookieLines);
  let sessionCookie = sessionCookieFromSetCookieLines(setCookieLines);
  if (!sessionCookie) sessionCookie = sessionJwtFromClerkClientPayload(attemptData);

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
    } catch (err) {
      logger.warn(`[CLERK] session touch (${debugLabel}) failed: ${err.message}`);
    }
  }

  if (!sessionCookie) return getSessionToken(signInId, cc, debugLabel);
  return { sessionCookie, clientCookie: cc, sessionExpiry: getJwtExpiry(sessionCookie) };
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
    `${CLERK_BASE}/client/sign_ins/${signInId}/prepare_first_factor?_clerk_js_version=5.0.0`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': clerkFapiDeviceCookieHeader(clientCookie),
        'User-Agent': USER_AGENT,
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
 * Complete email OTP sign-in with 6-digit code from email.
 *
 * @param {string} signInId
 * @param {string} code
 * @param {string} clientCookie
 * @returns {{ sessionCookie, clientCookie, sessionExpiry }}
 */
export async function completeEmailOTP(signInId, code, clientCookie) {
  const attemptPath = `client/sign_ins/${encodeURIComponent(signInId)}/attempt_first_factor?_clerk_js_version=5.0.0`;
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
 * Complete TOTP 2FA (for accounts that have authenticator app enabled)
 *
 * @param {string} signInId
 * @param {string} totpCode
 * @param {string} clientCookie
 * @returns {{ sessionCookie, clientCookie, sessionExpiry }}
 */
export async function completeSecondFactor(signInId, totpCode, clientCookie) {
  const path2 = `client/sign_ins/${encodeURIComponent(signInId)}/attempt_second_factor?_clerk_js_version=5.0.0`;
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
 * Refresh a session using the existing __client cookie.
 * Avoids a full re-login if the session has expired but client cookie is still valid.
 *
 * @param {string} clientCookie
 * @returns {{ sessionCookie, clientCookie, sessionExpiry } | null}
 */
export async function refreshSession(clientCookie) {
  try {
    return await clerkGetClientSession(clientCookie, {
      debugPhase: 'refresh',
      maxAttempts: GET_CLIENT_MAX_ATTEMPTS,
      retryMs: GET_CLIENT_RETRY_MS,
    });
  } catch {
    return null;
  }
}

/**
 * Time remaining below which a session is "expiring" in the UI and treated as not reliably valid
 * for ensureSession without refresh — aligned with `getSessionStatus` in store.
 */
export const SESSION_EXPIRING_SOON_MS = 10 * 60 * 1000;

/**
 * True when the session has more than SESSION_EXPIRING_SOON_MS until expiry (same bar as dashboard "expiring" dot).
 *
 * @param {string} sessionExpiry - ISO date string (effective expiry, ideally min(JWT exp, stored))
 * @returns {boolean}
 */
export function isSessionValid(sessionExpiry) {
  if (!sessionExpiry) return false;
  const expiry = new Date(sessionExpiry).getTime();
  const now = Date.now();
  return expiry - now > SESSION_EXPIRING_SOON_MS;
}

/**
 * Validate a session cookie by calling the OpenRouter credits API
 */
export async function validateSession(sessionCookie) {
  try {
    const res = await fetch(`${OR_BASE}/api/v1/credits`, {
      headers: {
        'Cookie': `__session=${sessionCookie}`,
        'User-Agent': USER_AGENT,
      },
    });
    return res.status !== 401 && res.status !== 403;
  } catch (err) {
    logger.error(`[CLERK] Session validation failed: ${err.message}`);
    return false;
  }
}
