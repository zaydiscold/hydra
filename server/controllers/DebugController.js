/**
 * DebugController — Security research and tRPC asymmetry probes.
 *
 * All endpoints require master bearer auth (requireUnlocked).
 * NEVER expose these routes in production without auth.
 *
 * POST /api/debug/trpc-probe — fire multiple tRPC routes with live session,
 *   compare against mgmt-key REST, surface any auth asymmetries.
 */

import BaseController from './BaseController.js';
import * as store from '../services/store.js';
import { getCredits } from '../services/openrouter.js';
import { OR_BASE } from '../config.js';
import { logger } from '../services/logger.js';
import { trpcCall, getFreshJwt } from '../services/dashboard-api.js';
import { clerkFapiDeviceCookieHeader, openRouterDashboardDeviceCookies, refreshSession } from '../services/clerk-auth.js';

// ─── tRPC candidate routes to probe ──────────────────────────────────────────
// Grouped by category for structured output.
const PROBE_ROUTES = {
  identity: [
    { route: 'user.me', input: null, referer: '/settings' },
    { route: 'user.profile', input: null, referer: '/settings' },
  ],
  credits: [
    { route: 'user.credits', input: null, referer: '/settings' },
    { route: 'user.creditHistory', input: { limit: 50 }, referer: '/credits' },
    { route: 'user.transactions', input: { limit: 50 }, referer: '/credits' },
    { route: 'credits.history', input: { limit: 50 }, referer: '/credits' },
    { route: 'credits.balance', input: null, referer: '/credits' },
  ],
  keys: [
    { route: 'apiKey.list', input: {}, referer: '/settings/keys' },
    { route: 'user.apiKeys', input: {}, referer: '/settings/keys' },
    { route: 'user.keys', input: {}, referer: '/settings/keys' },
    { route: 'apiKeys.list', input: {}, referer: '/settings/keys' },
    { route: 'key.list', input: {}, referer: '/settings/keys' },
    { route: 'keys.list', input: {}, referer: '/settings/keys' },
  ],
  subscription: [
    { route: 'subscription.status', input: null, referer: '/settings' },
    { route: 'user.subscription', input: null, referer: '/settings' },
  ],
  // Vampire mode: no-op profile update to reset session TTL
  vampire: [
    { route: 'user.updateProfile', input: { bio: '' }, referer: '/settings', method: 'mutation' },
  ],
};

// ─── Primary probe: use trpcCall (handles JWT refresh + HTML detection) ─────────
// sessionCookie should already be a fresh JWT (pre-refreshed in trpcProbe before calling this)
function dashboardCookieHeader(sessionCookie, clientCookie, { includeSession = true } = {}) {
  const parts = [];
  if (includeSession && sessionCookie) parts.push(`__session=${sessionCookie}`);
  const device = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  if (device) parts.push(device);
  return parts.join('; ');
}

async function probeRoute(route, input, sessionCookie, clientCookie, referer = '/settings') {
  const OR_ORIGIN = new URL(OR_BASE).origin;
  const url = `${OR_BASE}/api/trpc/${route}?batch=1`;
  const body = JSON.stringify({ '0': { json: input } });
  const results = {};

  // full_auth — uses trpcCall which: refreshes JWT via getFreshJwt, detects HTML 200s, parses batch envelope
  try {
    const data = await trpcCall(route, input, sessionCookie, clientCookie, {
      'Referer': `${OR_ORIGIN}${referer}`,
    });
    results.full_auth = { ok: true, trpcResult: { ok: true, data } };
  } catch (err) {
    results.full_auth = {
      ok: false,
      isHtml: err.isHtml ?? false,
      httpStatus: err.httpStatus,
      error: err.message,
      // If HTML, the route name is wrong OR route requires different auth - surface the page title
      htmlTitle: err.htmlInfo?.title ?? null,
    };
  }

  // client_only — raw fetch with __client only (no __session JWT).
  // Uses freshJwt obtained above to confirm JWT is valid, then tests without it.
  // Tests: is __client cookie alone sufficient for this tRPC route?
  if (clientCookie) {
    try {
      const freshJwt = await getFreshJwt(sessionCookie, clientCookie);
      const makeHeaders = (cookieStr) => ({
        'Content-Type': 'application/json',
        'Cookie': cookieStr,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Origin': OR_ORIGIN,
        'Referer': `${OR_ORIGIN}${referer}`,
        'x-trpc-source': 'nextjs-react',
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: makeHeaders(dashboardCookieHeader(null, clientCookie, { includeSession: false })),
        body,
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* raw */ }
      const isHtml = (res.headers.get('content-type') || '').includes('text/html');
      results.client_only = {
        status: res.status,
        ok: !isHtml && res.ok,
        isHtml,
        trpcResult: isHtml ? null : extractTrpcResult(parsed),
        freshJwtWasAvailable: !!freshJwt,
        note: '__client cookie only — no __session JWT. Success here = JWT optional for this route.',
      };
    } catch (err) {
      results.client_only = { error: err.message };
    }
  }

  // session_only — __session JWT only (no __client device cookie)
  try {
    const freshJwt = await getFreshJwt(sessionCookie, clientCookie);
    const jwtToTest = freshJwt || sessionCookie;
    const makeHeaders = (cookieStr) => ({
      'Content-Type': 'application/json',
      'Cookie': cookieStr,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Origin': OR_ORIGIN,
      'Referer': `${OR_ORIGIN}${referer}`,
      'x-trpc-source': 'nextjs-react',
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: makeHeaders(`__session=${jwtToTest}`),
      body,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* raw */ }
    const isHtml = (res.headers.get('content-type') || '').includes('text/html');
    results.session_only = {
      status: res.status,
      ok: !isHtml && res.ok,
      isHtml,
      trpcResult: isHtml ? null : extractTrpcResult(parsed),
      note: '__session JWT only — no __client device cookie.',
    };
  } catch (err) {
    results.session_only = { error: err.message };
  }

  return results;
}

// ─── Try GET method for tRPC query routes ─────────────────────────────────────
async function rawTrpcGet(route, input, sessionCookie, clientCookie, referer = '/settings') {
  const OR_ORIGIN = new URL(OR_BASE).origin;
  const inputEncoded = encodeURIComponent(JSON.stringify({ '0': { json: input } }));
  const url = `${OR_BASE}/api/trpc/${route}?batch=1&input=${inputEncoded}`;
  const cookie = dashboardCookieHeader(sessionCookie, clientCookie);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Origin': new URL(OR_BASE).origin,
        'Referer': `${OR_ORIGIN}${referer}`,
        'x-trpc-source': 'nextjs-react',
      },
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* raw */ }
    return { status: res.status, ok: res.ok, trpcResult: extractTrpcResult(parsed), method: 'GET' };
  } catch (err) {
    return { error: err.message, method: 'GET' };
  }
}

// ─── Extract meaningful result from tRPC batch envelope ──────────────────────
function extractTrpcResult(parsed) {
  if (!parsed || !Array.isArray(parsed)) return parsed;
  const first = parsed[0];
  if (!first) return null;
  if (first.result?.data?.json !== undefined) return { ok: true, data: first.result.data.json };
  if (first.result?.data !== undefined) return { ok: true, data: first.result.data };
  if (first.error) return { ok: false, error: first.error };
  return first;
}

// ─── Scan result for interesting fields ──────────────────────────────────────
function analyzeResult(routeName, result) {
  const findings = [];
  const str = JSON.stringify(result);

  // Key plaintexts
  if (/sk-or-v1-[A-Za-z0-9_.-]{20,}/.test(str)) {
    findings.push({ severity: 'CRITICAL', finding: 'API key plaintext (sk-or-v1-*) found in response' });
  }
  // credit_source field (distinguishes hackathon vs purchased credits)
  if (str.includes('credit_source') || str.includes('creditSource')) {
    findings.push({ severity: 'HIGH', finding: 'credit_source field present — can distinguish grant vs purchased credits' });
  }
  // Internal IDs or email leaks
  if (str.includes('"email"') && routeName !== 'user.me') {
    findings.push({ severity: 'MEDIUM', finding: 'email address in non-identity route response' });
  }
  // Transaction history
  if (str.includes('redeemed') || str.includes('redemption') || str.includes('promo')) {
    findings.push({ severity: 'HIGH', finding: 'redemption/promo data in response — code history visible' });
  }
  // Internal Stripe/payment data
  if (str.includes('stripe') || str.includes('customer_id') || str.includes('customerId')) {
    findings.push({ severity: 'HIGH', finding: 'Payment processor data (Stripe) in response' });
  }
  // Error shapes with internal codes
  if (str.includes('"code"') && str.includes('"message"') && result?.ok === false) {
    const errStr = JSON.stringify(result?.error ?? {});
    if (errStr.includes('UNAUTHORIZED') || errStr.includes('FORBIDDEN')) {
      findings.push({ severity: 'LOW', finding: 'Auth error shape — internal code visible in error response' });
    }
  }
  // __client-only auth worked (full_auth is per-route result, not combined)
  if (result?.client_only?.ok === true) {
    findings.push({ severity: 'CRITICAL', finding: 'Route accessible with __client cookie only — JWT may be optional for this route' });
  }

  return findings;
}

// ─── Controller ───────────────────────────────────────────────────────────────

class DebugController extends BaseController {
  /**
   * POST /api/debug/trpc-probe
   * Body: { accountId, categories?: string[], includeVampire?: bool }
   *
   * Fires tRPC routes across auth variants, compares against mgmt-key REST,
   * surfaces asymmetries and exploitable fields.
   */
  async trpcProbe(req, res) {
    const { accountId, categories, includeVampire = false } = req.body ?? {};
    if (!accountId) return this.error(res, 'accountId required', 400);

    try {
      const session = await store.getAccountSession(req.user.id, accountId);
      const account = await store.getAccountWithKey(req.user.id, accountId);

      if (!session?.sessionCookie) {
        return this.error(res, 'No active session for this account — re-auth first', 400);
      }

      let sessionCookie = session.sessionCookie;
      // Prefer stacked array over legacy single-string field.
      const cookieInput = session.clientCookies?.length > 0 ? session.clientCookies : session.clientCookie;
      let clientCookie = session.clientCookie; // kept for header construction below

      // Pre-refresh the session before probing — `getFreshJwt` only reads Clerk's client object
      // which may show empty sessions even when the stored JWT is valid. `refreshSession` uses
      // Set-Cookie from Clerk's response which actually gives us a fresh JWT.
      try {
        const refreshed = await refreshSession(cookieInput, sessionCookie);
        if (refreshed?.sessionCookie) {
          sessionCookie = refreshed.sessionCookie;
          clientCookie = refreshed.clientCookie ?? clientCookie;
          // Persist so subsequent calls benefit too
          await store.updateAccountSession(req.user.id, accountId, refreshed.sessionCookie, clientCookie, refreshed.sessionExpiry ?? null);
          logger.info(`[DEBUG] Session pre-refreshed for ${account?.alias}`);
        }
      } catch (err) {
        logger.warn(`[DEBUG] Pre-refresh failed (using stored JWT): ${err.message}`);
      }

      logger.info(`[DEBUG] tRPC probe started for account=${accountId} (${account?.alias})`);

      // ── Select routes to probe ──
      const selectedCategories = categories ?? Object.keys(PROBE_ROUTES).filter(c => c !== 'vampire');
      if (includeVampire) selectedCategories.push('vampire');

      const probeList = selectedCategories.flatMap(cat => PROBE_ROUTES[cat] ?? []);

      // ── Fire probes in parallel (cap at 8 concurrent) ──
      const results = {};
      const allFindings = [];

      const chunks = [];
      for (let i = 0; i < probeList.length; i += 8) chunks.push(probeList.slice(i, i + 8));

      for (const chunk of chunks) {
        await Promise.all(chunk.map(async ({ route, input, referer }) => {
          const authVariants = await probeRoute(route, input, sessionCookie, clientCookie, referer);
          // Also try GET method for this route
          const getResult = await rawTrpcGet(route, input, sessionCookie, clientCookie, referer);

          results[route] = {
            ...authVariants,
            get_method: getResult,
          };

          // Scan for interesting fields in full_auth result
          const findings = analyzeResult(route, authVariants.full_auth);
          if (findings.length > 0) {
            allFindings.push({ route, findings });
          }
        }));
      }

      // ── Mgmt-key comparison: /api/v1/credits ──
      let mgmtKeyCredits = null;
      try {
        const mgmtKey = account?.managementKey;
        if (mgmtKey) {
          mgmtKeyCredits = await getCredits(mgmtKey);
        }
      } catch (err) {
        mgmtKeyCredits = { error: err.message };
      }

      // ── Stale JWT test: does client-only work across ALL routes? ──
      const clientOnlySuccesses = Object.entries(results)
        .filter(([, r]) => r.client_only?.ok === true)
        .map(([route]) => route);

      const summary = {
        account: account?.alias,
        probed: probeList.length,
        timestamp: new Date().toISOString(),
        criticalFindings: allFindings.filter(f => f.findings.some(x => x.severity === 'CRITICAL')),
        highFindings: allFindings.filter(f => f.findings.some(x => x.severity === 'HIGH')),
        clientOnlySuccesses,
        mgmtKeyCredits,
        note: clientOnlySuccesses.length > 0
          ? '⚠️ Some routes work with __client only — JWT may be optional (tRPC replay viable)'
          : 'No client-only auth successes detected',
      };

      logger.info(`[DEBUG] tRPC probe complete: ${allFindings.length} finding groups, ${clientOnlySuccesses.length} client-only successes`);

      return this.success(res, { summary, routes: results, findings: allFindings });
    } catch (err) {
      logger.error(`[DEBUG] tRPC probe failed: ${err.message}`);
      return this.error(res, err.message);
    }
  }

  /**
   * POST /api/debug/vampire-mode
   * Body: { accountId }
   *
   * Fire updateProfile no-op toggle to reset session TTL.
   * Hypothesis: forces fresh JWT timestamp, extending the 7-day window.
   */
  async vampireMode(req, res) {
    const { accountId } = req.body ?? {};
    if (!accountId) return this.error(res, 'accountId required', 400);

    try {
      const session = await store.getAccountSession(req.user.id, accountId);
      if (!session?.sessionCookie) return this.error(res, 'No active session', 400);

      const { sessionCookie, clientCookie } = session;
      const cookieHeader = dashboardCookieHeader(sessionCookie, clientCookie);
      const OR_ORIGIN = new URL(OR_BASE).origin;

      // Read current bio first, then write it back unchanged (true no-op).
      // The goal is a new JWT being issued, not a visible profile change.
      let currentBio = '';
      try {
        const profileUrl = `${OR_BASE}/api/trpc/user.getProfile?batch=1`;
        const profileRes = await fetch(profileUrl, {
          headers: {
            'Cookie': cookieHeader,
            'Origin': OR_ORIGIN,
            'Referer': `${OR_ORIGIN}/settings`,
            'x-trpc-source': 'nextjs-react',
          },
        });
        if (!profileRes.ok) {
          logger.warn(`[DEBUG] vampire profile preload returned HTTP ${profileRes.status} for account=${accountId}`);
        }
        let profileData = null;
        try {
          profileData = await profileRes.json();
        } catch (err) {
          logger.warn(`[DEBUG] vampire profile preload returned invalid JSON for account=${accountId}: ${err?.message || err}`);
        }
        currentBio = profileData?.[0]?.result?.data?.json?.bio ?? '';
      } catch (err) {
        logger.warn(`[DEBUG] vampire profile preload failed for account=${accountId}: ${err?.message || err}`);
      }

      const results = [];

      for (const bio of [currentBio, currentBio]) {
        const url = `${OR_BASE}/api/trpc/user.updateProfile?batch=1`;
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': cookieHeader,
              'Origin': OR_ORIGIN,
              'Referer': `${OR_ORIGIN}/settings`,
              'x-trpc-source': 'nextjs-react',
            },
            body: JSON.stringify({ '0': { json: { bio } } }),
          });
          const text = await r.text();
          let parsed = null;
          try { parsed = JSON.parse(text); } catch { /* raw */ }
          results.push({ bio, status: r.status, result: extractTrpcResult(parsed) });
          // Small delay between mutations
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (err) {
          results.push({ bio, error: err.message });
        }
      }

      // Check if a new Set-Cookie was issued (session TTL reset)
      const gotNewSession = results.some(r => r.result?.ok);

      return this.success(res, {
        results,
        gotNewSession,
        note: gotNewSession
          ? 'updateProfile succeeded — session touch fired. Check if JWT exp refreshed.'
          : 'updateProfile failed or returned error — vampire mode not viable on this account.',
      });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  /**
   * POST /api/debug/cookie-ttl
   * Body: { accountId }
   *
   * Test how stale a __client cookie can be before Clerk rejects it.
   * Returns the Clerk /v1/client response for this account's stored client cookie.
   */
  async cookieTtl(req, res) {
    const { accountId } = req.body ?? {};
    if (!accountId) return this.error(res, 'accountId required', 400);

    try {
      const session = await store.getAccountSession(req.user.id, accountId);
      const account = await store.getAccountWithKey(req.user.id, accountId);

      // Check both stacked array and legacy string — either suffices
      const hasAnyCookie = session?.clientCookie || session?.clientCookies?.length > 0;
      if (!hasAnyCookie) return this.error(res, 'No client cookie stored for this account', 400);

      const CLERK_BASE_URL = 'https://clerk.openrouter.ai/v1';
      // Use best available: newest in stack, or legacy string
      const clientCookie = session.clientCookies?.[0]?.cookie || session.clientCookie;
      const cookieHeader = clerkFapiDeviceCookieHeader(clientCookie);

      // Probe Clerk directly with the stored __client cookie
      const r = await fetch(`${CLERK_BASE_URL}/client`, {
        headers: {
          'Cookie': cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Origin': 'https://openrouter.ai',
        },
      });

      const text = await r.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* raw */ }

      // Extract session info from the response
      const sessionInfo = extractClerkSessionInfo(parsed);

      return this.success(res, {
        account: account?.alias,
        clientCookieLength: clientCookie.length,
        httpStatus: r.status,
        isValid: r.ok && sessionInfo.hasActiveSession,
        sessionInfo,
        // Include the raw for full analysis but clip for safety
        raw: JSON.stringify(parsed).slice(0, 5000),
      });
    } catch (err) {
      return this.error(res, err.message);
    }
  }
}

// ─── Extract session info from Clerk /v1/client response ─────────────────────
function extractClerkSessionInfo(parsed) {
  const response = parsed?.response ?? parsed;
  const client = response?.client ?? response;
  const sessions = client?.sessions ?? [];
  const activeSessions = Array.isArray(sessions)
    ? sessions.filter(s => s.status === 'active')
    : [];

  return {
    hasActiveSession: activeSessions.length > 0,
    sessionCount: Array.isArray(sessions) ? sessions.length : 0,
    activeSessions: activeSessions.map(s => ({
      id: s.id,
      status: s.status,
      expireAt: s.expire_at,
      lastActiveAt: s.last_active_at,
      userId: s.user_id,
    })),
    userId: client?.last_active_session_id ? '(present)' : null,
  };
}

export default new DebugController();
