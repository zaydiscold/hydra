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
  getJwtExpiry,
  signInWithPassword,
  refreshSession,
  validateSession,
  NeedSecondFactorError,
  openRouterDashboardDeviceCookies,
  openRouterPlaywrightDeviceCookies,
} from './clerk-auth.js';
import * as store from './store.js';
import { getCredits } from './openrouter.js';

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

/** Management key material in tRPC JSON or page text (OpenRouter prefix). */
const MGMT_KEY_RE = /sk-or-mgmt-[A-Za-z0-9_.-]+/;

function provisionNetworkLogEnabled() {
  return config.HYDRA_PROVISION_NETWORK_LOG || provisionDebugArtifactsEnabled();
}

function truncateForLog(s, max = 2000) {
  if (!s || typeof s !== 'string') return '';
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

/**
 * Extract sk-or-mgmt-* from raw tRPC response text: regex first, then JSON batch / result shapes.
 */
function findManagementKeyDeep(value, depth = 0) {
  if (depth > 14 || value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const m = value.match(MGMT_KEY_RE);
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
  const direct = value.key ?? value.managementKey ?? value.apiKey;
  if (typeof direct === 'string' && direct.startsWith('sk-or-mgmt-')) return direct;
  for (const v of Object.values(value)) {
    const k = findManagementKeyDeep(v, depth + 1);
    if (k) return k;
  }
  return null;
}

function extractManagementKeyFromResponseBody(body) {
  if (!body || typeof body !== 'string') return null;
  const reMatch = body.match(MGMT_KEY_RE);
  if (reMatch) return reMatch[0];
  try {
    const data = JSON.parse(body);
    const fromPayload = (d) => {
      if (!d || typeof d !== 'object') return null;
      const key = d.key ?? d.managementKey ?? d.apiKey;
      return typeof key === 'string' && key.startsWith('sk-or-mgmt-') ? key : null;
    };
    if (Array.isArray(data)) {
      for (const item of data) {
        const inner = item?.result?.data?.json ?? item?.result?.data ?? item?.result;
        const k = fromPayload(inner);
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

async function persistProvisionedManagementKey(userId, accountId, key, source = 'unknown') {
  if (!key || typeof key !== 'string' || !key.startsWith('sk-or-mgmt-')) {
    const err = new Error('Provisioning returned an invalid management key format');
    err.code = 'PROVISION_INVALID_KEY_FORMAT';
    err.source = source;
    throw err;
  }

  await store.updateAccountManagementKey(userId, accountId, key);
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
function normalizeDiscoveredCreateRoute(pathSegment) {
  if (!pathSegment) return null;
  const decoded = decodeURIComponent(pathSegment.split('?')[0] || '');
  const parts = decoded.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return decoded || null;
  const prefer = parts.find((p) => /create/i.test(p) && /management|key/i.test(p));
  if (prefer) return prefer;
  const createish = parts.find((p) => /create/i.test(p));
  return createish || parts[0];
}

async function writeProvisionNetworkLog(accountId, lines) {
  if (!lines.length) return;
  try {
    const dir = join(tmpdir(), 'hydra-provision-debug');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `provision-network-${accountId}-${Date.now()}.log`);
    const header = `# Hydra provision network log — ${new Date().toISOString()} — accountId=${accountId}\n# POST URL, status, postData only (no response bodies — avoids consuming Playwright response streams).\n\n`;
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
  return config.HYDRA_PROVISION_VERBOSE || config.HYDRA_PROVISION_DEBUG;
}

function provisionStepLog(accountId, message, extra = undefined) {
  if (!provisionStepLogEnabled()) return;
  if (extra !== undefined) console.error(`[dashboard-api] provision[${accountId}] ${message}`, extra);
  else console.error(`[dashboard-api] provision[${accountId}] ${message}`);
}

/** Strip key-like material from stderr previews (management + standard key prefixes). */
function redactSensitiveForProvisionLog(s, max = 480) {
  if (!s || typeof s !== 'string') return '';
  const clipped = s.length > max ? `${s.slice(0, max)}…` : s;
  return clipped.replace(/sk-or-[a-z0-9_.-]{8,}/gi, '[REDACTED]');
}

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
  console.error('[dashboard-api] Management key Playwright failure context', {
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

function dashboardHeaders(sessionCookie, clientCookie, extra = {}) {
  const device = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  return {
    'Content-Type': 'application/json',
    'Cookie': `__session=${sessionCookie}${device ? `; ${device}` : ''}`,
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

  if (session.sessionCookie) {
    const derivedExpiry = store.resolveEffectiveSessionExpiry(
      { sessionExpiry: session.sessionExpiry },
      session.sessionCookie,
    );
    if (isSessionValid(derivedExpiry)) {
      if (!session.sessionExpiry && derivedExpiry) {
        await store.updateAccountSession(
          userId,
          accountId,
          session.sessionCookie,
          session.clientCookie,
          derivedExpiry,
        );
      }
      return { sessionCookie: session.sessionCookie, clientCookie: session.clientCookie };
    }
  }

  if (session.clientCookie) {
    const refreshed = await refreshSession(session.clientCookie);
    if (refreshed) {
      const cc = refreshed.clientCookie ?? session.clientCookie;
      await store.updateAccountSession(userId, accountId, refreshed.sessionCookie, cc, refreshed.sessionExpiry);
      return { sessionCookie: refreshed.sessionCookie, clientCookie: cc };
    }
  }

  if (session.sessionCookie && (await validateSession(session.sessionCookie))) {
    const expiry = store.resolveEffectiveSessionExpiry(
      { sessionExpiry: session.sessionExpiry },
      session.sessionCookie,
    );
    await store.updateAccountSession(
      userId,
      accountId,
      session.sessionCookie,
      session.clientCookie,
      expiry,
    );
    return { sessionCookie: session.sessionCookie, clientCookie: session.clientCookie };
  }

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

  throw new Error(`Session expired for account ${accountId} and no credentials available for re-auth. Please log in again.`);
}

/**
 * Offline check: does this account have any path ensureSession() can use without user interaction?
 * Mirrors ensureSession order except network calls (refreshSession, validateSession).
 */
function evaluateRedeemSessionReadiness(account, session) {
  const sessionCookie = session.sessionCookie?.trim();
  const hasSession = Boolean(sessionCookie);
  const derivedExpiry = hasSession
    ? store.resolveEffectiveSessionExpiry({ sessionExpiry: session.sessionExpiry }, sessionCookie)
    : null;
  if (hasSession && isSessionValid(derivedExpiry || getJwtExpiry(sessionCookie))) {
    return { ready: true, detail: 'session_valid' };
  }
  if (session.clientCookie?.trim()) {
    return { ready: true, detail: 'client_refresh' };
  }
  if (hasSession) {
    return { ready: true, detail: 'session_validate' };
  }
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

/** Headers merged after defaults; use to override Referer per surface (e.g. redeem vs management keys). */
async function trpcCall(route, input, sessionCookie, clientCookie, headerOverrides = {}) {
  const url = `${OR_BASE}/api/trpc/${route}?batch=1`;
  const body = JSON.stringify({ '0': { json: input } });

  const res = await fetch(url, {
    method: 'POST',
    headers: dashboardHeaders(sessionCookie, clientCookie, headerOverrides),
    body,
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const err = new Error(`tRPC route ${route} returned HTML — likely wrong format or auth failed`);
    err.isHtml = true;
    err.status = res.status;
    throw err;
  }

  const data = await res.json();

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
  if (err.isHtml && (err.status === 401 || err.status === 403)) return true;
  if ([401, 403, 423, 429].includes(err.httpStatus)) return true;
  return false;
}

export async function createManagementKey(userId, accountId, keyName = 'Hydra Auto Key') {
  const { sessionCookie, clientCookie } = await ensureSession(userId, accountId);
  const endpoints = await store.getDiscoveredEndpoints();
  const endpoint = endpoints.createManagementKey;

  const mgmtKeyPayloads = [{ name: keyName }, { label: keyName }];

  if (endpoint) {
    for (const input of mgmtKeyPayloads) {
      try {
        const result = await trpcCall(endpoint.route, input, sessionCookie, clientCookie);
        if (result?.key || result?.managementKey) {
          const key = result.key || result.managementKey;
          if (!key.startsWith('sk-or-mgmt-')) {
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
    'management.createManagementKey',
    'apiKeys.createManagement',
  ];
  let lastTrpcError = null;
  for (const route of candidates) {
    for (const input of mgmtKeyPayloads) {
      try {
        console.error(`[dashboard-api] Trying tRPC route: ${route} with payload: ${JSON.stringify(input)}`);
        const result = await trpcCall(route, input, sessionCookie, clientCookie);
        console.error(`[dashboard-api] tRPC route ${route} result:`, { hasResult: !!result, keys: Object.keys(result || {}) });
        const key = result?.key || result?.managementKey || result?.apiKey;
        if (key && key.startsWith('sk-or-mgmt-')) {
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

  console.error(`[dashboard-api] All tRPC routes exhausted, falling back to Playwright. Last error: ${lastTrpcError?.message || 'none'}`);
  return await createManagementKeyViaPlaywright(userId, accountId, sessionCookie, clientCookie, keyName);
}

async function playwrightCookiesForOpenRouter(sessionCookie, clientCookie) {
  const base = openRouterPlaywrightDeviceCookies(clientCookie).map((c) => ({
    ...c,
    domain: OR_HOSTNAME,
  }));
  return [{ name: '__session', value: sessionCookie, domain: OR_HOSTNAME, path: '/' }, ...base];
}

async function clickFirstVisibleCreateControl(page) {
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
  // Fallback: any visible text input in the dialog (for UI variants with unlabeled inputs)
  const nameByFallback = scope.locator('[role="dialog"] input[type="text"], [role="dialog"] input:not([type="hidden"])').first();

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
    await saveBtn.click();
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
  // Also try pressing Enter in case the form responds to keyboard submission
  await nameInput.press('Enter');
}

async function createManagementKeyViaPlaywright(userId, accountId, sessionCookie, clientCookie, keyName) {
  const { chromium } = await import('playwright');
  const headless = !config.HYDRA_PLAYWRIGHT_HEADED;
  const browser = await chromium.launch({ headless });
  let page;
  let context;
  let capturedKey = null;
  const networkLogLines = [];
  let traceStarted = false;

  try {
    context = await browser.newContext({ userAgent: USER_AGENT });
    await context.addCookies(await playwrightCookiesForOpenRouter(sessionCookie, clientCookie));
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
          // Response bodies are streams - once consumed by response.text(), they become empty
          // for other handlers. The waitForResponse predicates need to consume the body
          // to extract the management key. Debug body content is captured via tracing instead.
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

    const clicked = await clickFirstVisibleCreateControl(page);
    if (!clicked) {
      console.warn('[dashboard-api] No create/add control matched on management-keys; continuing');
    }
    provisionStepLog(accountId, 'after create/add control click attempt', { clicked });
    await page.waitForTimeout(1200);

    /** Set after a matching response is parsed — persist outside the predicate to avoid store I/O in the waiter. */
    let capturedFromWait = null;
    let discoveredRouteFromWait = null;

    const trpcKeyWait = page
      .waitForResponse(
        async (response) => {
          const url = response.url();
          if (!url.includes('/api/trpc/') || response.request().method() !== 'POST') return false;
          const rawPath = new URL(url).pathname.split('/api/trpc/')[1]?.split('?')[0] ?? '';
          try {
            const body = await response.text();
            const key = extractManagementKeyFromResponseBody(body);
            if (provisionDebugArtifactsEnabled()) {
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
            }
            if (!key) return false;
            capturedFromWait = key;
            discoveredRouteFromWait = normalizeDiscoveredCreateRoute(rawPath);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 35000 },
      )
      .catch(() => null);

    /** Next.js Server Actions / RSC sometimes POST to app routes instead of `/api/trpc/`. */
    const rscKeyWait = page
      .waitForResponse(
        async (response) => {
          const url = response.url();
          if (!url.startsWith(OR_ORIGIN) || response.request().method() !== 'POST') return false;
          if (url.includes('/api/trpc/')) return false;
          if (/\.(png|jpe?g|gif|webp|svg|woff2?|ico|css|js)(\?|$)/i.test(url)) return false;
          const pathname = new URL(url).pathname;
          try {
            const body = await response.text();
            const key = extractManagementKeyFromResponseBody(body);
            if (provisionDebugArtifactsEnabled()) {
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
            if (!key) return false;
            capturedFromWait = key;
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 35000 },
      )
      .catch(() => null);

    await fillManagementKeyNameAndSubmit(page, keyName, accountId);
    provisionStepLog(accountId, 'after fill name and submit');
    await Promise.race([trpcKeyWait, rscKeyWait]);
    if (capturedFromWait) capturedKey = capturedFromWait;
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
      await page.getByText(MGMT_KEY_RE).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Fallback 2: scan page textContent (catches text nodes, but NOT input .value)
    if (!capturedKey) {
      const pageText = await page.textContent('body');
      const match = pageText?.match(MGMT_KEY_RE);
      if (match) capturedKey = match[0];
      if (capturedKey) provisionStepLog(accountId, 'Found key in page textContent');
    }

    // Fallback 3: scan ALL input/textarea .value properties via evaluate()
    // page.textContent() does NOT include <input value="..."> — this is the critical gap.
    if (!capturedKey) {
      capturedKey = await page.evaluate((keyPattern) => {
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

    // Fallback 4: look specifically in the dialog/modal that appeared after form submit
    if (!capturedKey) {
      const dialog = managementDialog(page);
      if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
        const dialogText = await dialog.innerText().catch(() => '');
        const match = dialogText?.match(MGMT_KEY_RE);
        if (match) {
          capturedKey = match[0];
          provisionStepLog(accountId, 'Found key in dialog innerText');
        }
      }
    }

    // Fallback 5: try clipboard API (some UIs auto-copy the key on creation)
    // Note: This rarely works in headless mode due to clipboard permissions, but try anyway.
    if (!capturedKey) {
      const mgmtKeyPattern = MGMT_KEY_RE.source;
      capturedKey = await page.evaluate(async (pattern) => {
        try {
          const text = await navigator.clipboard.readText();
          const re = new RegExp(pattern);
          const m = text.match(re);
          return m ? m[0] : null;
        } catch { return null; }
      }, mgmtKeyPattern).catch(() => null);
      if (capturedKey) provisionStepLog(accountId, 'Found key in clipboard');
    }

    // Fallback 6: if still no key, log ALL visible input values and dialog text for post-mortem
    if (!capturedKey) {
      if (provisionDebugArtifactsEnabled()) {
        const allInputValues = await page.evaluate(() => {
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
        const fullPageInner = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || '').catch(() => '');
        console.error('[dashboard-api] provision: page innerText preview', { accountId, preview: redactSensitiveForProvisionLog(fullPageInner, 2000) });
      }
      throw new Error('Could not extract management key via Playwright');
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
        console.error('[dashboard-api] Provision Playwright trace saved', { accountId, path: zip });
      } catch (te) {
        console.error('[dashboard-api] Could not save provision trace:', te.message);
      }
      traceStarted = false;
    }
    const extractFail =
      err && typeof err.message === 'string' && err.message.includes('Could not extract management key via Playwright');
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

/** Parse tRPC batch or single JSON from a browser HTTP response (same rules as trpcCall). */
function parseTrpcRedeemHttpBody(bodyText, httpStatus = 200) {
  if (!bodyText || typeof bodyText !== 'string') return { kind: 'unparseable' };
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    return { kind: 'unparseable' };
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

/** Order: tRPC (fast, bulk-friendly) then Playwright (UI parity, discovery). Browser is fallback, not default. */
export async function redeemCode(userId, accountId, code) {
  const { sessionCookie, clientCookie } = await ensureSession(userId, accountId);
  const endpoints = await store.getDiscoveredEndpoints();
  if (endpoints.redeemCode) {
    try {
      const result = await trpcCall(endpoints.redeemCode.route, { code }, sessionCookie, clientCookie, REDEEM_TRPC_HEADERS);
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

  const candidates = ['credits.redeemCode', 'credits.redeem', 'credits.applyCode', 'voucher.redeem', 'code.redeem', 'promo.redeem', 'account.redeem'];
  for (const route of candidates) {
    try {
      const result = await trpcCall(route, { code }, sessionCookie, clientCookie, REDEEM_TRPC_HEADERS);
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
  // Use sequential for...of instead of Promise.all to prevent Playwright OOM crashes when bulk redeeming
  const results = [];
  for (const id of accountIds) {
    try {
      const account = await store.getAccountWithKey(userId, id);
      const result = await redeemCode(userId, id, code);
      results.push({ accountId: id, alias: account.alias, ...result });
    } catch (err) {
      console.error('[DASHBOARD] Fetch failed:', err.message);
      const { errorCode, message } = classifyRedeemFailure(err.message, err);
      results.push({ accountId: id, success: false, message, error: message, errorCode });
    }
  }
  return results;
}

export async function getUserProfile(sessionCookie, clientCookie) {
  const res = await fetch(`${OR_BASE}/api/auth/me`, {
    headers: dashboardHeaders(sessionCookie, clientCookie, { Referer: `${OR_ORIGIN}/settings` }),
  });
  if (res.ok) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
  }

  try {
    return await trpcCall('user.me', null, sessionCookie, clientCookie);
  } catch {
    return null;
  }
}
