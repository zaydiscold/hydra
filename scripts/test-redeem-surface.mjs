#!/usr/bin/env node
/**
 * Redeem Surface Mapper — Isolated code classification tester
 * =============================================================
 *
 * Hits OpenRouter's redeem endpoint with different codes on a single isolated
 * account to map the FULL error-message surface.  Pure HTTP by default.
 *
 * GOAL: Classify every response variant so `classifyRedeemFailure()` in
 *       dashboard-api.js can be surgically accurate.  Old codes, expired
 *       codes, never-existed codes, and already-used codes each produce
 *       DIFFERENT error text — this script captures them all.
 *
 * USAGE
 *   # With account credentials (auto-authenticates)
 *   node scripts/test-redeem-surface.mjs \
 *     --account "alias:email@example.com:password" \
 *     --codes "HYDRA-XXXX-YYYY,OLDCODE123,FAKE123" \
 *     --proxy "http://user:pass@proxy:8080" \
 *     --output results.json
 *
 *   # With pre-existing session cookies (fastest — no auth round-trip)
 *   node scripts/test-redeem-surface.mjs \
 *     --session "clerk_session_jwt_here" \
 *     --client "clerk_client_jwt_here" \
 *     --codes-file ./test-codes.txt
 *
 *   # Against a local Hydra API (uses your vault account)
 *   TEST_MODE=api node scripts/test-redeem-surface.mjs \
 *     --account-id "abc-123" \
 *     --codes "HYDRA-XXXX-YYYY,OLDCODE123" \
 *     --api-url "http://localhost:3001"
 *
 *   # Dry-run: only classify, don't send requests
 *   node scripts/test-redeem-surface.mjs --classify-only --messages-file errors.txt
 *
 * ENV VARS
 *   HTTP_PROXY / HTTPS_PROXY  — standard proxy env vars (used if --proxy not set)
 *   HYRDA_PROXY_SECRET        — if your proxy needs auth (read from Hydra .env)
 *
 * OUTPUT
 *   Writes a structured JSON report.  Prints a terminal summary table.
 *
 * @module test-redeem-surface
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, exit, env } from 'node:process';

// ─── CLI arg parsing (zero-dependency) ──────────────────────────────────
const args = {};
for (let i = 2; i < argv.length; i++) {
  const arg = argv[i];
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
}

// Proxy override
const PROXY_URL = args.proxy || env.HTTPS_PROXY || env.HTTP_PROXY || env.https_proxy || env.http_proxy || null;
const getFetch = () => {
  if (!PROXY_URL) return globalThis.fetch;

  // Node 18+ supports Proxy-Agent via undici.  Use dispatcher when available.
  const url = new URL(PROXY_URL);
  return async (input, init = {}) => {
    const { ProxyAgent } = await import('undici');
    const agent = new ProxyAgent({ uri: PROXY_URL, token: url.username ? `Basic ${btoa(`${url.username}:${url.password}`)}` : undefined });
    return globalThis.fetch(input, { ...init, dispatcher: agent });
  };
};

// ─── Constants (mirrors dashboard-api.js) ───────────────────────────────
const USER_AGENT = env.HYDRA_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const OR_BASE = args['api-url'] || env.OR_BASE || 'https://openrouter.ai';
const OR_ORIGIN = (() => { try { return new URL(OR_BASE).origin; } catch { return 'https://openrouter.ai'; } })();

const REDEEM_ACTION_HASH = env.HYDRA_REDEEM_ACTION_HASH || '402002bec2b81db80981bde049958688557404e07a';
const REDEEM_ROUTER_STATE_TREE = '%5B%22%22%2C%7B%22children%22%3A%5B%22(user)%22%2C%7B%22children%22%3A%5B%22(dashboard)%22%2C%7B%22children%22%3A%5B%22redeem%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D';

// tRPC candidate routes (same as dashboard-api.js)
const TRPC_CANDIDATES = [
  'credits.redeemCode', 'credits.redeem', 'credits.applyCode', 'credits.applyPromoCode',
  'credits.redeemPromoCode', 'voucher.redeem', 'voucher.apply', 'coupon.redeem',
  'coupon.apply', 'promo.redeem', 'promo.applyCode', 'promo.redeemCode',
  'code.redeem', 'code.apply', 'account.redeem', 'account.applyCode',
  'user.redeemCode', 'user.redeemPromoCode', 'giftCard.redeem',
  'referral.redeem', 'referralCode.redeem',
];

// REST API fallback endpoints
const REST_ENDPOINTS = [
  { method: 'POST', url: `${OR_ORIGIN}/api/v1/credits/redeem` },
  { method: 'POST', url: `${OR_ORIGIN}/api/redeem` },
  { method: 'POST', url: `${OR_ORIGIN}/api/v1/redeem` },
  { method: 'POST', url: `${OR_ORIGIN}/api/credits/redeem` },
  { method: 'POST', url: `${OR_ORIGIN}/api/v1/credits/apply` },
];

// ─── Error classification (mirrors dashboard-api.js classifyRedeemFailure) ──
const REDEEM_ERROR_CODES = {
  PROMO_INVALID: 'REDEEM_PROMO_INVALID',
  SESSION: 'REDEEM_SESSION',
  RATE_LIMIT: 'REDEEM_RATE_LIMIT',
  FORM_UNAVAILABLE: 'REDEEM_FORM_UNAVAILABLE',
  OUTCOME_UNKNOWN: 'REDEEM_OUTCOME_UNKNOWN',
  UPSTREAM: 'REDEEM_UPSTREAM',
  MAX_USES: 'REDEEM_MAX_USES',
};

function messageLooksLikeInvalidPromo(msg) {
  if (!msg || typeof msg !== 'string') return false;
  const m = msg.toLowerCase();
  if (/\b(invalid|expired|not valid|already used|already redeemed|unknown code|code not found|no longer valid|unable to redeem|could not redeem)\b/.test(m)) {
    if (/\b(code|promo|voucher|credit|coupon)\b/.test(m) || /\bredeem/.test(m)) return true;
  }
  if (/\bthis code\b/.test(m) && /\b(invalid|expired|used)\b/.test(m)) return true;
  return false;
}

function classifyError(rawMessage, httpStatus) {
  const msg = String(rawMessage || 'Unknown error');
  const http = httpStatus || 0;

  if (http === 429) return { errorCode: REDEEM_ERROR_CODES.RATE_LIMIT, message: msg };
  if (http === 401 || http === 403) return { errorCode: REDEEM_ERROR_CODES.SESSION, message: msg };
  // Text-based rate limit detection (Server Action embeds errors in RSC text, no HTTP 429)
  if (/\brate limit|too many requests|slow down\b/i.test(msg)) {
    return { errorCode: REDEEM_ERROR_CODES.RATE_LIMIT, message: msg };
  }

  // Standalone auth failures (no "session" keyword needed)
  if (/\b(not authorized|unauthorized|forbidden|access denied)\b/i.test(msg)) {
    return { errorCode: REDEEM_ERROR_CODES.SESSION, message: msg };
  }
  if (/session.*(expired|log ?in|login|credentials|re-auth|unauthorized|forbidden)/i.test(msg)) {
    return { errorCode: REDEEM_ERROR_CODES.SESSION, message: msg };
  }
  if (/two-factor|2fa|cloudflare|challenge/i.test(msg)) {
    return { errorCode: REDEEM_ERROR_CODES.SESSION, message: msg };
  }

  // Max uses / max redemptions — distinct from promo invalid
  if (/\b(maximum|max)\s+(redemptions|uses|claims|times)\b/i.test(msg) ||
      /\b(reached|hit|at)\s+(its\s+)?(max|limit|cap)\b/i.test(msg)) {
    return { errorCode: REDEEM_ERROR_CODES.MAX_USES, message: msg };
  }

  if (messageLooksLikeInvalidPromo(msg)) {
    return { errorCode: REDEEM_ERROR_CODES.PROMO_INVALID, message: msg };
  }

  if (http === 400 || http === 404) {
    return { errorCode: REDEEM_ERROR_CODES.PROMO_INVALID, message: msg };
  }

  if (msg.includes('redeem form')) {
    return { errorCode: REDEEM_ERROR_CODES.FORM_UNAVAILABLE, message: msg };
  }
  if (msg.includes('outcome unclear') || msg.includes('could not determine')) {
    return { errorCode: REDEEM_ERROR_CODES.OUTCOME_UNKNOWN, message: msg };
  }

  return { errorCode: REDEEM_ERROR_CODES.UPSTREAM, message: msg };
}

// ─── Terminal colors ────────────────────────────────────────────────────
const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', magenta: '\x1b[35m' };
const log = (icon, msg, color = C.cyan) => console.log(`${color}${icon}${C.reset} ${msg}`);
const ok = (msg) => log('✓', msg, C.green);
const warn = (msg) => log('⚠', msg, C.yellow);
const fail = (msg) => log('✗', msg, C.red);

// ─── Rate limiter ──────────────────────────────────────────────────────
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const RATE_DELAY_MS = parseInt(args['rate-delay'] || '1500', 10);

// ─── Server Action (pure HTTP, fastest path) ───────────────────────────
async function tryServerAction(sessionCookie, clientCookie, code) {
  const fetch = await getFetch();
  const device = clientCookie ? `; ${clientCookie.split(';')[0]?.trim() || ''}` : '';
  const cookieHeader = `__session=${sessionCookie}${device}`;

  const res = await fetch(`${OR_BASE}/redeem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'Accept': 'text/x-component',
      'Next-Action': REDEEM_ACTION_HASH,
      'next-router-state-tree': REDEEM_ROUTER_STATE_TREE,
      'Cookie': cookieHeader,
      'User-Agent': USER_AGENT,
      'Origin': OR_ORIGIN,
      'Referer': `${OR_ORIGIN}/redeem`,
    },
    body: JSON.stringify([code]),
    redirect: 'manual',
  });

  const text = await res.text();

  // If 404, hash is stale — try self-heal
  if (res.status === 404) {
    return { source: 'server-action', success: false, httpStatus: res.status, rawText: text.slice(0, 500), error: 'Server Action hash stale (404) — self-healing skipped in test mode' };
  }

  if (res.status === 401 || res.status === 403) {
    return { source: 'server-action', success: false, httpStatus: res.status, rawText: text.slice(0, 500), error: `Auth failed (${res.status})` };
  }

  // Parse RSC wire format
  for (const line of text.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const payload = line.slice(colonIdx + 1);
    try {
      const obj = JSON.parse(payload);

      // Success case
      if (obj?.__kind === 'OK' || obj?.success || obj?.credits != null) {
        return {
          source: 'server-action',
          success: true,
          httpStatus: res.status,
          body: obj,
          creditsAdded: obj?.credits ?? obj?.credit ?? obj?.amount ?? null,
        };
      }

      // Error case — this is the GOLD we want!
      if (obj?.__kind === 'ERR' || obj?.error) {
        const errMsg = obj.error?.error?.message || obj.error?.message || obj.message || 'Unknown error';
        return {
          source: 'server-action',
          success: false,
          httpStatus: res.status,
          rawText: text.slice(0, 2000),
          body: obj,
          error: errMsg,
          errorKind: obj?.__kind || 'ERR',
          errorMeta: obj?.error?.error?.metadata || null,
          classification: classifyError(errMsg, res.status),
        };
      }
    } catch {
      // Not parseable JSON on this line — skip
    }
  }

  // Fallback: if we got RSC content but couldn't parse it
  if (res.headers.get('content-type')?.includes('x-component') || text.includes('__kind')) {
    return {
      source: 'server-action',
      success: false,
      httpStatus: res.status,
      rawText: text.slice(0, 500),
      error: 'Unparseable RSC response',
      classification: classifyError('Unparseable RSC response', res.status),
    };
  }

  // If we got HTML back, session is fried
  if (text.includes('<!doctype') || text.includes('<html')) {
    return {
      source: 'server-action',
      success: false,
      httpStatus: res.status,
      rawText: text.slice(0, 500),
      error: 'Got HTML — session likely expired or Cloudflare challenged',
      classification: classifyError('HTML response — session expired', 401),
    };
  }

  return { source: 'server-action', success: false, httpStatus: res.status, rawText: text.slice(0, 500), error: 'No parseable response' };
}

// ─── tRPC probe ────────────────────────────────────────────────────────
async function tryTrpcRoute(route, sessionCookie, clientCookie, code) {
  const fetch = await getFetch();
  const device = clientCookie ? `; ${clientCookie}` : '';
  const cookieHeader = `__session=${sessionCookie}${device}`;
  const url = `${OR_BASE}/api/trpc/${route}?batch=1`;

  const headers = {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'Cookie': cookieHeader,
    'User-Agent': USER_AGENT,
    'Origin': OR_ORIGIN,
    'Referer': `${OR_ORIGIN}/redeem`,
    'Next-Action': REDEEM_ACTION_HASH,
    'next-router-state-tree': REDEEM_ROUTER_STATE_TREE,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ 0: { code } }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });

    const text = await res.text();

    // Try parsing as JSON
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }

    if (body && !body.error) {
      // tRPC success — result is in body[0].result.data.json
      const result = body[0]?.result?.data?.json || body[0]?.result?.data || body;
      return {
        source: `trpc-${route}`,
        success: true,
        httpStatus: res.status,
        body: result,
        rawText: text.slice(0, 2000),
      };
    }

    // tRPC error
    const errMsg = body?.error?.message || body?.[0]?.error?.message || `tRPC ${route} returned ${res.status}`;
    return {
      source: `trpc-${route}`,
      success: false,
      httpStatus: res.status,
      body,
      rawText: text.slice(0, 2000),
      error: errMsg,
      classification: classifyError(errMsg, res.status),
    };
  } catch (err) {
    return { source: `trpc-${route}`, success: false, httpStatus: 0, error: err.message, classification: classifyError(err.message, 0) };
  }
}

// ─── REST API probe ────────────────────────────────────────────────────
async function tryRestEndpoint(method, url, sessionCookie, clientCookie, code) {
  const fetch = await getFetch();
  const device = clientCookie ? `; ${clientCookie}` : '';
  const cookieHeader = `__session=${sessionCookie}${device}`;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Cookie': cookieHeader,
        'Authorization': `Bearer ${sessionCookie}`,
        'User-Agent': USER_AGENT,
        'Origin': OR_ORIGIN,
        'Referer': `${OR_ORIGIN}/redeem`,
      },
      body: JSON.stringify({ code }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });

    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }

    if (res.ok && body) {
      return {
        source: `rest-${method}-${url}`,
        success: true,
        httpStatus: res.status,
        body,
        rawText: text.slice(0, 2000),
      };
    }

    const errMsg = body?.message || body?.error || `REST ${method} ${url} → ${res.status}`;
    return {
      source: `rest-${method}-${url}`,
      success: false,
      httpStatus: res.status,
      body,
      rawText: text.slice(0, 2000),
      error: errMsg,
      classification: classifyError(errMsg, res.status),
    };
  } catch (err) {
    return { source: `rest-${method}-${url}`, success: false, httpStatus: 0, error: err.message };
  }
}

// ─── Main test loop ────────────────────────────────────────────────────
async function testCode(code, sessionCookie, clientCookie, label) {
  console.log(`\n${C.bold}${C.magenta}═══ Testing: "${code}"${label ? ` (${label})` : ''} ${C.reset}`);

  const results = [];

  // 1. Server Action (always first — fastest)
  const saResult = await tryServerAction(sessionCookie, clientCookie, code);
  results.push(saResult);

  if (saResult.success) {
    ok(`Server Action SUCCESS — credits: ${saResult.creditsAdded ?? '??'}`);
    return results; // Don't bother with tRPC if SA worked
  }

  warn(`Server Action: ${saResult.error?.slice(0, 100) || 'no response'}`);
  if (saResult.classification) {
    log('→', `classified as: ${saResult.classification.errorCode}`, C.yellow);
  }

  // Don't continue if session is dead
  if (saResult.httpStatus === 401 || saResult.httpStatus === 403) {
    fail('Session appears expired — stopping further probes');
    return results;
  }

  // 2. tRPC candidates
  log('·', `Trying ${TRPC_CANDIDATES.length} tRPC routes...`, C.dim);
  for (const route of TRPC_CANDIDATES) {
    const trpcResult = await tryTrpcRoute(route, sessionCookie, clientCookie, code);
    results.push(trpcResult);

    if (trpcResult.success) {
      ok(`tRPC SUCCESS via ${route}`);
      break; // Found working route
    }

    // If we get a definitive error (not just "wrong route"), collect it
    if (trpcResult.httpStatus === 429) {
      warn(`tRPC ${route} — RATE LIMITED. Delaying 5s...`);
      await delay(5000);
    }
  }

  // 3. REST API fallback
  log('·', `Trying ${REST_ENDPOINTS.length} REST endpoints...`, C.dim);
  for (const ep of REST_ENDPOINTS) {
    const restResult = await tryRestEndpoint(ep.method, ep.url, sessionCookie, clientCookie, code);
    results.push(restResult);
    if (restResult.success) {
      ok(`REST SUCCESS via ${ep.method} ${ep.url}`);
      break;
    }
  }

  return results;
}

// ─── API mode (hit local Hydra instead of OpenRouter directly) ─────────
async function testCodeViaHydraApi(code, accountId, apiUrl) {
  console.log(`\n${C.bold}${C.magenta}═══ Testing: "${code}" via Hydra API ${C.reset}`);

  const fetch = await getFetch();
  const token = env.HYDRA_TOKEN || '';

  try {
    const res = await fetch(`${apiUrl}/api/codes/redeem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : undefined,
      },
      body: JSON.stringify({ accountId, code }),
    });

    const body = await res.json();
    const result = {
      source: 'hydra-api',
      success: body?.success || false,
      httpStatus: res.status,
      body,
      error: body?.error || body?.message || null,
      classification: body?.success ? null : classifyError(body?.error || body?.message || 'Unknown', res.status),
    };

    if (result.success) {
      ok(`Hydra API SUCCESS — credits: ${body?.creditsAdded ?? body?.data?.creditsAdded ?? '??'}`);
    } else {
      warn(`Hydra API: ${result.error?.slice(0, 100) || 'no response'}`);
      if (result.classification) log('→', `classified as: ${result.classification.errorCode}`, C.yellow);
    }

    return [result];
  } catch (err) {
    fail(`Hydra API unreachable: ${err.message}`);
    return [{ source: 'hydra-api', success: false, error: err.message }];
  }
}

// ─── Auth helper ───────────────────────────────────────────────────────
async function authenticateAccount(aliasEmailPass) {
  const [alias, email, password] = aliasEmailPass.split(':');
  if (!email || !password) {
    fail('--account format is "alias:email@example.com:password"');
    exit(1);
  }

  const fetch = await getFetch();
  log('·', `Authenticating ${email}...`, C.dim);

  // Step 1: Get Clerk sign-in ID
  const initRes = await fetch(`${OR_ORIGIN}/api/auth/sign-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'Origin': OR_ORIGIN,
      'Referer': `${OR_ORIGIN}/sign-in`,
    },
    body: JSON.stringify({ identifier: email, strategy: 'password' }),
  });

  if (!initRes.ok) {
    fail(`Auth init failed: ${initRes.status} ${await initRes.text().catch(() => '')}`);
    exit(1);
  }

  const initBody = await initRes.json();
  const signInId = initBody?.id || initBody?.signInId;
  if (!signInId) {
    fail(`No signInId in response: ${JSON.stringify(initBody).slice(0, 200)}`);
    exit(1);
  }

  // Step 2: Submit password
  const attemptRes = await fetch(`${OR_ORIGIN}/api/auth/sign-in/${signInId}/attempt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'Origin': OR_ORIGIN,
      'Referer': `${OR_ORIGIN}/sign-in`,
    },
    body: JSON.stringify({ identifier: email, password, strategy: 'password' }),
  });

  if (!attemptRes.ok) {
    fail(`Auth attempt failed: ${attemptRes.status}`);
    exit(1);
  }

  // Extract cookies from response headers
  const setCookie = attemptRes.headers.get('set-cookie') || '';
  const sessionMatch = setCookie.match(/__session=([^;]+)/);
  const clientMatch = setCookie.match(/__client=([^;]+)/);

  // Also try redirect-based cookie extraction
  const sessionCookie = sessionMatch?.[1];
  const clientCookie = clientMatch?.[1];

  if (!sessionCookie) {
    // Try fetching the full response body for cookie extraction
    const attemptBody = await attemptRes.json();
    const client = attemptBody?.client?.sessions?.[0];
    if (client?.last_active_token?.jwt) {
      ok(`Got session JWT from response body`);
      return { session: client.last_active_token.jwt, client: clientCookie || '', alias, email };
    }
    fail('Could not extract session cookie from auth response');
    exit(1);
  }

  ok(`Authenticated as ${email}`);
  return { session: sessionCookie, client: clientCookie || '', alias, email };
}

// ─── Classify-only mode ────────────────────────────────────────────────
function classifyOnlyMode(messagesFile) {
  const lines = readFileSync(messagesFile, 'utf-8').split('\n').filter(Boolean);
  const results = [];

  for (const line of lines) {
    const classification = classifyError(line, 0);
    results.push({ message: line, classification });
    console.log(`${C.magenta}→${C.reset} ${classification.errorCode.padEnd(28)} ${C.dim}${line.slice(0, 120)}${C.reset}`);
  }

  if (args.output) writeFileSync(resolve(args.output), JSON.stringify(results, null, 2));
  return results;
}

// ─── Entrypoint ────────────────────────────────────────────────────────
async function main() {
  console.log(`${C.bold}${C.cyan}
  ╔═══════════════════════════════════════════╗
  ║   REDEEM SURFACE MAPPER                  ║
  ║   Map OpenRouter redeem error messages   ║
  ╚═══════════════════════════════════════════╝
${C.reset}`);

  // ── classify-only mode ──
  if (args['classify-only']) {
    const file = args['messages-file'];
    if (!file) { fail('--classify-only requires --messages-file <path>'); exit(1); }
    classifyOnlyMode(file);
    exit(0);
  }

  // ── Determine mode ──
  const mode = env.TEST_MODE || 'direct';
  const apiUrl = args['api-url'] || 'http://localhost:3001';

  // ── Parse codes ──
  let codes = [];
  if (args['codes-file']) {
    codes = readFileSync(resolve(args['codes-file']), 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
  } else if (args.codes) {
    codes = args.codes.split(',').map(c => c.trim()).filter(Boolean);
  } else {
    fail('No codes provided. Use --codes "CODE1,CODE2" or --codes-file <path>');
    exit(1);
  }

  if (codes.length === 0) {
    fail('No valid codes found');
    exit(1);
  }

  log('▶', `${codes.length} code(s) to test`, C.cyan);
  if (PROXY_URL) log('▶', `Proxy: ${PROXY_URL.replace(/\/\/.*@/, '//***@')}`, C.dim);

  // ── Auth ──
  let sessionCookie, clientCookie, accountId;

  if (args.session) {
    sessionCookie = args.session;
    clientCookie = args.client || '';
    ok('Using provided session cookies');
  } else if (args.account) {
    const auth = await authenticateAccount(args.account);
    sessionCookie = auth.session;
    clientCookie = auth.client;
  } else if (args['account-id'] && mode === 'api') {
    accountId = args['account-id'];
    ok(`Using account ID: ${accountId} (Hydra API mode)`);
  } else {
    fail('Must provide --session + --client, --account "alias:email:pass", or --account-id (with TEST_MODE=api)');
    exit(1);
  }

  // ── Run tests ──
  const allResults = [];
  const summary = [];

  for (const code of codes) {
    let results;
    if (mode === 'api' && accountId) {
      results = await testCodeViaHydraApi(code, accountId, apiUrl);
    } else {
      results = await testCode(code, sessionCookie, clientCookie);
    }
    allResults.push({ code, results });

    // Build summary row
    const successes = results.filter(r => r.success);
    const failures = results.filter(r => !r.success && r.classification);
    const classifications = [...new Set(failures.map(f => f.classification?.errorCode).filter(Boolean))];

    summary.push({
      code,
      success: successes.length > 0,
      sources: successes.map(s => s.source),
      errorClassifications: classifications,
      firstError: failures[0]?.error?.slice(0, 200) || null,
      httpStatuses: [...new Set(results.map(r => r.httpStatus).filter(Boolean))],
    });

    // Delay between codes
    if (codes.indexOf(code) < codes.length - 1) {
      log('⏳', `Delaying ${RATE_DELAY_MS}ms...`, C.dim);
      await delay(RATE_DELAY_MS);
    }
  }

  // ── Write output ──
  const report = {
    generated: new Date().toISOString(),
    mode: mode === 'api' ? `hydra-api @ ${apiUrl}` : `direct (${OR_BASE})`,
    proxy: PROXY_URL ? PROXY_URL.replace(/\/\/.*@/, '//***@') : null,
    codesTested: codes.length,
    summary,
    details: allResults,
  };

  if (args.output) {
    writeFileSync(resolve(args.output), JSON.stringify(report, null, 2));
    ok(`Report written to ${args.output}`);
  }

  // ── Print summary table ──
  console.log(`\n${C.bold}${C.cyan}┌──────────────────────────────────────────────────────────────┐`);
  console.log(`│  REDEEM SURFACE SUMMARY                                      │`);
  console.log(`├──────┬─────────┬──────────────────────────────────────────────┤`);
  for (const row of summary) {
    const status = row.success ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    const codeDisp = row.code.length > 16 ? row.code.slice(0, 13) + '...' : row.code.padEnd(16);
    const classes = row.errorClassifications.length > 0
      ? row.errorClassifications.join(', ')
      : (row.success ? 'N/A' : 'unclassified');

    console.log(`│ ${status}  │ ${C.bold}${codeDisp}${C.reset} │ ${C.dim}${classes.slice(0, 42).padEnd(42)}${C.reset} │`);
  }
  console.log(`└──────┴─────────┴──────────────────────────────────────────────┘${C.reset}`);

  // Print unique error messages found
  const uniqueErrors = [...new Set(
    allResults.flatMap(r => r.results)
      .filter(r => !r.success && r.error)
      .map(r => r.error)
  )];

  if (uniqueErrors.length > 0) {
    console.log(`\n${C.bold}${C.yellow}Unique error messages discovered:${C.reset}`);
    for (const err of uniqueErrors) {
      console.log(`  ${C.magenta}→${C.reset} ${err}`);
    }
  }

  console.log(`\n${C.dim}Done. ${allResults.flatMap(r => r.results).length} total probes across ${codes.length} code(s).${C.reset}\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  exit(1);
});
