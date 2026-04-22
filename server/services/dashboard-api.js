/**
 * Dashboard API Client
 *
 * Calls OpenRouter's internal tRPC endpoints using a valid __session cookie.
 * These are operations that have no public Management API equivalent.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OR_BASE, config, USER_AGENT } from '../config.js';
import {
  isSessionValid,
  signInWithPassword,
  refreshSession,
  NeedSecondFactorError,
  openRouterDashboardDeviceCookies,
  openRouterPlaywrightDeviceCookies,
} from './clerk-auth.js';
import * as store from './store.js';
import { getCredits } from './openrouter.js';
import { runInBatches } from './batch-runner.js';

import {
  truncateForLog,
  extractManagementKeyFromResponseBody,
  normalizeDiscoveredCreateRoute,
  decodeJwtPayloadUnsafe,
  redactSensitiveForProvisionLog,
  MGMT_KEY_RE
} from '../utils/dashboard-utils.js';

const OR_ORIGIN = (() => {
  try {
    return new URL(OR_BASE).origin;
  } catch {
    return 'https://openrouter.ai';
  }
})();

const OR_HOSTNAME = (() => {
  try {
    return new URL(OR_BASE).hostname;
  } catch {
    return 'openrouter.ai';
  }
})();

/** Management key material in tRPC JSON or page text (OpenRouter prefix).
 * NOTE: OpenRouter management keys use 'sk-or-v1-' prefix, NOT 'sk-or-mgmt-'
 */

/**
 * Next.js Server Action ID for management key creation on OpenRouter.
 * Captured from live browser traffic (2026-04-07) by observing the Next-Action
 * header on POST /settings/management-keys when clicking Save in the create dialog.
 * Body format: [{"name":"<key-name>"}]
 * This ID is baked into the Next.js build and will need updating if OpenRouter
 * redeploys with a new build hash.
 */
/** Mutable so self-healing can update at runtime */
let CREATE_MGMT_KEY_ACTION_HASH = config.HYDRA_MGMT_KEY_SERVER_ACTION_ID || '40a4728e6d23484cde9c2e629e0c0cc195dfbbd66b';

/**
 * Next.js Server Action hash for code redemption on /redeem.
 * Captured 2026-04-07 via browser fetch interceptor — stable until OpenRouter redeploys.
 * Override via HYDRA_REDEEM_ACTION_HASH env var if it changes.
 */
let REDEEM_ACTION_HASH = config.HYDRA_REDEEM_ACTION_HASH || '402002bec2b81db80981bde049958688557404e07a';

// ─── Self-healing hash auto-discovery ──────────────────────────────────────
// When a Server Action returns 404, the baked-in hash is stale (OpenRouter
// redeployed).  We fetch the relevant OR page HTML, locate <script> tags,
// grep for 40-char hex strings near known keywords (redeem, management-keys),
// and try each candidate against the endpoint.  On success the module-level
// hash variable is updated so subsequent calls work without a restart.

const HEX40_RE = /[0-9a-f]{40}/g;

/** Known keywords that appear near Server Action hashes in OR's JS bundles. */
const SA_KEYWORDS = ['redeem', 'management-keys', 'managementKey', 'createManagementKey', 'redeemCode'];

/**
 * Fetch a page from OpenRouter, extract all <script src="…"> URLs,
 * fetch each JS bundle, and return an array of 40-char hex candidates
 * found near any of SA_KEYWORDS.
 */
async function discoverServerActionHashes(pageUrl) {
  try {
    const pageRes = await fetch(pageUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!pageRes.ok) return [];
    const html = await pageRes.text();

    // Collect script src URLs
    const scriptUrls = [];
    for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
      let src = m[1];
      // Normalise relative URLs
      if (src.startsWith('/')) src = `${OR_ORIGIN}${src}`;
      else if (!src.startsWith('http')) continue;
      scriptUrls.push(src);
    }

    const candidates = new Set();
    // Fetch each bundle and grep for hex strings near keywords
    const fetches = scriptUrls.map(async (url) => {
      try {
        const jsRes = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(10000),
        });
        if (!jsRes.ok) return;
        const js = await jsRes.text();

        // Strategy 1: find hex40 within ~200 chars of a keyword
        for (const kw of SA_KEYWORDS) {
          let idx = 0;
          while (true) {
            const found = js.indexOf(kw, idx);
            if (found < 0) break;
            const window = js.slice(Math.max(0, found - 300), found + 300);
            for (const m of window.matchAll(HEX40_RE)) {
              candidates.add(m[0]);
            }
            idx = found + kw.length;
          }
        }
      } catch { /* bundle fetch failed — skip */ }
    });
    await Promise.allSettled(fetches);
    return [...candidates];
  } catch (err) {
    console.warn(`[dashboard-api] Hash auto-discovery page fetch failed: ${err.message}`);
    return [];
  }
}

/**
 * Try to self-heal a stale Server Action hash by auto-discovering new candidates.
 * @param {'redeem'|'mgmt-key'} kind - Which hash to repair
 * @param {string} testUrl - The OR endpoint URL to probe with each candidate
 * @param {object} baseHeaders - Headers template (will add Next-Action for each candidate)
 * @param {string} body - Request body
 * @returns {string|null} The new hash if found, or null
 */
async function selfHealHash(kind, testUrl, baseHeaders, body) {
  const pageUrl = kind === 'redeem'
    ? `${OR_BASE}/redeem`
    : `${OR_BASE}/settings/management-keys`;

  console.warn(`[dashboard-api] ⚡ Self-healing ${kind} hash — scanning ${pageUrl} JS bundles…`);
  const candidates = await discoverServerActionHashes(pageUrl);

  for (const candidate of candidates) {
    try {
      const probeHeaders = { ...baseHeaders, 'Next-Action': candidate };
      const probeRes = await fetch(testUrl, {
        method: 'POST',
        headers: probeHeaders,
        body,
        signal: AbortSignal.timeout(10000),
      });
      // Non-404 means the hash was accepted (even if the action returns an
      // application-level error like "invalid code", it confirms the route).
      if (probeRes.status !== 404) {
        console.warn(`[dashboard-api] ✅ Self-healed ${kind} hash → ${candidate}`);
        if (kind === 'redeem') {
          REDEEM_ACTION_HASH = candidate;
        } else {
          CREATE_MGMT_KEY_ACTION_HASH = candidate;
        }
        return candidate;
      }
    } catch { /* probe failed — try next candidate */ }
  }

  console.warn(`[dashboard-api] ❌ Self-healing ${kind} hash failed — no valid candidate found among ${candidates.length} candidates`);
  return null;
}

/**
 * next-router-state-tree header value for the /redeem page — required by Next.js Server Actions.
 * Encodes the app router segment tree for the redeem route.
 */
const REDEEM_ROUTER_STATE_TREE = '%5B%22%22%2C%7B%22children%22%3A%5B%22(user)%22%2C%7B%22children%22%3A%5B%22(dashboard)%22%2C%7B%22children%22%3A%5B%22redeem%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D';

/**
 * Response body cache to prevent race conditions when multiple waitForResponse
 * predicates try to read the same response stream. Playwright response bodies
 * can only be read once - subsequent reads return empty string.
 * Using WeakMap keyed by response object allows automatic cleanup.
 */
const responseBodyCache = new WeakMap();

/**
 * Get response body text with caching to avoid stream consumption race conditions.
 * Multiple waitForResponse predicates may try to read the same response;
 * this ensures the body is only read once and cached for subsequent access.
 *
 * @param {import('playwright').Response} response - Playwright response object
 * @returns {Promise<string>} Response body text
 */
async function getCachedResponseText(response) {
  // Check if already cached
  if (responseBodyCache.has(response)) {
    return responseBodyCache.get(response);
  }
  // Read and cache the body
  const body = await response.text();
  responseBodyCache.set(response, body);
  return body;
}

function provisionNetworkLogEnabled() {
  return config.HYDRA_PROVISION_NETWORK_LOG || provisionDebugArtifactsEnabled();
}


/**
 * Extract sk-or-v1-* (management key) from raw tRPC response text: regex first, then JSON batch / result shapes.
 */


async function persistProvisionedManagementKey(userId, accountId, key, source = 'unknown') {
  if (!key || typeof key !== 'string' || !key.startsWith('sk-or-v1-')) {
    const err = new Error('Provisioning returned an invalid management key format (expected sk-or-v1-*)');
    err.code = 'PROVISION_INVALID_KEY_FORMAT';
    err.source = source;
    throw err;
  }
  
  // Reject preview/masked keys (they contain ... in the middle or are too short)
  if (key.includes('...') || key.length < 40) {
    const err = new Error(`Provisioning returned a masked/preview key (length: ${key.length}) instead of full key - actual key may require clicking "Copy" or "Reveal"`);
    err.code = 'PROVISION_PREVIEW_KEY_REJECTED';
    err.source = source;
    err.keyLength = key.length;
    err.keyPreview = key.slice(0, 20) + '...' + key.slice(-8);
    throw err;
  }

  // Canonical save: ManagementKey table via store abstraction.
  await store.updateAccountManagementKey(userId, accountId, key, {
    name: `Hydra Auto Key (${source})`,
    metadata: { source },
  });

  // Verify it was saved
  const saved = await store.getAccountWithKey(userId, accountId);
  if (!saved?.managementKey || saved.managementKey !== key) {
    const err = new Error('Management key was created but could not be persisted to account');
    err.code = 'PROVISION_PERSIST_FAILED';
    err.source = source;
    throw err;
  }
}

/**
 * Batched tRPC URLs use `/api/trpc/a.b,c.d` — persist a single procedure name for trpcCall replay.
 */

async function writeProvisionNetworkLog(accountId, lines) {
  if (!lines.length) return;
  try {
    const dir = join(tmpdir(), 'hydra-provision-debug');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `provision-network-${accountId}-${Date.now()}.log`);
    const header = `# Hydra provision network log — ${new Date().toISOString()} — accountId=${accountId}\n# POST URL, status, postData only (no response bodies — avoids double-consuming response streams in the browser listener).\n\n`;
    await appendFile(file, header + lines.join('\n'), 'utf8');
    console.error(`[dashboard-api] Provision network log written: ${file}`);
  } catch (err) {
    console.error('[dashboard-api] Could not write provision network log:', err.message);
  }
}

function provisionDebugArtifactsEnabled() {
  return config.NODE_ENV === 'development' || config.HYDRA_PROVISION_DEBUG;
}

function provisionStepLogEnabled() {
  return config.NODE_ENV === 'development' || config.HYDRA_PROVISION_VERBOSE || config.HYDRA_PROVISION_DEBUG;
}

function provisionStepLog(accountId, message, extra = undefined) {
  if (!provisionStepLogEnabled()) return;
  if (extra !== undefined) console.error(`[dashboard-api] provision[${accountId}] ${message}`, extra);
  else console.error(`[dashboard-api] provision[${accountId}] ${message}`);
}

/** Decode JWT payload (no signature verify) — for OR_BASE vs session sanity checks only. */

/** H8: Log OR_BASE / origin and warn on hostname drift; log unexpected JWT iss when verbose. */
function logProvisionOpenRouterBase(accountId, sessionCookie) {
  provisionStepLog(accountId, 'Provision OR_BASE', { OR_BASE, OR_ORIGIN, OR_HOSTNAME });
  try {
    const u = new URL(OR_BASE);
    if (u.hostname !== 'openrouter.ai' && u.hostname !== 'www.openrouter.ai') {
      console.warn(
        `[dashboard-api] OR_BASE hostname is "${u.hostname}" — production OpenRouter is openrouter.ai; wrong OR_BASE breaks cookies and tRPC.`,
      );
    }
  } catch {
    console.warn('[dashboard-api] OR_BASE is not a valid URL — check .env');
  }
  if (!provisionStepLogEnabled()) return;
  const p = decodeJwtPayloadUnsafe(sessionCookie);
  if (p && typeof p.iss === 'string' && p.iss && !/openrouter|clerk\.openrouter/i.test(p.iss)) {
    provisionStepLog(accountId, 'Session JWT iss looks unexpected vs OpenRouter', { iss: p.iss });
  }
}

/** Strip key-like material from stderr previews (management + standard key prefixes). */

const PROVISION_DEBUG_DIR_BASENAME = 'hydra-provision-debug';

/**
 * Thrown when Hydra exhausts tRPC (and optional hooks) and browser automation without capturing `sk-or-v1-…`.
 * Match `err.code === 'PROVISION_KEY_NOT_CAPTURED'`. `legacyCode` is a historical API alias only.
 */
export class ProvisionKeyNotCapturedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ProvisionKeyNotCapturedError';
    this.code = 'PROVISION_KEY_NOT_CAPTURED';
    /** @deprecated Historical constant for older clients; not specific to any one browser library. */
    this.legacyCode = 'PROVISION_PLAYWRIGHT_EXTRACT';
    this.provisionDetails = sanitizeProvisionDetailsForClient(details);
  }
}

function sanitizeProvisionDetailsForClient(d) {
  const out = {
    stage: d.stage,
    createClicked: d.createClicked,
    fallbacksExhausted: d.fallbacksExhausted,
    debugDir: d.debugDir,
    connectMode: d.connectMode,
  };
  if (Array.isArray(d.phasesTried)) {
    out.phasesTried = d.phasesTried.filter((x) => typeof x === 'string').slice(0, 12);
  }
  if (d.trpcLastRoute != null && String(d.trpcLastRoute).trim()) {
    out.trpcLastRoute = redactSensitiveForProvisionLog(String(d.trpcLastRoute).trim(), 160);
  }
  if (d.pageUrlAtFailure != null && String(d.pageUrlAtFailure).trim()) {
    out.pageUrlAtFailure = redactSensitiveForProvisionLog(String(d.pageUrlAtFailure).trim(), 220);
  }
  if (d.trpcLastError) {
    out.trpcLastError = redactSensitiveForProvisionLog(String(d.trpcLastError), 400);
  }
  if (d.trpcBusinessMessage) {
    out.trpcBusinessMessage = redactSensitiveForProvisionLog(String(d.trpcBusinessMessage), 400);
  }
  if (d.trpcBusinessCode != null) out.trpcBusinessCode = d.trpcBusinessCode;
  if (d.trpcLastHttp != null) out.trpcLastHttp = d.trpcLastHttp;
  if (d.trpcLastCode != null) out.trpcLastCode = d.trpcLastCode;
  return out;
}

function summarizeTrpcFailure(err) {
  if (!err) return {};
  return {
    trpcLastError: err.message,
    trpcLastCode: err.trpcCode,
    trpcLastHttp: err.httpStatus,
  };
}

/**
 * Next.js Server Action replay for management key creation.
 * Used when dashboard create hits Server Actions instead of `/api/trpc/*`.
 * Enable with HYDRA_PROVISION_SERVER_ACTION_REPLAY=1.
 *
 * The Server Action request format (captured from real dashboard):
 * - POST to /settings/management-keys
 * - Headers: Next-Action: <action-id>, content-type: text/plain;charset=UTF-8
 * - Body: JSON array with action arguments, e.g. [{"name":"key-name"}]
 * - Response: RSC payload that may contain the created key
 *
 * @param {string} sessionCookie - The __session JWT
 * @param {string} clientCookie - Clerk device cookie(s)
 * @param {string} keyName - Name for the management key
 * @returns {Promise<string|null>} - The created key or null
 */
async function tryManagementKeyServerActionReplay(sessionCookie, clientCookie, keyName) {
  console.error('[dashboard-api] Attempting Server Action replay for management key creation');

  // Get fresh JWT before making the call - OTP sessions have short-lived JWTs (60s)
  const freshJwt = await getFreshJwt(sessionCookie, clientCookie);
  const jwtToUse = freshJwt || sessionCookie;

  if (provisionStepLogEnabled()) {
    console.error(`[tryManagementKeyServerActionReplay] Using ${freshJwt ? 'fresh' : 'original'} JWT`);
  }

  // Build cookie header
  const device = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  const cookieHeader = `__session=${jwtToUse}${device ? `; ${device}` : ''}`;

  // Next.js Server Action ID for management key creation
  // This is the action ID that the dashboard sends when creating a key
  // Format: <hex-id> (e.g., 'abc123def456...')
  // Use the captured hash (confirmed from live browser traffic 2026-04-07)
  const NEXT_ACTION_ID = CREATE_MGMT_KEY_ACTION_HASH;

  const url = `${OR_BASE}/settings/management-keys`;

  // Body format confirmed from live capture: [{"name":"<key-name>"}]
  // Fallbacks included in case OpenRouter changes the argument shape.
  const actionPayloads = [
    JSON.stringify([{ name: keyName }]),           // Confirmed correct shape
    JSON.stringify([{ label: keyName }]),          // Alternative field name
    JSON.stringify([{ title: keyName }]),          // Alternative field name
    JSON.stringify([{ json: { name: keyName } }]), // tRPC-like wrapper
    JSON.stringify([]),                            // Empty body
    JSON.stringify([keyName]),                     // Direct string arg
  ];

  // Build headers for Server Action request
  const buildHeaders = (contentType = 'text/plain;charset=UTF-8') => ({
    'Content-Type': contentType,
    'Cookie': cookieHeader,
    'User-Agent': USER_AGENT,
    'Origin': OR_ORIGIN,
    'Referer': `${OR_ORIGIN}/settings/management-keys`,
    ...(NEXT_ACTION_ID ? { 'Next-Action': NEXT_ACTION_ID } : {}),
    'Accept': 'text/x-component',
  });

  // Try different content types and body formats
  const attempts = [
    { contentType: 'text/plain;charset=UTF-8', payloads: actionPayloads },
    { contentType: 'application/json', payloads: actionPayloads },
  ];

  for (const attempt of attempts) {
    const headers = buildHeaders(attempt.contentType);

    for (const body of attempt.payloads) {
      try {
        if (provisionStepLogEnabled()) {
          console.error(`[tryManagementKeyServerActionReplay] POST ${url} with content-type=${attempt.contentType}, body=${body.slice(0, 100)}`);
        }

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
        });

        const contentType = res.headers.get('content-type') || '';

        // Log response status for debugging
        if (provisionStepLogEnabled()) {
          console.error(`[tryManagementKeyServerActionReplay] Response: ${res.status} ${res.statusText}, content-type=${contentType}`);
        }

        // Check for auth failures
        if (res.status === 401 || res.status === 403) {
          console.warn(`[dashboard-api] Server Action replay: auth failed (${res.status})`);
          continue;
        }

        // Server Actions often return 200 even on errors (error encoded in RSC payload)
        // A 404 specifically means the Next-Action hash is stale — try self-healing once
        if (res.status === 404) {
          console.warn('[dashboard-api] Mgmt-key Server Action returned 404 — hash may be stale, attempting self-heal…');
          const newHash = await selfHealHash('mgmt-key', url, headers, body);
          if (newHash) {
            // Retry with the discovered hash
            const retryRes = await fetch(url, {
              method: 'POST',
              headers: { ...headers, 'Next-Action': newHash },
              body,
            });
            if (retryRes.ok || retryRes.status === 200) {
              const { text: retryText, error: retryReadErr } = await safeResponseText(retryRes, 50000);
              if (!retryReadErr) {
                const key = extractManagementKeyFromResponseBody(retryText);
                if (key) {
                  console.error('[dashboard-api] Self-healed mgmt-key Server Action — captured management key');
                  return key;
                }
              }
            }
          }
          continue;
        }
        if (!res.ok && res.status !== 200) {
          continue;
        }

        // Read response body
        const { text: responseText, error: readError } = await safeResponseText(res, 50000);

        if (readError) {
          console.warn(`[dashboard-api] Server Action replay: failed to read response: ${readError}`);
          continue;
        }

        // Use extractManagementKeyFromResponseBody which handles RSC format correctly —
        // it uses global matchAll so it skips the masked preview key (first match in the
        // existing-keys list) and finds the full key further in the payload.
        const key = extractManagementKeyFromResponseBody(responseText);

        if (key) {
          console.error(`[dashboard-api] Server Action replay: captured management key`);
          return key;
        }

        // Check if this looks like an error response
        if (responseText.includes('error') || responseText.includes('Error')) {
          if (provisionStepLogEnabled()) {
            console.error(`[tryManagementKeyServerActionReplay] Response may contain error: ${responseText.slice(0, 500)}`);
          }
        }

      } catch (err) {
        console.warn(`[dashboard-api] Server Action replay attempt failed: ${err.message}`);
        if (provisionStepLogEnabled()) {
          console.error(`[tryManagementKeyServerActionReplay] Error details:`, err);
        }
      }
    }
  }

  console.warn('[dashboard-api] Server Action replay: all attempts failed to capture key');
  return null;
}

/**
 * Extract management key from Next.js Server Action (RSC) response.
 * Server Action responses are typically in React Server Components format
 * which is a stream of chunks. The key may be JSON-encoded or plain text.
 *
 * @param {string} responseText - The response body
 * @returns {string|null} - The extracted key or null
 */

/**
 * Recursively search for management key in parsed object
 * @param {any} obj - The object to search
 * @returns {string|null} - The found key or null
 */

async function captureProvisionDebugArtifacts(page, accountId) {
  const url = page.url();
  let title = '';
  let bodyPreview = '';
  try {
    title = await page.title();
  } catch {
    void 0;
  }
  try {
    const full = await page.textContent('body');
    bodyPreview = full ? full.slice(0, 2000) : '';
  } catch {
    void 0;
  }
  console.error('[dashboard-api] provision browser-ui failure context', {
    accountId,
    url,
    title,
    bodyPreviewLength: bodyPreview.length,
  });

  if (!provisionDebugArtifactsEnabled() || !page) return;

  try {
    const dir = join(tmpdir(), 'hydra-provision-debug');
    await mkdir(dir, { recursive: true });
    const stamp = Date.now();
    const file = join(dir, `provision-fail-${accountId}-${stamp}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.error(`[dashboard-api] Provision debug screenshot: ${file}`);
  } catch (err) {
    console.error('[dashboard-api] Could not write provision debug screenshot:', err.message);
  }
}

// Per-account JWT cache — avoids re-calling Clerk /client on every bulk op.
// Key: sessionCookie (uniquely identifies the session); TTL: 30s with 10s safety margin.
const _jwtCache = new Map(); // sessionCookie → { token, expiresAt }

/**
 * Get a fresh JWT from Clerk /client endpoint.
 * OTP sessions have short-lived JWTs (60s) but the session itself is long-lived.
 * We need to get a fresh JWT from /client before making API calls.
 * @param {string} sessionCookie - Current session JWT (may be expired)
 * @param {string} clientCookie - Client cookie with __client and Cloudflare cookies
 * @returns {Promise<string|null>} Fresh JWT or null if refresh failed
 */
export async function getFreshJwt(sessionCookie, clientCookie) {
  const cached = _jwtCache.get(sessionCookie);
  if (cached && Date.now() < cached.expiresAt - 10000) {
    return cached.token;
  }
  try {
    const cookieHeader = `__session=${sessionCookie}; ${clientCookie}`;
    const clerkJsVersion = process.env.HYDRA_CLERK_JS_VERSION || '5.125.7';
    const url = `https://clerk.openrouter.ai/v1/client?_clerk_js_version=${clerkJsVersion}`;
    
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Cookie': cookieHeader,
        'Origin': 'https://openrouter.ai',
        'Referer': 'https://openrouter.ai/',
        'User-Agent': USER_AGENT,
      },
    });
    
    if (!res.ok) {
      console.error(`[getFreshJwt] /client returned ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    const session = data?.response?.sessions?.[0] || data?.client?.sessions?.[0];
    
    const jwt = session?.last_active_token?.jwt ?? session?.jwt ?? null;

    if (jwt) {
      _jwtCache.set(sessionCookie, { token: jwt, expiresAt: Date.now() + 30000 });
      return jwt;
    }

    console.error('[getFreshJwt] No JWT in /client response');
    return null;
  } catch (err) {
    console.error(`[getFreshJwt] Error: ${err.message}`);
    return null;
  }
}

function dashboardHeaders(sessionCookie, clientCookie, extra = {}) {
  const device = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  const cookieHeader = `__session=${sessionCookie}${device ? `; ${device}` : ''}`;

  // Debug logging: show which cookies are being sent (redacted for security)
  if (provisionStepLogEnabled()) {
    const cookieNames = cookieHeader.split(';').map(c => c.split('=')[0].trim()).join(', ');
    console.error(`[dashboard-api] tRPC cookies sent: ${cookieNames}`);
  }

  return {
    'Content-Type': 'application/json',
    'Cookie': cookieHeader,
    'User-Agent': USER_AGENT,
    'Origin': OR_ORIGIN,
    'Referer': `${OR_ORIGIN}/settings/management-keys`,
    'x-trpc-source': 'nextjs-react',
    ...extra,
  };
}

export async function ensureSession(userId, accountId) {
  const account = await store.getAccountWithKey(userId, accountId);
  const session = await store.getAccountSession(userId, accountId);

  // Fast path: if JWT is still valid, use it directly.
  // CF cookie checks removed — confirmed from live browser traffic that Server Action
  // POSTs work without any Cloudflare cookies (__cf_bm, _cfuvid, cf_clearance).
  if (session.sessionCookie) {
    const derivedExpiry = store.resolveEffectiveSessionExpiry(
      { sessionExpiry: session.sessionExpiry },
      session.sessionCookie,
    );

    if (isSessionValid(derivedExpiry)) {
      // JWT valid. If it's very short-lived (< 5 minutes), proactively refresh now
      // so the caller gets a token that won't expire mid-request.
      const expiryMs = new Date(derivedExpiry).getTime();
      const remainingMs = expiryMs - Date.now();
      // Exploit #14: Cookie stacking — try stacked cookies for proactive refresh
      const refreshInput14 = session.clientCookies?.length > 0 ? session.clientCookies : session.clientCookie;
      if (remainingMs < 5 * 60 * 1000 && (session.clientCookie || session.clientCookies?.length > 0)) {
        console.log(`[ensureSession] JWT expires in ${Math.round(remainingMs/1000)}s, refreshing proactively`);
        const refreshed = await refreshSession(refreshInput14, session.sessionCookie);
        if (refreshed) {
          const liveStack = Array.isArray(session.clientCookies) && session.clientCookies.length > 0
            ? (Array.isArray(refreshed.deadClientCookies) && refreshed.deadClientCookies.length > 0
              ? (() => {
                const deadSet = new Set(refreshed.deadClientCookies.map((entry) => entry.cookie));
                return session.clientCookies.filter((entry) => !deadSet.has(entry.cookie));
              })()
              : session.clientCookies)
            : [];
          await store.updateAccountSession(
            userId,
            accountId,
            refreshed.sessionCookie,
            refreshed.clientCookie ?? session.clientCookie,
            refreshed.sessionExpiry,
            { replaceClientCookies: liveStack },
          );
          return { sessionCookie: refreshed.sessionCookie, clientCookie: refreshed.clientCookie ?? session.clientCookie };
        }
      }

      if (!session.sessionExpiry && derivedExpiry) {
        await store.updateAccountSession(userId, accountId, session.sessionCookie, session.clientCookie, derivedExpiry);
      }
      return { sessionCookie: session.sessionCookie, clientCookie: session.clientCookie };
    }
  }

  // JWT expired or missing. Try refreshing via __client device cookie (12-hour lifetime).
  // This is the normal path for OTP accounts after the initial 60s JWT expires.
  // Exploit #14: Cookie stacking — try all stacked cookies newest-first
  const refreshInput14b = session.clientCookies?.length > 0 ? session.clientCookies : session.clientCookie;
  if (refreshInput14b) {
    console.log(`[ensureSession] JWT expired, refreshing via __client cookie(s)`);
    const refreshed = await refreshSession(refreshInput14b, session.sessionCookie);
    if (refreshed) {
      const cc = refreshed.clientCookie ?? session.clientCookie;
      const liveStack = Array.isArray(session.clientCookies) && session.clientCookies.length > 0
        ? (Array.isArray(refreshed.deadClientCookies) && refreshed.deadClientCookies.length > 0
          ? (() => {
            const deadSet = new Set(refreshed.deadClientCookies.map((entry) => entry.cookie));
            return session.clientCookies.filter((entry) => !deadSet.has(entry.cookie));
          })()
          : session.clientCookies)
        : [];
      await store.updateAccountSession(userId, accountId, refreshed.sessionCookie, cc, refreshed.sessionExpiry, {
        replaceClientCookies: liveStack,
      });
      return { sessionCookie: refreshed.sessionCookie, clientCookie: cc };
    }
    console.log(`[ensureSession] __client refresh failed, __client may be expired`);
  }

  // No usable __client — try password re-auth for password accounts.
  if (account.email && account.password && account.authMethod === 'password') {
    try {
      const fresh = await signInWithPassword(account.email, account.password);
      await store.updateAccountSession(userId, accountId, fresh.sessionCookie, fresh.clientCookie, fresh.sessionExpiry);
      return { sessionCookie: fresh.sessionCookie, clientCookie: fresh.clientCookie };
    } catch (err) {
      if (err instanceof NeedSecondFactorError) {
        throw new Error(
          `Account requires two-factor authentication. Open the account on the dashboard and finish sign-in (authenticator code).`
        );
      }
      throw err;
    }
  }

  // OTP accounts: session expired and no password — need re-authentication via email code.
  if (account.authMethod === 'otp' || (account.email && !account.password)) {
    const err = new Error(
      `Session expired for OTP account ${accountId}. Email verification required. Open the account on the Hydra dashboard and click "Refresh Session" to receive a new verification code.`
    );
    err.code = 'OTP_REAUTH_REQUIRED';
    err.accountId = accountId;
    err.email = account.email;
    throw err;
  }

  throw new Error(`Session expired for account ${accountId} and no credentials available for re-auth. Please log in again.`);
}

/**
 * Offline check: does this account have any path ensureSession() can use without user interaction?
 * Mirrors ensureSession order except network calls (refreshSession, validateSession).
 * 
 * IMPORTANT: Does NOT use JWT expiry alone to determine readiness. 
 * Real sessions last 12+ hours even though JWTs expire in ~2.5 minutes.
 * A session with expired JWT may still be valid and will be validated via API when needed.
 */
function evaluateRedeemSessionReadiness(account, session) {
  const sessionCookie = session.sessionCookie?.trim();
  const hasSession = Boolean(sessionCookie);
  const clientCookie = session.clientCookie?.trim();
  
  // If we have a session cookie, it might be valid (JWT expiry is NOT reliable)
  // ensureSession() will validate via API call when needed
  if (hasSession) {
    // Check stored session expiry (realistic 7-day TTL, not JWT exp)
    const derivedExpiry = store.resolveEffectiveSessionExpiry({ sessionExpiry: session.sessionExpiry }, sessionCookie);
    const jwtValid = isSessionValid(derivedExpiry);
    
    if (jwtValid) {
      return { ready: true, detail: 'session_valid' };
    }
    
    // JWT appears expired but session might still be valid (12+ hour real sessions)
    // Return as 'session_validate' - ensureSession will verify via API
    return { ready: true, detail: 'session_validate' };
  }
  
  // No session cookie but have client cookie - can try to refresh
  if (clientCookie) {
    return { ready: true, detail: 'client_refresh' };
  }
  
  // No session but have credentials - can re-authenticate
  if (account.email && account.password && account.authMethod === 'password') {
    return { ready: true, detail: 'password_reauth' };
  }
  
  return {
    ready: false,
    detail: 'blocked',
    message:
      'No dashboard session and no stored password. Log in to OpenRouter via Hydra for this account, or add email/password auth. Management keys alone cannot redeem codes.',
  };
}

export async function preflightRedeemAccounts(userId, accountIds) {
  const ready = [];
  const blocked = [];
  for (const id of accountIds) {
    try {
      const account = await store.getAccountWithKey(userId, id);
      const session = await store.getAccountSession(userId, id);
      const ev = evaluateRedeemSessionReadiness(account, session);
      if (ev.ready) {
        ready.push({ accountId: id, alias: account.alias, detail: ev.detail });
      } else {
        blocked.push({ accountId: id, alias: account.alias, message: ev.message });
      }
    } catch (err) {
      blocked.push({ accountId: id, alias: undefined, message: err.message });
    }
  }
  return { ready, blocked, allReady: blocked.length === 0 };
}

/**
 * Detect if a content-type indicates HTML response.
 * Handles variations: text/html, application/xhtml+xml, and case-insensitive matching.
 * @param {string} contentType - The Content-Type header value
 * @returns {boolean} true if content-type indicates HTML
 */
function isHtmlContentType(contentType) {
  if (!contentType || typeof contentType !== 'string') return false;
  const normalized = contentType.toLowerCase().trim();
  // Check for HTML variations
  if (normalized.includes('text/html')) return true;
  if (normalized.includes('application/xhtml')) return true;
  if (normalized.includes('application/xhtml+xml')) return true;
  // Check for common HTML indicators in malformed responses
  if (normalized.startsWith('text/') && normalized.includes('html')) return true;
  return false;
}

/**
 * Check if stored clientCookie contains Cloudflare cookies.
 * Accounts created BEFORE the Cloudflare cookie fix lack these cookies.
 * @param {string} clientCookie - The stored client cookie string
 * @returns {boolean} true if Cloudflare cookies are present
 */
function hasCloudflareCookies(clientCookie) {
  if (!clientCookie || typeof clientCookie !== 'string') return false;
  const lower = clientCookie.toLowerCase();
  // Check for key Cloudflare cookies
  return lower.includes('__cf_bm=') || lower.includes('_cfuvid=') || lower.includes('cf_clearance=');
}

/**
 * Migration tracking: per-process memory-only flag to avoid repeated migration attempts.
 * Maps accountId -> boolean (true if migration already attempted this process).
 */
const migrationAttempted = new Set();

/**
 * Migrate an account to capture Cloudflare cookies.
 * Called when tRPC returns HTML and the account lacks CF cookies.
 * Forces a re-login to capture fresh cookies including Cloudflare ones.
 *
 * @param {string} userId
 * @param {string} accountId
 * @param {string} sessionCookie - Current session cookie
 * @param {string} clientCookie - Current client cookie
 * @returns {{ sessionCookie, clientCookie, migrated: boolean, message? }}
 */
async function migrateAccountForCloudflareCookies(userId, accountId, sessionCookie, clientCookie) {
  // Prevent repeated migration attempts in the same process
  if (migrationAttempted.has(accountId)) {
    return { sessionCookie, clientCookie, migrated: false, message: 'Migration already attempted in this process' };
  }

  // Check if already has CF cookies - no migration needed
  if (hasCloudflareCookies(clientCookie)) {
    return { sessionCookie, clientCookie, migrated: false };
  }

  migrationAttempted.add(accountId);

  console.error(`[dashboard-api] Cloudflare cookie migration triggered for account ${accountId}`);

  // Get account credentials
  const account = await store.getAccountWithKey(userId, accountId);

  // Only password accounts can auto-migrate without user interaction
  if (!account.email || !account.password || account.authMethod !== 'password') {
    console.error(`[dashboard-api] Cannot auto-migrate account ${accountId}: no password credentials available`);
    return {
      sessionCookie,
      clientCookie,
      migrated: false,
      message: 'Account requires manual re-login to capture Cloudflare cookies (no stored password)',
    };
  }

  try {
    console.error(`[dashboard-api] Re-authenticating account ${accountId} to capture Cloudflare cookies...`);

    // Force re-login - this will capture fresh cookies including Cloudflare ones
    const fresh = await signInWithPassword(account.email, account.password);

    // Validate that we now have Cloudflare cookies
    if (!hasCloudflareCookies(fresh.clientCookie)) {
      console.warn(`[dashboard-api] Re-login completed but Cloudflare cookies still not present for ${accountId}`);
      // Still use the fresh session - it might work even without explicit CF cookies
    } else {
      console.error(`[dashboard-api] Successfully captured Cloudflare cookies for account ${accountId}`);
    }

    // Update stored session with fresh cookies
    await store.updateAccountSession(
      userId,
      accountId,
      fresh.sessionCookie,
      fresh.clientCookie,
      fresh.sessionExpiry,
    );

    return {
      sessionCookie: fresh.sessionCookie,
      clientCookie: fresh.clientCookie,
      migrated: true,
    };
  } catch (err) {
    console.error(`[dashboard-api] Migration failed for account ${accountId}: ${err.message}`);

    if (err instanceof NeedSecondFactorError) {
      return {
        sessionCookie,
        clientCookie,
        migrated: false,
        message: 'Account requires two-factor authentication for migration. Please complete 2FA setup.',
      };
    }

    return {
      sessionCookie,
      clientCookie,
      migrated: false,
      message: `Migration failed: ${err.message}`,
    };
  }
}

/**
 * Safely extract response text with size limits and error handling.
 * Prevents memory issues with large responses and handles stream errors.
 * @param {Response} res - Fetch Response object
 * @param {number} maxLength - Maximum characters to read (default: 50000)
 * @returns {Promise<{text: string, truncated: boolean, error: string|null}>}
 */
async function safeResponseText(res, maxLength = 50000) {
  try {
    // Check content-length header first if available
    const contentLength = res.headers.get('content-length');
    if (contentLength) {
      const length = parseInt(contentLength, 10);
      if (!isNaN(length) && length > maxLength * 2) {
        // Response is too large, likely not JSON - return early
        return {
          text: '',
          truncated: true,
          error: `Response too large (${length} bytes), exceeds safe limit`,
        };
      }
    }

    const text = await res.text();
    if (text.length > maxLength) {
      return {
        text: text.slice(0, maxLength),
        truncated: true,
        error: null,
      };
    }
    return { text, truncated: false, error: null };
  } catch (err) {
    return {
      text: '',
      truncated: false,
      error: `Failed to read response body: ${err.message}`,
    };
  }
}

/**
 * Sanitize HTML for error messages - removes scripts, limits length, preserves structure.
 * @param {string} html - Raw HTML string
 * @param {number} maxLength - Maximum length for preview
 * @returns {string} Sanitized HTML preview
 */
function sanitizeHtmlPreview(html, maxLength = 2000) {
  if (!html || typeof html !== 'string') return '(empty response)';
  // Remove script tags and their contents
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '[SCRIPT-REMOVED]');
  // Remove style tags and their contents
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '[STYLE-REMOVED]');
  // Remove event handlers
  sanitized = sanitized.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
  sanitized = sanitized.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength) + '...[truncated]';
  }
  // Normalize whitespace
  return sanitized.replace(/\s+/g, ' ').trim();
}

/**
 * Safely parse JSON with detailed error context.
 * @param {string} text - JSON string to parse
 * @param {object} context - Context for error messages
 * @returns {object} Parsed data
 * @throws {Error} With detailed context if parsing fails
 */
function safeJsonParse(text, context = {}) {
  if (!text || typeof text !== 'string') {
    const err = new Error(`Empty or non-string response body${context.route ? ` for ${context.route}` : ''}`);
    err.isParseError = true;
    err.context = context;
    throw err;
  }

  // Check for obvious HTML patterns before parsing
  const trimmed = text.trim();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<!doctype')) {
    const err = new Error(context.route
      ? `tRPC route ${context.route} returned HTML (DOCTYPE detected) — likely auth failed or Cloudflare challenge`
      : 'Response is HTML (DOCTYPE detected), not JSON');
    err.isHtml = true;
    err.isParseError = true;
    err.httpStatus = context.status;
    err.status = context.status;
    err.responsePreview = sanitizeHtmlPreview(text, 1000);
    throw err;
  }
  if (trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
    const err = new Error(context.route
      ? `tRPC route ${context.route} returned HTML (<html> tag detected) — likely auth failed or Cloudflare challenge`
      : 'Response is HTML (<html> tag detected), not JSON');
    err.isHtml = true;
    err.isParseError = true;
    err.httpStatus = context.status;
    err.status = context.status;
    err.responsePreview = sanitizeHtmlPreview(text, 1000);
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch (parseErr) {
    // Provide context about what we tried to parse
    const preview = text.length > 200 ? `${text.slice(0, 200)}...[length:${text.length}]` : text;
    const err = new Error(context.route
      ? `tRPC route ${context.route} returned invalid JSON: ${parseErr.message}. Preview: ${preview}`
      : `Invalid JSON response: ${parseErr.message}. Preview: ${preview}`);
    err.isParseError = true;
    err.originalError = parseErr;
    err.httpStatus = context.status;
    err.status = context.status;
    err.responsePreview = preview;
    throw err;
  }
}

/**
 * Extract key info from an HTML error response for debugging.
 * Looks for common patterns like Cloudflare challenge, error pages, etc.
 * @param {string} html - HTML response body
 * @returns {object} Extracted info
 */
function extractHtmlErrorInfo(html) {
  const info = {
    looksLikeCloudflare: false,
    looksLikeLoginPage: false,
    looksLikeErrorPage: false,
    title: null,
    hints: [],
  };

  if (!html || typeof html !== 'string') return info;

  const lower = html.toLowerCase();

  // Cloudflare indicators
  if (lower.includes('cf-browser-verification') || lower.includes('cf-challenge')) {
    info.looksLikeCloudflare = true;
    info.hints.push('Cloudflare challenge page detected');
  }
  if (lower.includes('__cf_bm') || lower.includes('cf_clearance')) {
    info.looksLikeCloudflare = true;
    info.hints.push('Cloudflare cookie references found');
  }
  if (lower.includes('checking your browser') || lower.includes('just a moment')) {
    info.looksLikeCloudflare = true;
    info.hints.push('Cloudflare browser check page');
  }

  // Login/auth indicators
  if (lower.includes('sign in') || lower.includes('login') || lower.includes('log in')) {
    info.looksLikeLoginPage = true;
    info.hints.push('Login page detected');
  }
  if (lower.includes('auth') || lower.includes('clerk') || lower.includes('session')) {
    info.looksLikeLoginPage = true;
    info.hints.push('Auth-related content detected');
  }

  // Generic error indicators
  if (lower.includes('error') || lower.includes('forbidden') || lower.includes('unauthorized')) {
    info.looksLikeErrorPage = true;
  }

  // Try to extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    info.title = titleMatch[1].trim();
  }

  return info;
}

/** Headers merged after defaults; use to override Referer per surface (e.g. redeem vs management keys). */
export async function trpcCall(route, input, sessionCookie, clientCookie, headerOverrides = {}) {
  // Get fresh JWT before making tRPC call - OTP sessions have 60s JWTs
  const freshJwt = await getFreshJwt(sessionCookie, clientCookie);
  const jwtToUse = freshJwt || sessionCookie; // Fallback to original if refresh failed
  
  if (provisionStepLogEnabled()) {
    console.error(`[trpcCall] Using ${freshJwt ? 'fresh' : 'original'} JWT for route ${route}`);
  }
  
  const url = `${OR_BASE}/api/trpc/${route}?batch=1`;
  const body = JSON.stringify({ '0': { json: input } });

  const res = await fetch(url, {
    method: 'POST',
    headers: dashboardHeaders(jwtToUse, clientCookie, headerOverrides),
    body,
  });

  const contentType = res.headers.get('content-type') || '';

  // Hardened: Use robust HTML content-type detection
  if (isHtmlContentType(contentType)) {
    // Read the response body for debugging (even though it's HTML)
    const { text: htmlBody, truncated, error: readError } = await safeResponseText(res, 25000);
    const htmlInfo = extractHtmlErrorInfo(htmlBody);

    let message = `tRPC route ${route} returned HTML (content-type: ${contentType}) — likely wrong format or auth failed`;

    // Enhance error message with detected patterns
    if (htmlInfo.looksLikeCloudflare) {
      message += '. Cloudflare challenge detected - may need Cloudflare cookies (__cf_bm, cf_clearance)';
    }
    if (htmlInfo.looksLikeLoginPage) {
      message += '. Login page detected - session may be invalid';
    }
    if (htmlInfo.title) {
      message += `. Page title: "${htmlInfo.title}"`;
    }

    const err = new Error(message);
    err.isHtml = true;
    err.httpStatus = res.status;
    err.status = res.status;
    err.contentType = contentType;
    err.responsePreview = sanitizeHtmlPreview(htmlBody, 1500);
    err.truncated = truncated;
    err.readError = readError;
    err.htmlInfo = htmlInfo;

    // Log detailed info for debugging (but only in debug mode to avoid log spam)
    if (provisionStepLogEnabled()) {
      console.error(`[dashboard-api] trpcCall HTML response details:`, {
        route,
        status: res.status,
        contentType,
        title: htmlInfo.title,
        truncated,
        readError,
        hints: htmlInfo.hints,
        preview: err.responsePreview.slice(0, 500),
      });
    }

    throw err;
  }

  // Hardened: Safely extract response text first, then parse JSON
  const { text: responseText, truncated, error: readError } = await safeResponseText(res, 50000);

  if (readError) {
    const err = new Error(`tRPC route ${route} failed to read response: ${readError}`);
    err.httpStatus = res.status;
    err.status = res.status;
    err.readError = readError;
    throw err;
  }

  if (truncated) {
    console.warn(`[dashboard-api] tRPC route ${route} response was truncated (exceeded size limit)`);
  }

  // Hardened: Use safe JSON parsing with context
  const data = safeJsonParse(responseText, { route, status: res.status });

  const toTrpcError = (errorPayload) => {
    const inner = errorPayload?.json ?? errorPayload;
    const msg =
      (typeof inner?.message === 'string' && inner.message) ||
      (typeof errorPayload?.message === 'string' && errorPayload.message) ||
      (typeof errorPayload === 'string' ? errorPayload : JSON.stringify(errorPayload ?? {}));
    const err = new Error(msg);
    // tRPC / JSON-RPC: -32601 = method not found (Hydra tries next redeem candidate)
    err.trpcCode =
      inner?.code ?? errorPayload?.json?.code ?? errorPayload?.data?.code ?? errorPayload?.code;
    err.httpStatus = res.status;
    return err;
  };

  if (Array.isArray(data)) {
    if (data.length === 0) {
      const err = new Error(`tRPC route ${route} returned an empty batch response`);
      err.httpStatus = res.status;
      throw err;
    }

    const firstErrorItem = data.find((item) => item?.error);
    if (firstErrorItem?.error) {
      throw toTrpcError(firstErrorItem.error);
    }

    const firstResultItem = data.find((item) => item?.result);
    if (!firstResultItem) {
      const err = new Error(`tRPC route ${route} returned malformed batch data`);
      err.httpStatus = res.status;
      throw err;
    }
    return firstResultItem.result?.data?.json ?? firstResultItem.result?.data ?? firstResultItem;
  }

  if (data?.error) {
    throw toTrpcError(data.error);
  }

  if (data?.result) {
    return data.result?.data?.json ?? data.result?.data ?? data.result;
  }

  return data;
}

/**
 * Wrapper around trpcCall that handles Cloudflare cookie migration.
 * When tRPC returns HTML (indicating auth/Cloudflare issues) and the account lacks CF cookies,
 * attempts to migrate the account by re-authenticating to capture fresh cookies.
 *
 * @param {string} route - tRPC route
 * @param {object} input - Request body
 * @param {string} sessionCookie - Current session cookie
 * @param {string} clientCookie - Current client cookie
 * @param {object} headerOverrides - Header overrides
 * @param {object} context - Context with userId and accountId for migration
 * @returns {Promise<any>} - tRPC result
 */
async function trpcCallWithMigration(route, input, sessionCookie, clientCookie, headerOverrides = {}, context = {}) {
  try {
    return await trpcCall(route, input, sessionCookie, clientCookie, headerOverrides);
  } catch (err) {
    // Check if this is an HTML error that might be due to missing Cloudflare cookies
    if (err.isHtml && !hasCloudflareCookies(clientCookie)) {
      const { userId, accountId } = context;
      if (userId && accountId) {
        console.error(`[dashboard-api] HTML response without CF cookies - attempting migration for ${accountId}`);
        const migration = await migrateAccountForCloudflareCookies(userId, accountId, sessionCookie, clientCookie);

        if (migration.migrated) {
          console.error(`[dashboard-api] Migration succeeded, retrying tRPC with fresh cookies`);
          // Retry with fresh cookies from migration
          return await trpcCall(route, input, migration.sessionCookie, migration.clientCookie, headerOverrides);
        } else {
          console.error(`[dashboard-api] Migration not possible: ${migration.message || 'unknown reason'}`);
        }
      }
    }
    // Re-throw original error if migration didn't help or wasn't possible
    throw err;
  }
}

/** Stop redeem / other flows when the session or account is clearly blocked (no point retrying). */
function isPermanentError(err) {
  if (err.trpcCode !== undefined && err.trpcCode !== -32601) return true;
  if (err.isHtml && (err.status === 401 || err.status === 403)) return true;
  if ([401, 403, 423, 429].includes(err.httpStatus)) return true;
  return false;
}

/** Stable Hydra codes on redeem `data` and bulk-matrix rows (`errorCode`). */
export const REDEEM_ERROR_CODES = Object.freeze({
  PROMO_INVALID: 'REDEEM_PROMO_INVALID',
  SESSION: 'REDEEM_SESSION',
  RATE_LIMIT: 'REDEEM_RATE_LIMIT',
  FORM_UNAVAILABLE: 'REDEEM_FORM_UNAVAILABLE',
  OUTCOME_UNKNOWN: 'REDEEM_OUTCOME_UNKNOWN',
  UPSTREAM: 'REDEEM_UPSTREAM',
});

function normalizeTrpcCode(c) {
  if (c === undefined || c === null) return undefined;
  if (typeof c === 'number' || typeof c === 'string') return typeof c === 'string' ? c.toUpperCase() : c;
  return String(c);
}

function messageLooksLikeInvalidPromo(msg) {
  if (!msg || typeof msg !== 'string') return false;
  const m = msg.toLowerCase();
  if (
    /\b(invalid|expired|not valid|already used|already redeemed|unknown code|code not found|no longer valid|unable to redeem|could not redeem)\b/.test(m)
  ) {
    if (/\b(code|promo|voucher|credit|coupon)\b/.test(m) || /\bredeem/.test(m)) return true;
  }
  if (/\bthis code\b/.test(m) && /\b(invalid|expired|used)\b/.test(m)) return true;
  return false;
}

/**
 * Map OpenRouter tRPC / HTTP / Playwright text into a stable Hydra `errorCode` for APIs and UI.
 * Exported for bulk-matrix catch rows when `redeemCode` throws before returning.
 */
export function classifyRedeemFailure(rawMessage, err = {}) {
  const msg = String(rawMessage || err.message || 'Redemption failed');
  const http = err.httpStatus ?? err.status;
  const tc = normalizeTrpcCode(err.trpcCode);

  if (http === 429) return { errorCode: REDEEM_ERROR_CODES.RATE_LIMIT, message: msg };
  if (http === 401 || http === 403) return { errorCode: REDEEM_ERROR_CODES.SESSION, message: msg };
  if (err.isHtml && (err.status === 401 || err.status === 403)) {
    return { errorCode: REDEEM_ERROR_CODES.SESSION, message: msg };
  }

  // Hardened: Handle HTML responses from tRPC/body parsing
  if (tc === 'HTML_RESPONSE' || err.isHtml) {
    // HTML response indicates session/auth issue or Cloudflare challenge
    if (http === 401 || http === 403 || http === 200) {
      return {
        errorCode: REDEEM_ERROR_CODES.SESSION,
        message: msg || 'Received HTML response instead of JSON - authentication or Cloudflare challenge issue',
      };
    }
    return { errorCode: REDEEM_ERROR_CODES.UPSTREAM, message: msg };
  }

  // Hardened: Handle JSON parse errors
  if (tc === 'JSON_PARSE_ERROR' || err.isParseError) {
    return {
      errorCode: REDEEM_ERROR_CODES.UPSTREAM,
      message: msg || 'Invalid JSON response from server',
    };
  }

  if (
    /\bsession\b/i.test(msg) &&
    /\b(expired|log in|login|credentials|re-auth|reauth|unauthorized|forbidden)\b/i.test(msg)
  ) {
    return { errorCode: REDEEM_ERROR_CODES.SESSION, message: msg };
  }
  if (/\btwo-factor\b/i.test(msg) || /\b2fa\b/i.test(msg)) {
    return { errorCode: REDEEM_ERROR_CODES.SESSION, message: msg };
  }

  if (messageLooksLikeInvalidPromo(msg)) {
    return { errorCode: REDEEM_ERROR_CODES.PROMO_INVALID, message: msg };
  }

  if (tc === 'BAD_REQUEST' || tc === -32602 || http === 400) {
    return { errorCode: REDEEM_ERROR_CODES.PROMO_INVALID, message: msg };
  }

  if (msg.includes('Could not find redeem form')) {
    return { errorCode: REDEEM_ERROR_CODES.FORM_UNAVAILABLE, message: msg };
  }
  if (msg.includes('outcome unclear')) {
    return { errorCode: REDEEM_ERROR_CODES.OUTCOME_UNKNOWN, message: msg };
  }

  return { errorCode: REDEEM_ERROR_CODES.UPSTREAM, message: msg };
}

function redeemFailurePayload(source, err) {
  const { errorCode, message } = classifyRedeemFailure(err.message, err);
  const row = { success: false, message, source, errorCode };
  if (err.trpcCode !== undefined) row.trpcCode = err.trpcCode;
  return row;
}

/**
 * For management-key provisioning only: abort when auth/session is dead.
 * Other tRPC errors (wrong procedure, shape drift, business validation) still allow
 * trying more candidates and server Playwright — a valid session may succeed in the browser.
 */
function shouldAbortProvisioning(err) {
  // Hardened: Handle HTML responses (likely auth/Cloudflare issues)
  if (err.isHtml && (err.status === 401 || err.status === 403)) return true;
  // Hardened: Handle HTML responses even with 200 status (Cloudflare challenges often return 200)
  if (err.isHtml && err.httpStatus === 200) {
    // Check if it looks like a Cloudflare challenge
    if (err.htmlInfo?.looksLikeCloudflare) return true;
    // DON'T abort on login page - might be wrong endpoint, try others
    // if (err.htmlInfo?.looksLikeLoginPage) return true;
  }
  // Hardened: Handle trpcCodes that indicate permanent failures
  if (err.trpcCode === 'HTML_RESPONSE' || err.trpcCode === 'OVERSIZED_RESPONSE') {
    // Don't abort - try other routes or fallbacks
    return false;
  }
  if ([401, 403, 423, 429].includes(err.httpStatus)) return true;
  return false;
}

/**
 * Try to create management key via REST API using session JWT as Bearer token.
 * Fallback when tRPC fails with HTML responses.
 * @param {string} sessionCookie - Session JWT
 * @param {string} clientCookie - Client cookies
 * @param {string} keyName - Name for the new key
 * @returns {Promise<{key?: string, error?: string}>}
 */
async function tryRestApiCreateKey(sessionCookie, clientCookie, keyName) {
  try {
    // Get fresh JWT first
    const freshJwt = await getFreshJwt(sessionCookie, clientCookie);
    const jwtToUse = freshJwt || sessionCookie;
    
    // Try various REST endpoints that might work
    const endpoints = [
      { url: `${OR_BASE}/api/v1/management-keys`, method: 'POST', body: { name: keyName } },
      { url: `${OR_BASE}/api/v1/keys`, method: 'POST', body: { name: keyName, type: 'management' } },
      { url: `${OR_BASE}/api/management/keys`, method: 'POST', body: { name: keyName } },
      { url: `${OR_BASE}/api/keys/management`, method: 'POST', body: { name: keyName } },
    ];
    
    for (const endpoint of endpoints) {
      try {
        console.error(`[tryRestApiCreateKey] Trying ${endpoint.method} ${endpoint.url}`);
        
        const res = await fetch(endpoint.url, {
          method: endpoint.method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwtToUse}`,
            'Cookie': clientCookie,
            'Origin': OR_ORIGIN,
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify(endpoint.body),
        });
        
        if (!res.ok) {
          console.error(`[tryRestApiCreateKey] ${endpoint.url} returned ${res.status}`);
          continue;
        }
        
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          console.error(`[tryRestApiCreateKey] ${endpoint.url} returned non-JSON: ${contentType}`);
          continue;
        }
        
        const data = await res.json();
        
        // Look for key in response
        const key =
          data?.key ??
          data?.managementKey ??
          data?.apiKey ??
          data?.secret ??
          data?.token ??
          data?.data?.key ??
          data?.data?.managementKey;
        
        if (key && key.startsWith('sk-or-v1-')) {
          console.error(`[tryRestApiCreateKey] Success with ${endpoint.url}`);
          return { key };
        }
      } catch (err) {
        console.error(`[tryRestApiCreateKey] ${endpoint.url} error: ${err.message}`);
      }
    }
    
    // ── Expanded REST probe endpoints (EXPLOIT #12) ──
    // Also try /api/v1/keys with minimal body and additional path variants.
    const expandedEndpoints = [
      { url: `${OR_BASE}/api/v1/keys`, method: 'POST', body: { name: keyName } },
      { url: `${OR_BASE}/api/v1/keys`, method: 'POST', body: { name: keyName, type: 'management' } },
      { url: `${OR_BASE}/api/v1/keys/create`, method: 'POST', body: { name: keyName } },
      { url: `${OR_BASE}/api/v1/account/keys`, method: 'POST', body: { name: keyName, type: 'management' } },
      { url: `${OR_BASE}/api/v1/user/keys`, method: 'POST', body: { name: keyName } },
      { url: `${OR_BASE}/api/v1/settings/keys`, method: 'POST', body: { name: keyName } },
    ];

    for (const endpoint of expandedEndpoints) {
      try {
        console.error(`[tryRestApiCreateKey] Trying expanded ${endpoint.method} ${endpoint.url}`);
        const res = await fetch(endpoint.url, {
          method: endpoint.method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwtToUse}`,
            'Cookie': clientCookie,
            'Origin': OR_ORIGIN,
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify(endpoint.body),
        });

        // Log EVERY response status — even 404s tell us what doesn't exist
        console.error(`[tryRestApiCreateKey] ${endpoint.url} → HTTP ${res.status} ${res.statusText}`);

        if (!res.ok) continue;

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          console.error(`[tryRestApiCreateKey] ${endpoint.url} returned non-JSON: ${contentType}`);
          continue;
        }

        const data = await res.json();
        const key =
          data?.key ??
          data?.managementKey ??
          data?.apiKey ??
          data?.secret ??
          data?.token ??
          data?.data?.key ??
          data?.data?.managementKey;

        if (key && key.startsWith('sk-or-v1-')) {
          console.error(`[tryRestApiCreateKey] Success with expanded ${endpoint.url}`);
          return { key };
        }
      } catch (err) {
        console.error(`[tryRestApiCreateKey] ${endpoint.url} error: ${err.message}`);
      }
    }

    return { error: 'All REST endpoints failed' };
  } catch (err) {
    console.error(`[tryRestApiCreateKey] Fatal error: ${err.message}`);
    return { error: err.message };
  }
}

/**
 * Try to redeem a code via REST API using session JWT as Bearer token.
 * Fallback when Server Action and tRPC both fail.
 * EXPLOIT #12: REST fallback probes for credit redemption.
 * @param {string} sessionCookie - Session JWT
 * @param {string} clientCookie - Client cookies
 * @param {string} code - Redemption code to apply
 * @returns {Promise<{success: boolean, result?: any, error?: string, source: string, probedEndpoints: Array}>}
 */
async function tryRestApiRedeemCode(sessionCookie, clientCookie, code) {
  const probedEndpoints = [];

  try {
    const freshJwt = await getFreshJwt(sessionCookie, clientCookie);
    const jwtToUse = freshJwt || sessionCookie;

    const endpoints = [
      // Primary: /api/v1/credits/redeem — most RESTful pattern
      { url: `${OR_BASE}/api/v1/credits/redeem`, method: 'POST', body: { code } },
      { url: `${OR_BASE}/api/v1/credits/redeem`, method: 'POST', body: { promoCode: code } },
      { url: `${OR_BASE}/api/v1/credits/redeem`, method: 'POST', body: { code, type: 'promo' } },
      // Alternate credit paths
      { url: `${OR_BASE}/api/v1/credits/apply`, method: 'POST', body: { code } },
      { url: `${OR_BASE}/api/v1/credits/promo`, method: 'POST', body: { code } },
      // Voucher/coupon endpoints
      { url: `${OR_BASE}/api/v1/voucher/redeem`, method: 'POST', body: { code } },
      { url: `${OR_BASE}/api/v1/coupon/redeem`, method: 'POST', body: { code } },
      { url: `${OR_BASE}/api/v1/promo/redeem`, method: 'POST', body: { code } },
      { url: `${OR_BASE}/api/v1/promo/apply`, method: 'POST', body: { code } },
      // Code-based endpoints
      { url: `${OR_BASE}/api/v1/code/redeem`, method: 'POST', body: { code } },
      { url: `${OR_BASE}/api/v1/code/apply`, method: 'POST', body: { code } },
      // Account-scoped
      { url: `${OR_BASE}/api/v1/account/redeem`, method: 'POST', body: { code } },
      { url: `${OR_BASE}/api/v1/account/credits/redeem`, method: 'POST', body: { code } },
      // User-scoped
      { url: `${OR_BASE}/api/v1/user/redeem`, method: 'POST', body: { code } },
      { url: `${OR_BASE}/api/v1/user/credits/redeem`, method: 'POST', body: { code } },
      // Non-v1 variants
      { url: `${OR_BASE}/api/credits/redeem`, method: 'POST', body: { code } },
      { url: `${OR_BASE}/api/redeem`, method: 'POST', body: { code } },
    ];

    for (const endpoint of endpoints) {
      try {
        console.error(`[tryRestApiRedeemCode] Trying ${endpoint.method} ${endpoint.url} body=${JSON.stringify(endpoint.body)}`);

        const res = await fetch(endpoint.url, {
          method: endpoint.method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwtToUse}`,
            'Cookie': clientCookie,
            'Origin': OR_ORIGIN,
            'Referer': `${OR_ORIGIN}/redeem`,
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify(endpoint.body),
        });

        const probeResult = {
          url: endpoint.url,
          method: endpoint.method,
          status: res.status,
          statusText: res.statusText,
          contentType: res.headers.get('content-type') || '',
        };

        // Try to read body for more detail, even on error
        let bodyText = '';
        try {
          bodyText = await res.text();
          probeResult.bodyPreview = bodyText.slice(0, 500);
        } catch {
          probeResult.bodyPreview = '(unreadable)';
        }

        probedEndpoints.push(probeResult);

        // Log EVERY response — 404s tell us what doesn't exist
        console.error(`[tryRestApiRedeemCode] ${endpoint.url} → HTTP ${res.status} ${res.statusText} body=${probeResult.bodyPreview.slice(0, 200)}`);

        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          let data;
          if (contentType.includes('application/json')) {
            try { data = JSON.parse(bodyText); } catch { data = null; }
          }

          // Check for success indicators
          const success =
            data?.success === true ||
            data?.redeemed === true ||
            data?.applied === true ||
            data?.credits !== undefined ||
            data?.balance !== undefined ||
            (typeof data?.message === 'string' && /success|redeemed|applied|credit/i.test(data.message));

          if (success || res.status === 200 || res.status === 201) {
            console.error(`[tryRestApiRedeemCode] Redemption may have succeeded at ${endpoint.url}`);
            return {
              success: true,
              result: data || { raw: bodyText.slice(0, 500) },
              source: 'rest-api',
              probedEndpoints,
              probedUrl: endpoint.url,
            };
          }
        }
      } catch (err) {
        const probeResult = {
          url: endpoint.url,
          method: endpoint.method,
          status: 0,
          error: err.message,
        };
        probedEndpoints.push(probeResult);
        console.error(`[tryRestApiRedeemCode] ${endpoint.url} error: ${err.message}`);
      }
    }

    // All endpoints probed, none succeeded — return full log
    console.error(`[tryRestApiRedeemCode] All REST redemption endpoints failed (${probedEndpoints.length} probed)`);
    return { success: false, error: 'All REST redemption endpoints failed', source: 'rest-api', probedEndpoints };
  } catch (err) {
    console.error(`[tryRestApiRedeemCode] Fatal error: ${err.message}`);
    return { success: false, error: err.message, source: 'rest-api', probedEndpoints };
  }
}

export async function createManagementKey(userId, accountId, keyName = 'Hydra Auto Key') {
  const { sessionCookie, clientCookie } = await ensureSession(userId, accountId);
  logProvisionOpenRouterBase(accountId, sessionCookie);

  // Try direct HTTP Server Action first — this is the confirmed correct approach.
  // OpenRouter uses Next.js Server Actions (not tRPC) for management key creation.
  // The Next-Action hash and body format were captured from live browser traffic.
  const fromSa = await tryManagementKeyServerActionReplay(sessionCookie, clientCookie, keyName);
  if (fromSa) {
    await persistProvisionedManagementKey(userId, accountId, fromSa, 'server-action');
    return { key: fromSa, source: 'server-action' };
  }

  console.error('[dashboard-api] Server Action failed, falling back to tRPC discovery and Playwright');
  const endpoints = await store.getDiscoveredEndpoints();
  const endpoint = endpoints.createManagementKey;

  const mgmtKeyPayloads = [
    { name: keyName },
    { label: keyName },
    { title: keyName },
    { keyName },
  ];

  // Context for Cloudflare cookie migration
  const migrationContext = { userId, accountId };

  let lastTrpcRouteAttempted = null;
  if (endpoint) {
    lastTrpcRouteAttempted = endpoint.route;
    for (const input of mgmtKeyPayloads) {
      try {
        const result = await trpcCallWithMigration(endpoint.route, input, sessionCookie, clientCookie, {}, migrationContext);
        const picked =
          result?.key ??
          result?.managementKey ??
          result?.apiKey ??
          result?.secret ??
          result?.token ??
          result?.management_key ??
          result?.api_key;
        if (picked) {
          const key = picked;
          if (!key.startsWith('sk-or-v1-')) {
            throw new Error('tRPC returned a non-management key for management key creation.');
          }
          await persistProvisionedManagementKey(userId, accountId, key, 'trpc-cached');
          return { key, source: 'trpc-cached' };
        }
      } catch (err) {
        if (shouldAbortProvisioning(err)) {
          return { success: false, message: err.message, source: 'trpc-cached' };
        }
        console.warn(`[dashboard-api] Cached tRPC failed: ${err.message}, trying discovery`);
      }
    }
  }

  const candidates = [
    'managementKeys.create',
    'managementKey.create',
    'keys.createManagement',
    'managementKeys.createKey',
    'managementKeys.createManagementKey',
    'management.createManagementKey',
    'management.createKey',
    'apiKeys.createManagement',
    'apiKeys.createManagementKey',
    'settings.managementKeys.create',
    'dashboard.managementKeys.create',
    'management.managementKeys.create',
  ];
  let lastTrpcError = null;
  for (const route of candidates) {
    lastTrpcRouteAttempted = route;
    for (const input of mgmtKeyPayloads) {
      try {
        console.error(`[dashboard-api] Trying tRPC route: ${route} with payload: ${JSON.stringify(input)}`);
        const result = await trpcCallWithMigration(route, input, sessionCookie, clientCookie, {}, migrationContext);
        console.error(`[dashboard-api] tRPC route ${route} result:`, { hasResult: !!result, keys: Object.keys(result || {}) });
        const key =
          result?.key ??
          result?.managementKey ??
          result?.apiKey ??
          result?.secret ??
          result?.token ??
          result?.management_key ??
          result?.api_key;
        if (key && key.startsWith('sk-or-v1-')) {
          console.error(`[dashboard-api] Success via tRPC route: ${route}`);
          await store.saveDiscoveredEndpoints({ createManagementKey: { route, discoveredAt: new Date().toISOString() } });
          await persistProvisionedManagementKey(userId, accountId, key, `trpc-${route}`);
          return { key, source: `trpc-${route}` };
        }
        // No key returned - route exists but wrong payload or unexpected response shape
        console.error(`[dashboard-api] tRPC route ${route} returned result but no management key`);
      } catch (err) {
        lastTrpcError = err;
        console.error(`[dashboard-api] tRPC route ${route} failed: ${err.message} (httpStatus: ${err.httpStatus}, trpcCode: ${err.trpcCode})`);
        if (shouldAbortProvisioning(err)) {
          return { success: false, message: err.message, source: `trpc-${route}` };
        }
        // Try next payload / candidate
      }
    }
  }

  console.error(
    `[dashboard-api] All tRPC routes exhausted, trying REST API fallback. Last error: ${lastTrpcError?.message || 'none'}`,
  );

  // Try REST API with session JWT as Bearer token
  const restResult = await tryRestApiCreateKey(sessionCookie, clientCookie, keyName);
  if (restResult?.key) {
    console.error(`[dashboard-api] Success via REST API`);
    await persistProvisionedManagementKey(userId, accountId, restResult.key, 'rest-api');
    return { key: restResult.key, source: 'rest-api' };
  }

  console.error(
    `[dashboard-api] REST API failed, falling back to browser UI automation (Chromium).`,
  );

  return await createManagementKeyViaPlaywright(userId, accountId, sessionCookie, clientCookie, keyName, {
    ...summarizeTrpcFailure(lastTrpcError),
    trpcLastRoute: lastTrpcRouteAttempted,
  });
}

/** H2: Replay vault session + Clerk device cookies on openrouter.ai. Third-party cookies (e.g. CF) are not in the vault — if tRPC returns 403, re-login in Hydra to refresh. */
async function playwrightCookiesForOpenRouter(sessionCookie, clientCookie) {
  // Get fresh JWT before setting cookies - OTP sessions have short-lived JWTs (60s)
  const freshJwt = await getFreshJwt(sessionCookie, clientCookie);
  const jwtToUse = freshJwt || sessionCookie;
  
  if (freshJwt && provisionStepLogEnabled()) {
    console.error(`[playwrightCookiesForOpenRouter] Using fresh JWT for session`);
  }
  
  const base = openRouterPlaywrightDeviceCookies(clientCookie).map((c) => ({
    ...c,
    domain: OR_HOSTNAME,
  }));
  return [{ name: '__session', value: jwtToUse, domain: OR_HOSTNAME, path: '/' }, ...base];
}

/**
 * Cookie banners / Headless UI overlays sit in #headlessui-portal-root and intercept clicks on the
 * main "Create" button (capture + provision both hit this in headless).
 */
async function dismissOpenRouterBlockingOverlays(page, accountId) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(180);
  }
  const dismissButtons = [
    page.getByRole('button', { name: /accept all cookies/i }),
    page.getByRole('button', { name: /accept all/i }),
    page.getByRole('button', { name: /^accept$/i }),
    page.getByRole('button', { name: /i agree/i }),
    page.getByRole('button', { name: /^got it$/i }),
    page.getByRole('button', { name: /^ok$/i }),
    page.getByRole('button', { name: /^close$/i }),
    page.getByRole('button', { name: /no thanks/i }),
    page.locator('#headlessui-portal-root button').filter({ hasText: /accept|agree|got it|close|ok/i }).first(),
  ];
  for (const loc of dismissButtons) {
    try {
      if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
        await loc.click({ timeout: 2000 }).catch(() => {});
        provisionStepLog(accountId, 'dismissOpenRouterBlockingOverlays: clicked dismiss-like control');
        await page.waitForTimeout(350);
      }
    } catch {
      void 0;
    }
  }
}

async function clickFirstVisibleCreateControl(page) {
  /** Prefer Create inside main content so we do not hit unrelated Create buttons elsewhere. */
  const main = page.locator('main, [role="main"]').first();
  if (await main.isVisible({ timeout: 800 }).catch(() => false)) {
    const mainCreate = main.getByRole('button', { name: /^create$/i });
    if (await mainCreate.first().isVisible({ timeout: 800 }).catch(() => false)) {
      await mainCreate.first().click();
      return true;
    }
  }
  /** OpenRouter settings (2026-04): toolbar primary action is an exact "Create" button. */
  const roleCandidates = [
    /^create$/i,
    /create management key/i,
    /add key/i,
    /new key/i,
    /create key/i,
    /^new$/i,
    /^generate$/i,
  ];
  for (const name of roleCandidates) {
    const btn = page.getByRole('button', { name });
    if (await btn.first().isVisible({ timeout: 800 }).catch(() => false)) {
      await btn.first().click();
      return true;
    }
  }
  const locators = [
    page.locator('button:has-text("Create")'),
    page.locator('button:has-text("New")'),
    page.locator('button:has-text("Generate")'),
    page.locator('button:has-text("Add")'),
    page.locator('a:has-text("Create")'),
  ];
  for (const loc of locators) {
    if (await loc.first().isVisible({ timeout: 800 }).catch(() => false)) {
      await loc.first().click();
      return true;
    }
  }
  return false;
}

function managementDialog(page) {
  // Broader modal detection for various UI frameworks (HeadlessUI, Radix, Ariakit, custom)
  return page.locator([
    '#headlessui-portal-root [role="dialog"]',
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[data-state="open"]',
    'dialog[open]',
    'div[class*="modal"]',
    'div[class*="dialog"]',
    'div[class*="overlay"]'
  ].join(', ')).first();
}

function trpcPathLooksLikeManagementKeyCreate(pathSegment) {
  if (!pathSegment) return false;
  const p = decodeURIComponent(pathSegment.split('?')[0] || '').toLowerCase();
  if (p.includes('management') && p.includes('create')) return true;
  if (p.includes('createmanagement') || p.includes('managementkey')) return true;
  return /managementkeys?\.|mgmt.*\.create|\.createkey/.test(p);
}

/**
 * Aggressively scan the current page state for a management key right after the create form
 * is submitted. The one-time reveal modal is visible for only a few seconds — this runs
 * immediately so we catch it before it closes or the network wait times out.
 */
async function captureKeyFromPageImmediate(page, accountId) {
  const isValidKey = (k) => k && !k.includes('...') && k.length >= 40;

  // 1. DOM evaluate: check ALL input values and visible text nodes (most reliable)
  const fromEval = await page.evaluate((pattern) => {
    /* eslint-disable no-undef */
    const re = new RegExp(pattern, 'g');
    const candidates = new Set();

    // Inputs / textareas (value property, not just attribute)
    for (const el of document.querySelectorAll('input, textarea')) {
      for (const v of [el.value, el.getAttribute('value')]) {
        if (v) for (const m of String(v).matchAll(re)) candidates.add(m[0]);
      }
    }
    // Any element that might visually show the key (code, pre, span, p, div)
    for (const el of document.querySelectorAll('code, pre, [data-key], [data-value], [role="dialog"] *, [role="alertdialog"] *')) {
      const t = el.textContent || '';
      if (t.length < 200) { // only check short elements to avoid huge bodies
        for (const m of t.matchAll(re)) candidates.add(m[0]);
      }
    }
    // Body text — broader sweep
    const bodyText = document.body?.innerText || '';
    for (const m of bodyText.matchAll(re)) candidates.add(m[0]);

    return [...candidates];
  }, 'sk-or-v1-[A-Za-z0-9_.\\-]+').catch(() => []);

  for (const k of fromEval) {
    if (isValidKey(k)) {
      provisionStepLog(accountId, `captureKeyFromPageImmediate: found via DOM eval (len=${k.length})`);
      return k;
    }
  }

  // 2. Clipboard read (may work in non-headless or when permission granted)
  const fromClip = await page.evaluate(async (pattern) => {
    try {
      const text = await navigator.clipboard.readText();
      const re = new RegExp(pattern, 'g');
      const all = [...text.matchAll(re)].map(m => m[0]);
      return all.find(k => !k.includes('...') && k.length >= 40) || null;
    } catch { return null; }
  }, 'sk-or-v1-[A-Za-z0-9_.\\-]+').catch(() => null);
  if (fromClip && isValidKey(fromClip)) {
    provisionStepLog(accountId, `captureKeyFromPageImmediate: found in clipboard (len=${fromClip.length})`);
    return fromClip;
  }

  // 3. Try clicking any Copy button that appeared (key then goes to clipboard)
  const copyBtn = page.locator('button:has-text("Copy"), button[aria-label*="copy" i], [data-testid*="copy" i]').first();
  if (await copyBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await copyBtn.click().catch(() => {});
    await page.waitForTimeout(400);
    // Re-check clipboard after click
    const afterClick = await page.evaluate(async (pattern) => {
      try {
        const text = await navigator.clipboard.readText();
        const re = new RegExp(pattern, 'g');
        const all = [...text.matchAll(re)].map(m => m[0]);
        return all.find(k => !k.includes('...') && k.length >= 40) || null;
      } catch { return null; }
    }, 'sk-or-v1-[A-Za-z0-9_.\\-]+').catch(() => null);
    if (afterClick && isValidKey(afterClick)) {
      provisionStepLog(accountId, `captureKeyFromPageImmediate: found in clipboard after Copy click`);
      return afterClick;
    }
    // Re-scan DOM after click (key might now be revealed)
    const afterDom = await page.evaluate((pattern) => {
      /* eslint-disable no-undef */
      const re = new RegExp(pattern, 'g');
      const t = document.body?.innerText || '';
      const all = [...t.matchAll(re)].map(m => m[0]);
      return all.find(k => !k.includes('...') && k.length >= 40) || null;
    }, 'sk-or-v1-[A-Za-z0-9_.\\-]+').catch(() => null);
    if (afterDom && isValidKey(afterDom)) {
      provisionStepLog(accountId, `captureKeyFromPageImmediate: found in DOM after Copy click`);
      return afterDom;
    }
  }

  return null;
}

/**
 * OpenRouter often shows the raw key only after "Copy" (clipboard) or in a follow-up panel.
 * Granting clipboard-read in context + clicking copy-like controls fixes many headless failures.
 */
async function tryCopyRevealManagementKeyUi(page, accountId) {
  // Try multiple times to get the full key via clipboard or reveal
  const maxAttempts = 3;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Try copy buttons first
    const copyLocators = [
      page.getByRole('button', { name: /^copy$/i }),
      page.getByRole('button', { name: /copy key/i }),
      page.getByRole('button', { name: /copy to clipboard/i }),
      page.getByRole('menuitem', { name: /copy/i }),
      page.locator('button[aria-label*="copy" i]').first(),
      page.locator('[data-testid*="copy" i]').first(),
      page.locator('button:has-text("Copy")').first(),
    ];
    
    for (const loc of copyLocators) {
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
        await loc.click().catch(() => {});
        provisionStepLog(accountId, `Clicked copy button (attempt ${attempt})`);
        await page.waitForTimeout(600);
        
        // Try clipboard read
        const fromClip = await page
          .evaluate(async (pattern) => {
            try {
              const text = await navigator.clipboard.readText();
              const re = new RegExp(pattern);
              const m = text.match(re);
              return m ? m[0] : null;
            } catch {
              return null;
            }
          }, MGMT_KEY_RE.source)
          .catch(() => null);
          
        if (fromClip && !fromClip.includes('...') && fromClip.length >= 40) {
          provisionStepLog(accountId, `Got full key from clipboard (attempt ${attempt})`);
          return fromClip;
        }
      }
    }
    
    // Try reveal buttons
    const revealLocators = [
      page.getByRole('button', { name: /reveal|show key|show full/i }),
      page.locator('button:has-text("Reveal")').first(),
      page.locator('button:has-text("Show")').first(),
      page.locator('[data-testid*="reveal" i]').first(),
    ];
    
    for (const loc of revealLocators) {
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
        await loc.click().catch(() => {});
        provisionStepLog(accountId, `Clicked reveal button (attempt ${attempt})`);
        await page.waitForTimeout(600);
        
        // After reveal, try to extract from page text (should now be full key)
        const pageText = await page.textContent('body').catch(() => '');
        const match = pageText?.normalize('NFC').match(MGMT_KEY_RE);
        if (match) {
          const potentialKey = match[0];
          if (!potentialKey.includes('...') && potentialKey.length >= 40) {
            provisionStepLog(accountId, `Got full key after reveal (attempt ${attempt})`);
            return potentialKey;
          }
        }
      }
    }
    
    // Wait before next attempt
    if (attempt < maxAttempts) {
      await page.waitForTimeout(1000);
    }
  }
  
  return null;
}

async function fillManagementKeyNameAndSubmit(page, keyName, accountId) {
  const dialog = managementDialog(page);
  const inDialog = await dialog.isVisible({ timeout: 2500 }).catch(() => false);
  const scope = inDialog ? dialog : page;

  // Try role-based first (aria-label or accessible name matching "name"), then broader selectors
  const nameByRole = scope.getByRole('textbox', { name: /^name$/i });
  const nameByRoleAlt = scope.getByRole('textbox', { name: /name/i });
  const nameByPlaceholder = scope.locator(
    'input[placeholder*="Management Key" i], input[placeholder*="name" i], input[placeholder*="Name"], input[name="name"], input[aria-label*="name" i]',
  );
  // Fallback: inputs inside scope. Do NOT nest [role="dialog"] when scope is already the dialog —
  // a single modal has no descendant [role=dialog], so the old selector matched nothing.
  const nameByFallback = scope
    .locator('input[type="text"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')
    .first();

  let nameInput;
  if (await nameByRole.isVisible({ timeout: 1500 }).catch(() => false)) {
    nameInput = nameByRole;
  } else if (await nameByRoleAlt.isVisible({ timeout: 1500 }).catch(() => false)) {
    nameInput = nameByRoleAlt;
  } else if (await nameByPlaceholder.first().isVisible({ timeout: 1500 }).catch(() => false)) {
    nameInput = nameByPlaceholder.first();
  } else {
    nameInput = nameByFallback;
  }
  const nameVisible = await nameInput.isVisible({ timeout: 4000 }).catch(() => false);
  if (!nameVisible) {
    // Log what inputs are actually visible in the dialog so we can debug
    provisionStepLog(accountId, 'fillName: Name field not visible — logging all visible inputs in dialog');
    const allInputs = await dialog.locator('input, [contenteditable="true"], [contenteditable]').all();
    for (const inp of allInputs) {
      const visible = await inp.isVisible().catch(() => false);
      const tag = await inp.evaluate((el) => el.tagName + (el.id ? `#${el.id}` : '') + (el.className ? `.${el.className.split(' ').join('.')}` : '')).catch(() => '?');
      const role = await inp.getAttribute('role').catch(() => null);
      const type = await inp.getAttribute('type').catch(() => null);
      const placeholder = await inp.getAttribute('placeholder').catch(() => null);
      provisionStepLog(accountId, `  input: ${tag} role=${role} type=${type} placeholder=${placeholder} visible=${visible}`);
    }
    throw new Error(
      'Management key form: Name field not visible after opening the create flow (check OpenRouter UI / selectors).',
    );
  }
  provisionStepLog(accountId, `Found name input (trying to fill: "${keyName}")`);
  await nameInput.click();
  // Triple-clear to handle pre-filled values and contenteditable inputs
  await nameInput.clear();
  await nameInput.fill('');
  await page.waitForTimeout(100);
  // Type character-by-character via keyboard events — most compatible with React controlled inputs
  await nameInput.pressSequentially(keyName, { delay: 40 });
  // Brief pause so React can process the keystrokes
  await page.waitForTimeout(300);

  // Try role-based Save first, then broader submit/fallback
  const saveBtn = scope.getByRole('button', { name: /^save$/i });
  if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    try {
      await saveBtn.click();
    } catch {
      await saveBtn.click({ force: true });
    }
    return;
  }
  const submit = scope.locator(
    'button[type="submit"], button:has-text("Save"), button:has-text("Confirm"), button:has-text("Generate"), button:has-text("Create")',
  );
  const altVisible = await submit.first().isVisible({ timeout: 2000 }).catch(() => false);
  if (!altVisible) {
    throw new Error(
      'Management key form: Save (or fallback submit) button not visible — cannot complete provisioning.',
    );
  }
  try {
    await submit.first().click();
  } catch {
    await submit.first().click({ force: true });
  }
}

/** H1: Reduce headless automation signals; optional system Chrome via HYDRA_PLAYWRIGHT_CHANNEL. */
function playwrightProvisionLaunchOptions() {
  const headless = !config.HYDRA_PLAYWRIGHT_HEADED;
  /** @type {import('playwright').LaunchOptions} */
  const opts = { headless };
  if (config.HYDRA_PLAYWRIGHT_CHANNEL) {
    opts.channel = config.HYDRA_PLAYWRIGHT_CHANNEL;
  }
  if (headless) {
    opts.args = ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'];
  }
  return opts;
}

async function createManagementKeyViaPlaywright(userId, accountId, sessionCookie, clientCookie, keyName, trpcPhaseSummary = {}) {
  const { chromium } = await import('playwright');
  const cdpUrl = config.HYDRA_PLAYWRIGHT_CDP_ENDPOINT?.trim();
  let connectMode = 'launch';
  const browser = cdpUrl
    ? await (async () => {
        provisionStepLog(accountId, 'browser connectOverCDP', { endpoint: cdpUrl });
        connectMode = 'cdp';
        return chromium.connectOverCDP(cdpUrl);
      })()
    : await chromium.launch(playwrightProvisionLaunchOptions());
  let page;
  let context;
  let capturedKey = null;
  const networkLogLines = [];
  let traceStarted = false;

  try {
    context = await browser.newContext({ userAgent: USER_AGENT });
    await context.addCookies(await playwrightCookiesForOpenRouter(sessionCookie, clientCookie));
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: OR_ORIGIN });
    } catch {
      void 0;
    }
    if (provisionDebugArtifactsEnabled()) {
      await context.tracing.start({ screenshots: true, snapshots: true });
      traceStarted = true;
    }
    page = await context.newPage();

    if (provisionNetworkLogEnabled()) {
      page.on('response', async (response) => {
        try {
          const req = response.request();
          if (req.method() !== 'POST') return;
          const u = response.url();
          if (!u.startsWith(OR_ORIGIN)) return;
          const postData = truncateForLog(req.postData() || '', 2000);
          let line = `${new Date().toISOString()} POST ${response.status()} ${u}\npostData: ${postData || '(empty)'}`;
          if (u.includes('/api/trpc/')) {
            line += `\npathname: ${new URL(u).pathname}`;
          }
          // Note: We intentionally do NOT log response body here.
          // Response bodies are now cached via getCachedResponseText() to prevent race conditions
          // where multiple handlers consume the same stream. The waitForResponse predicates
          // need the body to extract the management key. Debug body content is captured via tracing instead.
          line += '\n---';
          networkLogLines.push(line);
        } catch {
          void 0;
        }
      });
    }

    await page.goto(`${OR_BASE}/settings/management-keys`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
    {
      let title = '';
      try {
        title = await page.title();
      } catch {
        void 0;
      }
      provisionStepLog(accountId, 'after goto management-keys', { url: page.url(), title });
    }

    // ── Google OAuth Edge Case: Check for factor-one page ──
    const currentUrl = page.url();
    if (currentUrl.includes('/sign-in/factor-one')) {
      provisionStepLog(accountId, 'Detected /sign-in/factor-one page (Google OAuth account needs OTP)');
      
      // Try to click "Use another method" to get to OTP input
      const useAnotherMethodBtn = page.locator('button:has-text("Use another method"), a:has-text("Use another method")').first();
      if (await useAnotherMethodBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await useAnotherMethodBtn.click();
        provisionStepLog(accountId, 'Clicked "Use another method" - waiting for OTP screen');
        await page.waitForTimeout(2000);
        
        // Wait for OTP input to appear
        const otpInput = page.locator('input[autocomplete="one-time-code"], input.cl-otpCodeFieldInput, input[data-testid*="otp"], input[maxlength="1"]').first();
        if (await otpInput.isVisible({ timeout: 10000 }).catch(() => false)) {
          throw new Error(
            'GOOGLE_OAUTH_REQUIRES_OTP: This Google OAuth account requires OTP verification. ' +
            'Please use the "Login Account" flow with OTP code to authenticate first, then retry provisioning.'
          );
        }
      }
      
      // If we couldn't navigate to OTP, throw clear error
      throw new Error(
        'GOOGLE_OAUTH_REQUIRES_OTP: This account uses Google OAuth and requires OTP verification. ' +
        'Please use the "Login Account" flow with the 6-digit OTP code from your email to authenticate first, ' +
        'then retry management key provisioning.'
      );
    }

    await dismissOpenRouterBlockingOverlays(page, accountId);

    /** Set after a matching response is parsed — persist outside the predicate to avoid store I/O in the waiter. */
    let capturedFromWait = null;
    let discoveredRouteFromWait = null;
    /** H10: Last tRPC error from a create-mutation response (no key in body) — surfaced on final failure. */
    let lastProvisionTrpcBusinessError = null;

    /** Register before Create/fill so POSTs from open flow + Save are not missed. */
    const provisionKeyWait = page
      .waitForResponse(
        async (response) => {
          const url = response.url();
          if (!url.startsWith(OR_ORIGIN) || response.request().method() !== 'POST') return false;
          if (/\.(png|jpe?g|gif|webp|svg|woff2?|ico|css|js)(\?|$)/i.test(url)) return false;
          const isTrpc = url.includes('/api/trpc/');
          const rawPath = isTrpc
            ? new URL(url).pathname.split('/api/trpc/')[1]?.split('?')[0] ?? ''
            : '';
          const pathname = new URL(url).pathname;
          try {
            const body = await getCachedResponseText(response);
            const key = extractManagementKeyFromResponseBody(body);
            if (!key) {
              const parsed = parseTrpcRedeemHttpBody(body, response.status());
              if (
                parsed.kind === 'error' &&
                (isTrpc ? trpcPathLooksLikeManagementKeyCreate(rawPath) : /settings|management|key/i.test(pathname))
              ) {
                lastProvisionTrpcBusinessError = parsed.err;
                provisionStepLog(accountId, 'tRPC error in provision-related POST (no key in body)', {
                  message: parsed.err.message,
                  trpcCode: parsed.err.trpcCode,
                  path: rawPath || pathname,
                });
              }
            }
            if (provisionDebugArtifactsEnabled()) {
              if (isTrpc) {
                if (!key && trpcPathLooksLikeManagementKeyCreate(rawPath)) {
                  console.error('[dashboard-api] provision tRPC mutation without extractable key', {
                    accountId,
                    status: response.status(),
                    path: rawPath,
                    preview: redactSensitiveForProvisionLog(body, 450),
                  });
                } else if (key) {
                  console.error('[dashboard-api] provision tRPC response contains management key', {
                    accountId,
                    status: response.status(),
                    path: rawPath,
                  });
                }
              } else {
                const looksRelevant = /settings|management|key|action|next/i.test(pathname);
                if (!key && looksRelevant) {
                  console.error('[dashboard-api] provision non-tRPC POST without extractable key', {
                    accountId,
                    status: response.status(),
                    path: pathname,
                    preview: redactSensitiveForProvisionLog(body, 450),
                  });
                } else if (key) {
                  console.error('[dashboard-api] provision non-tRPC response contains management key', {
                    accountId,
                    path: pathname,
                  });
                }
              }
            }
            if (!key) return false;
            capturedFromWait = key;
            if (isTrpc) {
              discoveredRouteFromWait = normalizeDiscoveredCreateRoute(rawPath);
            }
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 50000 },
      )
      .catch(() => null);

    const clicked = await clickFirstVisibleCreateControl(page);
    if (!clicked) {
      console.warn('[dashboard-api] No create/add control matched on management-keys; continuing');
    }
    provisionStepLog(accountId, 'after create/add control click attempt', { clicked });
    await page.waitForTimeout(1200);

    await fillManagementKeyNameAndSubmit(page, keyName, accountId);
    provisionStepLog(accountId, 'after fill name and submit');

    // Poll for the key reveal modal (up to 10 seconds). The modal appears after the
    // RSC round-trip completes (1-3 seconds). A fixed 800ms wait is too short.
    provisionStepLog(accountId, 'Polling for key reveal modal (up to 10s)...');
    let immediateUiKey = null;
    for (let i = 0; i < 20 && !immediateUiKey; i++) {
      await page.waitForTimeout(500);
      immediateUiKey = await captureKeyFromPageImmediate(page, accountId);
    }
    if (immediateUiKey) {
      capturedKey = immediateUiKey;
      provisionStepLog(accountId, 'Got key from polled UI capture');
    }

    // Now check if the network response captured it (may already be resolved)
    if (!capturedKey) {
      // Give the network response a short window — the RSC payload may also carry the key
      const networkWait = Promise.race([
        provisionKeyWait,
        new Promise(r => setTimeout(r, 8000)), // 8s cap — don't block on 50s timeout
      ]);
      await networkWait;
      if (capturedFromWait) {
        capturedKey = capturedFromWait;
        provisionStepLog(accountId, 'Got key from network response');
      }
    }

    if (!capturedKey) {
      provisionStepLog(accountId, 'No key from immediate UI or network response, trying copy/reveal UI...');
      const fromCopyUi = await tryCopyRevealManagementKeyUi(page, accountId);
      if (fromCopyUi) {
        capturedKey = fromCopyUi;
        provisionStepLog(accountId, 'Found key after copy/reveal UI step');
      } else {
        provisionStepLog(accountId, 'Copy/reveal UI did not return key');
      }
    }
    if (discoveredRouteFromWait) {
      await store.saveDiscoveredEndpoints({
        createManagementKey: { route: discoveredRouteFromWait, discoveredAt: new Date().toISOString() },
      });
    }

    if (provisionNetworkLogEnabled()) {
      await writeProvisionNetworkLog(accountId, networkLogLines);
    }

    // Fallback 1: wait for the key to appear as visible text anywhere on the page
    if (!capturedKey) {
      await page.getByText(MGMT_KEY_RE).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }
    if (!capturedKey) {
      const lateCopy = await tryCopyRevealManagementKeyUi(page, accountId);
      if (lateCopy) {
        capturedKey = lateCopy;
        provisionStepLog(accountId, 'Found key on delayed copy/reveal pass');
      }
    }

    // Fallback 2: Modal/Dialog that shows newly created key (OpenRouter shows full key once in modal)
    if (!capturedKey) {
      provisionStepLog(accountId, 'Looking for key in modal/dialog...');
      await page.waitForTimeout(1000); // Wait for modal to appear
      
      // Try to find key in common modal patterns
      const modalSelectors = [
        '[role="dialog"]',
        '[role="alertdialog"]',
        '.modal',
        '.dialog',
        '[data-testid*="modal"]',
        '[data-testid*="dialog"]',
        'div[class*="modal"]',
        'div[class*="dialog"]',
      ];
      
      for (const selector of modalSelectors) {
        const modal = page.locator(selector).first();
        if (await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
          provisionStepLog(accountId, `Found modal with selector: ${selector}`);
          const modalText = await modal.textContent().catch(() => '');
          const m = modalText?.normalize('NFC').match(MGMT_KEY_RE);
          if (m) {
            const potentialKey = m[0];
            if (!potentialKey.includes('...') && potentialKey.length >= 40) {
              capturedKey = potentialKey;
              provisionStepLog(accountId, 'Found full key in modal');
              break;
            }
          }
        }
      }
    }
    
    // Fallback 3: <code>/<pre> (common for API keys)
    if (!capturedKey) {
      const codeOrPre = page.locator('code, pre').filter({ hasText: MGMT_KEY_RE }).first();
      if (await codeOrPre.isVisible({ timeout: 3000 }).catch(() => false)) {
        const blockText = await codeOrPre.innerText().catch(() => '');
        const m = blockText?.normalize('NFC').match(MGMT_KEY_RE);
        if (m) {
          capturedKey = m[0];
          provisionStepLog(accountId, 'Found key in code/pre element');
        }
      }
    }

    // Fallback 3: scan page textContent (catches text nodes, but NOT input .value)
    // WARNING: UI may show masked preview like "sk-or-v1-xxx...yyy" - we need the FULL key
    if (!capturedKey) {
      const pageText = await page.textContent('body');
      const match = pageText?.normalize('NFC').match(MGMT_KEY_RE);
      if (match) {
        const potentialKey = match[0];
        // Reject if it looks like a masked preview (contains ... in the middle)
        if (potentialKey.includes('...') || potentialKey.length < 30) {
          console.error(`[dashboard-api] Rejecting masked/preview key from page text: ${potentialKey.slice(0, 20)}... (length: ${potentialKey.length})`);
        } else {
          capturedKey = potentialKey;
          provisionStepLog(accountId, 'Found key in page textContent');
        }
      }
    }

    // Fallback 4: scan ALL input/textarea .value properties via evaluate()
    // page.textContent() does NOT include <input value="..."> — this is the critical gap.
    if (!capturedKey) {
      capturedKey = await page.evaluate((keyPattern) => {
        /* eslint-disable no-undef -- Playwright page.evaluate runs in browser context */
        const re = new RegExp(keyPattern);
        const selectors = [
          'input[readonly]',
          'input[type="text"]',
          'input[type="password"]',
          'input',
          'textarea',
          '[data-key]',
          '[data-value]',
          '[contenteditable]',
        ];
        for (const sel of selectors) {
          for (const el of document.querySelectorAll(sel)) {
            const candidates = [
              el.value,
              el.getAttribute('value'),
              el.getAttribute('data-key'),
              el.getAttribute('data-value'),
              el.textContent,
              el.innerText,
            ];
            for (const c of candidates) {
              if (c) {
                const m = String(c).match(re);
                if (m) return m[0];
              }
            }
          }
        }
        return null;
      }, MGMT_KEY_RE.source).catch(() => null);
      if (capturedKey) provisionStepLog(accountId, 'Found key via DOM evaluate() input scan');
    }

    // Fallback 5: look specifically in the dialog/modal that appeared after form submit
    if (!capturedKey) {
      const dialog = managementDialog(page);
      if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
        const dialogText = await dialog.innerText().catch(() => '');
        const match = dialogText?.normalize('NFC').match(MGMT_KEY_RE);
        if (match) {
          capturedKey = match[0];
          provisionStepLog(accountId, 'Found key in dialog innerText');
        }
      }
    }

    // Fallback 6: try clipboard API (some UIs auto-copy the key on creation)
    // Note: This rarely works in headless mode due to clipboard permissions, but try anyway.
    if (!capturedKey) {
      const mgmtKeyPattern = MGMT_KEY_RE.source;
      capturedKey = await page.evaluate(async (pattern) => {
        try {
          const text = await navigator.clipboard.readText();
          const re = new RegExp(pattern);
          const m = text.normalize('NFC').match(re);
          return m ? m[0] : null;
        } catch { return null; }
      }, mgmtKeyPattern).catch(() => null);
      if (capturedKey) provisionStepLog(accountId, 'Found key in clipboard');
    }

    // Fallback 6b: H5 — key only in an iframe (rare)
    if (!capturedKey) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          const ft = await frame.evaluate(() => document.body?.innerText || '').catch(() => '');
          const m = ft.normalize('NFC').match(MGMT_KEY_RE);
          if (m) {
            capturedKey = m[0];
            provisionStepLog(accountId, 'Found key in child frame innerText');
            break;
          }
        } catch {
          void 0;
        }
      }
    }

    // Fallback 7: if still no key, log ALL visible input values and dialog text for post-mortem
    if (!capturedKey) {
      if (provisionDebugArtifactsEnabled()) {
        const allInputValues = await page.evaluate(() => {
          /* eslint-disable no-undef -- Playwright page.evaluate runs in browser context */
          const result = [];
          for (const el of document.querySelectorAll('input, textarea')) {
            result.push({
              tag: el.tagName,
              type: el.type,
              name: el.name,
              placeholder: el.placeholder,
              readOnly: el.readOnly,
              value: el.value ? `${el.value.slice(0, 80)}…` : '(empty)',
            });
          }
          return result;
        }).catch(() => []);
        console.error('[dashboard-api] provision: key not found — all input values in DOM', { accountId, inputs: allInputValues });
        const fullPageInner = await page
          .evaluate(() => {
            /* eslint-disable no-undef -- Playwright page.evaluate runs in browser context */
            return document.body?.innerText?.slice(0, 3000) || '';
          })
          .catch(() => '');
        console.error('[dashboard-api] provision: page innerText preview', { accountId, preview: redactSensitiveForProvisionLog(fullPageInner, 2000) });
      }
      const extra =
        lastProvisionTrpcBusinessError?.message != null
          ? ` Last dashboard POST error (during UI flow): ${lastProvisionTrpcBusinessError.message}${
              lastProvisionTrpcBusinessError.trpcCode != null
                ? ` (code: ${String(lastProvisionTrpcBusinessError.trpcCode)})`
                : ''
            }.`
          : '';
      const phasesTried = ['trpc_http'];
      if (config.HYDRA_PROVISION_SERVER_ACTION_REPLAY) phasesTried.push('server_action_replay_attempted');
      phasesTried.push('browser_ui');
      let pageUrlAtFailure = '';
      try {
        pageUrlAtFailure = page.url() || '';
      } catch {
        void 0;
      }
      const debugDir = join(tmpdir(), PROVISION_DEBUG_DIR_BASENAME);
      throw new ProvisionKeyNotCapturedError(
        `Could not capture management key after HTTP (tRPC) and browser UI automation.${extra}`,
        {
          stage: 'browser_ui',
          phasesTried,
          trpcLastError: trpcPhaseSummary.trpcLastError,
          trpcLastCode: trpcPhaseSummary.trpcLastCode,
          trpcLastHttp: trpcPhaseSummary.trpcLastHttp,
          trpcLastRoute: trpcPhaseSummary.trpcLastRoute,
          trpcBusinessMessage: lastProvisionTrpcBusinessError?.message,
          trpcBusinessCode: lastProvisionTrpcBusinessError?.trpcCode,
          createClicked: clicked,
          fallbacksExhausted:
            'waitForResponse, copy/reveal UI, getByText, code/pre, body text, input evaluate, dialog, clipboard, iframes',
          debugDir,
          connectMode,
          pageUrlAtFailure,
        },
      );
    }

    if (traceStarted && context) {
      await context.tracing.stop().catch(() => {});
      traceStarted = false;
    }

    await persistProvisionedManagementKey(userId, accountId, capturedKey, 'playwright');
    return { key: capturedKey, source: 'playwright' };
  } catch (err) {
    if (traceStarted && context) {
      try {
        const dir = join(tmpdir(), 'hydra-provision-debug');
        await mkdir(dir, { recursive: true });
        const zip = join(dir, `provision-trace-${accountId}-${Date.now()}.zip`);
        await context.tracing.stop({ path: zip });
        console.error('[dashboard-api] Provision browser-ui trace saved', { accountId, path: zip });
      } catch (te) {
        console.error('[dashboard-api] Could not save provision trace:', te.message);
      }
      traceStarted = false;
    }
    const extractFail =
      err instanceof ProvisionKeyNotCapturedError ||
      (err &&
        typeof err.message === 'string' &&
        (/Could not capture management key after HTTP/i.test(err.message) ||
          err.message.includes('Could not extract management key via Playwright')));
    if (extractFail && page) {
      await captureProvisionDebugArtifacts(page, accountId).catch(() => {});
    }
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

const REDEEM_TRPC_HEADERS = { Referer: `${OR_ORIGIN}/redeem` };

const UI_FEEDBACK_MAX = 500;

/**
 * Parse tRPC batch or single JSON from a browser HTTP response (same rules as trpcCall).
 * Hardened: Detects HTML responses and provides detailed error context.
 */
function parseTrpcRedeemHttpBody(bodyText, httpStatus = 200) {
  if (!bodyText || typeof bodyText !== 'string') return { kind: 'unparseable' };

  // Hardened: Check for HTML patterns before attempting JSON parse
  const trimmed = bodyText.trim();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<!doctype') ||
      trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
    const htmlInfo = extractHtmlErrorInfo(bodyText);
    const err = {
      message: `Response is HTML, not JSON (status: ${httpStatus})${htmlInfo.title ? ` - Title: "${htmlInfo.title}"` : ''}`,
      trpcCode: 'HTML_RESPONSE',
      httpStatus,
      isHtml: true,
      htmlInfo,
    };
    // Add diagnostic hints
    if (htmlInfo.looksLikeCloudflare) {
      err.message += '. Cloudflare challenge detected - may need Cloudflare cookies';
    } else if (htmlInfo.looksLikeLoginPage) {
      err.message += '. Login page detected - session may be invalid';
    }
    return { kind: 'error', err };
  }

  // Hardened: Safe JSON parse with size check
  if (bodyText.length > 100000) {
    // Response too large, likely not valid tRPC JSON
    return {
      kind: 'error',
      err: {
        message: `Response body too large (${bodyText.length} chars), exceeds safe parsing limit`,
        trpcCode: 'OVERSIZED_RESPONSE',
        httpStatus,
      },
    };
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (parseErr) {
    // Hardened: Provide preview of what failed to parse
    const preview = bodyText.length > 150 ? `${bodyText.slice(0, 150)}...[length:${bodyText.length}]` : bodyText;
    return {
      kind: 'error',
      err: {
        message: `Invalid JSON: ${parseErr.message}. Preview: ${preview}`,
        trpcCode: 'JSON_PARSE_ERROR',
        httpStatus,
        isParseError: true,
      },
    };
  }

  const toErr = (errorPayload) => {
    const inner = errorPayload?.json ?? errorPayload;
    const msg =
      (typeof inner?.message === 'string' && inner.message) ||
      (typeof errorPayload?.message === 'string' && errorPayload.message) ||
      (typeof errorPayload === 'string' ? errorPayload : JSON.stringify(errorPayload ?? {}));
    return {
      message: msg,
      trpcCode: inner?.code ?? errorPayload?.json?.code ?? errorPayload?.data?.code ?? errorPayload?.code,
      httpStatus,
    };
  };
  if (Array.isArray(data)) {
    const errItem = data.find((item) => item?.error);
    if (errItem?.error) return { kind: 'error', err: toErr(errItem.error) };
    const resItem = data.find((item) => item?.result);
    if (!resItem) return { kind: 'unparseable' };
    const payload = resItem.result?.data?.json ?? resItem.result?.data ?? resItem.result;
    return { kind: 'success', payload };
  }
  if (data?.error) return { kind: 'error', err: toErr(data.error) };
  if (data?.result) {
    const payload = data.result?.data?.json ?? data.result?.data ?? data.result;
    return { kind: 'success', payload };
  }
  return { kind: 'unparseable' };
}

async function collectRedeemUiFeedback(page) {
  const parts = [];
  const dialog = page.locator('[role="dialog"], .modal, .cl-modal, .modal-content').first();
  if (await dialog.isVisible({ timeout: 800 }).catch(() => false)) {
    const t = await dialog.innerText().catch(() => '');
    if (t?.trim()) parts.push(t.trim());
  }
  const toastLoc = page.locator('[data-sonner-toast], [data-sonner-toaster] [data-state="open"]');
  const n = await toastLoc.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 5); i++) {
    const t = await toastLoc.nth(i).innerText().catch(() => '');
    if (t?.trim()) parts.push(t.trim());
  }
  const merged = parts.join('\n---\n');
  if (merged.length > UI_FEEDBACK_MAX) return `${merged.slice(0, UI_FEEDBACK_MAX)}…`;
  return merged || '';
}

async function getScopedRedeemText(page) {
  const dialog = page.locator('[role="dialog"], .modal, .cl-modal, .modal-content').first();
  if (await dialog.isVisible({ timeout: 800 }).catch(() => false)) {
    const t = await dialog.innerText().catch(() => '');
    if (t?.trim()) return t;
  }
  return (await page.textContent('body')) || '';
}

const REDEEM_FAILURE_UI_RE = /invalid|expired|already used|not valid|could not|unable to redeem/i;
const REDEEM_SUCCESS_UI_RE = /success|credits?\s*added|redeemed/i;

async function pollCreditsAfterRedeem(managementKey, beforeTotal, attempts = 4, delayMs = 900) {
  for (let i = 0; i < attempts; i++) {
    if (i === 0) await new Promise((r) => setTimeout(r, 1000));
    else await new Promise((r) => setTimeout(r, delayMs));
    try {
      const after = await getCredits(managementKey);
      if (Number(after.total) > Number(beforeTotal)) return after;
    } catch {
      /* skip poll */
    }
  }
  return null;
}

async function persistRedeemTrpcRouteFromResponse(response, code) {
  try {
    const reqBody = response.request().postData() || '';
    if (!reqBody.includes(code)) return;
    const rawPath = new URL(response.url()).pathname.split('/api/trpc/')[1]?.split('?')[0];
    if (!rawPath) return;
    const route = decodeURIComponent(rawPath.split(',')[0] || rawPath);
    await store.saveDiscoveredEndpoints({ redeemCode: { route, discoveredAt: new Date().toISOString() } });
  } catch {
    /* ignore */
  }
}

function trpcResponsePredicateForRedeemCode(response, code) {
  if (response.request().method() !== 'POST') return false;
  const url = response.url();
  if (!url.includes('/api/trpc/')) return false;
  const postData = response.request().postData() || '';
  if (!postData.includes(code)) return false;
  return true;
}

/**
 * Redeem a promo code via the OpenRouter /redeem Next.js Server Action.
 * Pure HTTP — no Playwright, no tRPC guessing. Captured 2026-04-07.
 *
 * Response format (RSC wire): line-delimited, action result on line starting with "1:"
 * Success: 1:{"__kind":"OK",...}
 * Failure: 1:{"__kind":"ERR","error":{"error":{"message":"...","code":...}}}
 *
 * @returns {{ success: boolean, result?: any, errorCode?: string, message?: string, source: string }}
 */
async function redeemCodeViaServerAction(sessionCookie, clientCookie, code) {
  const freshJwt = await getFreshJwt(sessionCookie, clientCookie);
  const jwtToUse = freshJwt || sessionCookie;

  const device = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  const cookieHeader = `__session=${jwtToUse}${device ? `; ${device}` : ''}`;

  const url = `${OR_BASE}/redeem`;
  const headers = {
    'Content-Type': 'text/plain;charset=UTF-8',
    'Accept': 'text/x-component',
    'Next-Action': REDEEM_ACTION_HASH,
    'next-router-state-tree': REDEEM_ROUTER_STATE_TREE,
    'Cookie': cookieHeader,
    'User-Agent': USER_AGENT,
    'Origin': OR_ORIGIN,
    'Referer': `${OR_ORIGIN}/redeem`,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify([code]),
  });

  if (res.status === 404) {
    // ── Self-healing: attempt to discover the new hash and retry ──
    const newHash = await selfHealHash('redeem', url, headers, JSON.stringify([code]));
    if (newHash) {
      // Retry with the healed hash
      const retryRes = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Next-Action': newHash },
        body: JSON.stringify([code]),
      });
      if (retryRes.status !== 404) {
        // Replace `res` so the rest of the function processes the retry response
        // (We read retryRes below instead of `res` by reassigning.)
        // Unfortunately `res` is const, so we fall through to a second parse pass.
        const retryText = await retryRes.text();
        for (const line of retryText.split('\n')) {
          const colonIdx = line.indexOf(':');
          if (colonIdx < 0) continue;
          const payload = line.slice(colonIdx + 1);
          try {
            const obj = JSON.parse(payload);
            if (obj?.__kind === 'ERR') {
              const msg = obj.error?.error?.message || obj.error?.message || 'Redemption failed';
              const code404 = obj.error?.error?.code === 404 || obj.error?.code === 404;
              const err = new Error(msg);
              err.httpStatus = code404 ? 404 : 400;
              err.redeemErrorKind = 'ERR';
              err.redeemMeta = obj.error?.error?.metadata;
              throw err;
            }
            if (obj?.__kind === 'OK' || obj?.success || obj?.credits != null) {
              return { success: true, result: obj, source: 'server-action' };
            }
          } catch (e) {
            if (e.redeemErrorKind) throw e;
          }
        }
        if (retryRes.headers.get('content-type')?.includes('x-component') || retryText.length > 10) {
          return { success: true, result: { raw: retryText.slice(0, 200) }, source: 'server-action' };
        }
      }
    }
    throw new Error('Server Action hash stale — OpenRouter redeployed. Self-healing failed.');
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Redeem Server Action auth failed (${res.status}) — session may be expired`);
  }

  const text = await res.text();

  // Parse RSC wire format: find the line with __kind
  for (const line of text.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const payload = line.slice(colonIdx + 1);
    try {
      const obj = JSON.parse(payload);
      if (obj?.__kind === 'ERR') {
        const msg = obj.error?.error?.message || obj.error?.message || 'Redemption failed';
        const code404 = obj.error?.error?.code === 404 || obj.error?.code === 404;
        const err = new Error(msg);
        err.httpStatus = code404 ? 404 : 400;
        err.redeemErrorKind = 'ERR';
        err.redeemMeta = obj.error?.error?.metadata;
        throw err;
      }
      if (obj?.__kind === 'OK' || obj?.success || obj?.credits != null) {
        return { success: true, result: obj, source: 'server-action' };
      }
    } catch (e) {
      if (e.redeemErrorKind) throw e;
      // Not parseable JSON on this line — skip
    }
  }

  // If we got text/x-component but no __kind, treat as unknown success (UI would show it worked)
  if (res.headers.get('content-type')?.includes('x-component') || text.length > 10) {
    return { success: true, result: { raw: text.slice(0, 200) }, source: 'server-action' };
  }

  throw new Error(`Redeem Server Action returned unrecognised response (status=${res.status})`);
}

/** Order: Server Action (fast HTTP) → cached tRPC → tRPC candidates → Playwright fallback */
export async function redeemCode(userId, accountId, code) {
  const { sessionCookie, clientCookie } = await ensureSession(userId, accountId);

  // Context for Cloudflare cookie migration
  const migrationContext = { userId, accountId };

  // ── Step 0: Server Action (pure HTTP, confirmed working 2026-04-07) ──────────
  try {
    const saResult = await redeemCodeViaServerAction(sessionCookie, clientCookie, code);
    if (saResult.success) return saResult;
  } catch (err) {
    const stale = err.message?.includes('stale');
    if (stale) {
      console.warn('[dashboard-api] Redeem Server Action hash stale — falling back to tRPC/Playwright');
    } else if (isPermanentError(err) || err.redeemErrorKind === 'ERR') {
      return redeemFailurePayload('server-action', err);
    } else {
      console.warn(`[dashboard-api] Redeem Server Action failed: ${err.message} — falling back`);
    }
  }

  const endpoints = await store.getDiscoveredEndpoints();
  if (endpoints.redeemCode) {
    try {
      const result = await trpcCallWithMigration(endpoints.redeemCode.route, { code }, sessionCookie, clientCookie, REDEEM_TRPC_HEADERS, migrationContext);
      if (result !== undefined) {
        await store.saveDiscoveredEndpoints({ redeemCode: { ...endpoints.redeemCode, lastUsed: new Date().toISOString() } });
        return { success: true, result, source: 'trpc-cached' };
      }
    } catch (err) {
      if (isPermanentError(err)) {
        return redeemFailurePayload('trpc-cached', err);
      }
      console.warn(`[dashboard-api] Cached redeem tRPC failed: ${err.message}`);
    }
  }

  // Expanded candidate list — sorted by likelihood based on OpenRouter Next.js tRPC naming patterns.
  // Route format: <router>.<procedure> (Next.js App Router tRPC, batched POST to /api/trpc/<route>?batch=1)
  // Discovery: run a live redeem in DevTools → Network tab, filter "trpc", capture POST body + URL.
  // The captured route is auto-persisted to Discovery table and tried first next time.
  const candidates = [
    // Most likely: credits router with code/promo variants
    'credits.redeemCode',
    'credits.redeem',
    'credits.applyCode',
    'credits.applyPromoCode',
    'credits.redeemPromoCode',
    // Voucher/coupon/promo routers
    'voucher.redeem',
    'voucher.apply',
    'coupon.redeem',
    'coupon.apply',
    'promo.redeem',
    'promo.applyCode',
    'promo.redeemCode',
    // Generic code/account handlers
    'code.redeem',
    'code.apply',
    'account.redeem',
    'account.applyCode',
    // User-scoped variants
    'user.redeemCode',
    'user.redeemPromoCode',
    // Gift/referral variants
    'giftCard.redeem',
    'referral.redeem',
    'referralCode.redeem',
  ];
  for (const route of candidates) {
    try {
      const result = await trpcCallWithMigration(route, { code }, sessionCookie, clientCookie, REDEEM_TRPC_HEADERS, migrationContext);
      if (result !== undefined && result !== null) {
        await store.saveDiscoveredEndpoints({ redeemCode: { route, discoveredAt: new Date().toISOString() } });
        return { success: true, result, source: `trpc-${route}` };
      }
    } catch (err) {
      if (isPermanentError(err)) {
        await store.saveDiscoveredEndpoints({ redeemCode: { route, discoveredAt: new Date().toISOString() } });
        return redeemFailurePayload(`trpc-${route}`, err);
      }
      // Try next
    }
  }

  // ── EXPLOIT #12: REST API fallback probe for credit redemption ──
  // Try REST endpoints with session JWT as Bearer token before Playwright
  console.error('[dashboard-api] All tRPC redeem routes exhausted, trying REST API fallback');
  const restRedeemResult = await tryRestApiRedeemCode(sessionCookie, clientCookie, code);
  if (restRedeemResult?.success) {
    console.error(`[dashboard-api] Redemption succeeded via REST API at ${restRedeemResult.probedUrl || 'unknown endpoint'}`);
    return restRedeemResult;
  }

  // Log all probed endpoints for reconnaissance even on failure
  if (restRedeemResult?.probedEndpoints?.length) {
    console.error(`[dashboard-api] REST redeem probe summary (${restRedeemResult.probedEndpoints.length} endpoints):`);
    for (const p of restRedeemResult.probedEndpoints) {
      console.error(`  ${p.method} ${p.url} → ${p.status} ${p.statusText || ''} ${p.error || ''}`);
    }
  }

  console.error('[dashboard-api] REST API redemption failed, falling back to Playwright browser automation');

  return await redeemCodeViaPlaywright(userId, accountId, sessionCookie, clientCookie, code);
}

async function resolvePlaywrightRedeemOutcome(page, trpcResponse, creditsSnapshot, managementKey, attempted, code) {
  const uiFeedback = (await collectRedeemUiFeedback(page)) || undefined;
  const scopeText = await getScopedRedeemText(page);

  if (trpcResponse) {
    try {
      const bodyText = await trpcResponse.text();
      const parsed = parseTrpcRedeemHttpBody(bodyText, trpcResponse.status());
      if (parsed.kind === 'success') {
        await persistRedeemTrpcRouteFromResponse(trpcResponse, code);
        const row = {
          success: true,
          result: parsed.payload,
          source: 'playwright',
          verification: 'trpc_browser',
          message: 'Redeemed via Playwright (tRPC response)',
        };
        if (uiFeedback) row.uiFeedback = uiFeedback;
        return row;
      }
      if (parsed.kind === 'error') {
        await persistRedeemTrpcRouteFromResponse(trpcResponse, code);
        const synthetic = new Error(parsed.err.message);
        synthetic.trpcCode = parsed.err.trpcCode;
        synthetic.httpStatus = parsed.err.httpStatus;
        const fail = redeemFailurePayload('playwright', synthetic);
        if (uiFeedback) fail.uiFeedback = uiFeedback;
        return fail;
      }
    } catch {
      /* fall through to UI / credits */
    }
  }

  if (REDEEM_FAILURE_UI_RE.test(scopeText) || messageLooksLikeInvalidPromo(scopeText)) {
    const msg = 'Code invalid or already used';
    const row = {
      success: false,
      message: msg,
      source: 'playwright',
      errorCode: REDEEM_ERROR_CODES.PROMO_INVALID,
    };
    if (uiFeedback) row.uiFeedback = uiFeedback;
    return row;
  }

  if (managementKey && creditsSnapshot != null) {
    const after = await pollCreditsAfterRedeem(managementKey, creditsSnapshot.total);
    if (after) {
      const row = {
        success: true,
        message: 'Credits increased after redeem',
        source: 'playwright',
        verification: 'credits_total',
        creditsBefore: creditsSnapshot,
        creditsAfter: after,
      };
      if (uiFeedback) row.uiFeedback = uiFeedback;
      return row;
    }
  }

  if (REDEEM_SUCCESS_UI_RE.test(scopeText)) {
    const row = {
      success: true,
      message: 'Redeemed via Playwright',
      source: 'playwright',
      verification: 'ui_text',
    };
    if (uiFeedback) row.uiFeedback = uiFeedback;
    return row;
  }

  const row = {
    success: false,
    message: `Redeem submitted but outcome unclear (checked: ${attempted.join('; ')})`,
    source: 'playwright',
    errorCode: REDEEM_ERROR_CODES.OUTCOME_UNKNOWN,
  };
  if (uiFeedback) row.uiFeedback = uiFeedback;
  return row;
}

async function redeemCodeViaPlaywright(userId, accountId, sessionCookie, clientCookie, code) {
  const { chromium } = await import('playwright');
  const headless = !config.HYDRA_PLAYWRIGHT_HEADED;
  const browser = await chromium.launch({ headless });
  let result = {
    success: false,
    message: 'Unknown error',
    errorCode: REDEEM_ERROR_CODES.UPSTREAM,
    source: 'playwright',
  };
  const attempted = [];

  let creditsSnapshot = null;
  let managementKey = null;
  try {
    const acct = await store.getAccountWithKey(userId, accountId);
    if (acct?.managementKey?.trim()) {
      managementKey = acct.managementKey.trim();
      try {
        creditsSnapshot = await getCredits(managementKey);
      } catch {
        creditsSnapshot = null;
      }
    }
  } catch {
    /* no account row — skip credits verification */
  }

  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    await context.addCookies(await playwrightCookiesForOpenRouter(sessionCookie, clientCookie));
    const page = await context.newPage();

    page.on('response', async (res) => {
      if (res.url().includes('/api/trpc/') && res.request().method() === 'POST') {
        const reqBody = res.request().postData();
        if (reqBody?.includes(code)) {
          const route = new URL(res.url()).pathname.split('/api/trpc/')[1]?.split('?')[0];
          if (route) {
            await store.saveDiscoveredEndpoints({ redeemCode: { route, discoveredAt: new Date().toISOString() } });
          }
        }
      }
    });

    const tryRedeemPage = async () => {
      attempted.push(`${OR_BASE}/redeem`);
      await page.goto(`${OR_BASE}/redeem`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      const promo = page.getByRole('textbox', { name: 'Promo Code' });
      const redeemBtn = page.getByRole('button', { name: /^Redeem Code$/i });
      if (!(await promo.isVisible().catch(() => false))) return { submitted: false, trpcResponse: null };
      await promo.fill(code);
      if (!(await redeemBtn.isVisible().catch(() => false))) return { submitted: false, trpcResponse: null };
      const trpcPromise = page
        .waitForResponse((response) => trpcResponsePredicateForRedeemCode(response, code), { timeout: 15000 })
        .catch(() => null);
      await redeemBtn.click();
      const trpcResponse = await trpcPromise;
      await page.waitForTimeout(400);
      return { submitted: true, trpcResponse };
    };

    const tryBillingModal = async () => {
      attempted.push(`${OR_BASE}/settings/billing or /settings/credits`);
      await page.goto(`${OR_BASE}/settings/billing`, { waitUntil: 'domcontentloaded' }).catch(() => null);
      if (!page.url().includes('/settings/billing')) {
        await page.goto(`${OR_BASE}/settings/credits`, { waitUntil: 'domcontentloaded' }).catch(() => null);
      }
      await page.waitForTimeout(600);
      const openModalBtn = page.locator('button:has-text("Redeem"), a:has-text("Redeem Credit")');
      if (await openModalBtn.count() > 0) {
        await openModalBtn.first().click().catch(() => {});
        await page.waitForTimeout(500);
      }
      const dialog = page.locator('[role="dialog"], .modal, .cl-modal, .modal-content').first();
      const scopedInput = dialog
        .locator('input[name="code"], input#code, input[placeholder*="code"], input[placeholder*="Code"], input[type="text"], input[type="tel"]')
        .first();
      const fallbackInput = page
        .locator('input[name="code"], input#code, input[placeholder*="code"], input[placeholder*="Code"], input[type="text"], input[type="tel"]')
        .first();
      const codeInput = (await dialog.count()) > 0 ? scopedInput : fallbackInput;
      if (!(await codeInput.isVisible().catch(() => false))) return { submitted: false, trpcResponse: null };
      await codeInput.fill(code);
      const trpcPromise = page
        .waitForResponse((response) => trpcResponsePredicateForRedeemCode(response, code), { timeout: 15000 })
        .catch(() => null);
      await page.click('button[type="submit"], button:has-text("Redeem"), button:has-text("Apply")');
      const trpcResponse = await trpcPromise;
      await page.waitForTimeout(400);
      return { submitted: true, trpcResponse };
    };

    let { submitted, trpcResponse } = await tryRedeemPage();
    if (!submitted) {
      ({ submitted, trpcResponse } = await tryBillingModal());
    }

    if (submitted) {
      result = await resolvePlaywrightRedeemOutcome(
        page,
        trpcResponse,
        creditsSnapshot,
        managementKey,
        attempted,
        code,
      );
    } else {
      result = {
        success: false,
        message: `Could not find redeem form (tried ${attempted.join('; ')})`,
        source: 'playwright',
        errorCode: REDEEM_ERROR_CODES.FORM_UNAVAILABLE,
      };
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return result;
}

export async function bulkRedeemCode(userId, accountIds, code) {
  return runInBatches(accountIds, async (id) => {
    try {
      const account = await store.getAccountWithKey(userId, id);
      const result = await redeemCode(userId, id, code);
      return { accountId: id, alias: account.alias, ...result };
    } catch (err) {
      console.error('[DASHBOARD] Fetch failed:', err.message);
      const { errorCode, message } = classifyRedeemFailure(err.message, err);
      return { accountId: id, success: false, message, error: message, errorCode };
    }
  });
}

export async function getUserProfile(sessionCookie, clientCookie) {
  const res = await fetch(`${OR_BASE}/api/auth/me`, {
    headers: dashboardHeaders(sessionCookie, clientCookie, { Referer: `${OR_ORIGIN}/settings` }),
  });
  if (res.ok) {
    const ct = res.headers.get('content-type') || '';
    // Hardened: Use the same robust content-type checking as trpcCall
    if (isHtmlContentType(ct)) {
      // HTML response when expecting JSON - auth likely failed
      const { text: htmlBody } = await safeResponseText(res, 5000);
      const htmlInfo = extractHtmlErrorInfo(htmlBody);
      console.error('[dashboard-api] getUserProfile received HTML response:', {
        status: res.status,
        contentType: ct,
        title: htmlInfo.title,
        hints: htmlInfo.hints,
      });
      // Fall through to tRPC fallback
    } else if (ct.includes('application/json')) {
      try {
        // Hardened: Safe JSON parsing
        const { text } = await safeResponseText(res, 50000);
        return safeJsonParse(text, { route: 'api/auth/me', status: res.status });
      } catch (parseErr) {
        console.error('[dashboard-api] getUserProfile JSON parse error:', parseErr.message);
        // Fall through to tRPC fallback
      }
    }
  }

  try {
    return await trpcCall('user.me', null, sessionCookie, clientCookie);
  } catch {
    return null;
  }
}

/**
 * Sync API key plaintexts for an account.
 *
 * Exploit path (fast): OpenRouter session-auth tRPC may expose full key strings
 * since the session represents the user's own browser context — same auth the "Reveal"
 * button uses. We try several candidate routes before falling back to Playwright.
 *
 * Fallback: Playwright navigates to /settings/keys, clicks every Reveal button,
 * captures the revealed sk-or-v1-* strings, and stores them per hash.
 *
 * Returns: Array of { hash, name, synced: bool, source: 'trpc'|'playwright' }
 */
export async function syncApiKeys(userId, accountId) {
  const { sessionCookie, clientCookie } = await ensureSession(userId, accountId);

  // ── Fast path: probe session-auth tRPC routes that might expose plaintexts ──
  const keyListCandidates = [
    'apiKey.list',
    'user.apiKeys',
    'user.keys',
    'apiKeys.list',
    'key.list',
  ];

  for (const route of keyListCandidates) {
    try {
      const result = await trpcCall(route, {}, sessionCookie, clientCookie);
      if (!result) continue;
      // Look for array of objects with a key/plaintext/secret field
      const items = Array.isArray(result) ? result : (result.keys || result.data || result.items || []);
      if (!Array.isArray(items) || items.length === 0) continue;
      const withKey = items.filter(k => k.key || k.secret || k.plaintext);
      if (withKey.length === 0) continue;
      // Score — we found plaintext keys via tRPC
      return withKey.map(k => ({
        hash: k.hash || k.id,
        name: k.name || k.label,
        plaintextKey: k.key || k.secret || k.plaintext,
        synced: true,
        source: 'trpc',
      }));
    } catch {
      // next candidate
    }
  }

  // ── Fallback: Playwright scrape of /settings/keys ──
  return await syncApiKeysViaPlaywright(sessionCookie, clientCookie);
}

async function syncApiKeysViaPlaywright(sessionCookie, clientCookie) {
  const { chromium } = await import('playwright');
  const headless = !config.HYDRA_PLAYWRIGHT_HEADED;
  const browser = await chromium.launch({ headless });
  const results = [];

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });

    const cookies = openRouterDashboardDeviceCookies(sessionCookie, clientCookie);
    await context.addCookies(cookies.map(([name, value]) => ({
      name, value, domain: OR_HOSTNAME, path: '/', secure: true, httpOnly: false, sameSite: 'Lax',
    })));

    const page = await context.newPage();
    await page.goto(`${OR_ORIGIN}/settings/keys`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Intercept: some Reveal buttons fire an XHR/tRPC call returning the plaintext.
    // Also scan page HTML for already-visible sk-or-v1-* patterns.
    const revealed = [];

    // Try clicking all Reveal buttons
    const revealBtns = await page.locator('button', { hasText: /reveal/i }).all();
    for (const btn of revealBtns) {
      try {
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(600);
      } catch { /* skip */ }
    }

    // Extract any visible sk-or-v1-* strings from the DOM
    const pageText = await page.content();
    const keyMatches = [...pageText.matchAll(/sk-or-v1-[A-Za-z0-9_.-]{8,}/g)].map(m => m[0]);
    for (const k of new Set(keyMatches)) {
      revealed.push({ plaintextKey: k, synced: true, source: 'playwright' });
    }

    await context.close();
    return revealed;
  } catch (err) {
    console.error('[syncApiKeys] Playwright scrape failed:', err.message);
    return [];
  } finally {
    await browser.close().catch(() => {});
  }
}
