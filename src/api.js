const API = '/api';
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRY_DELAY_MS = 150;

/** Map API `source` to UI label (API may still return `playwright` for browser automation). */
export function formatProvisionSourceForUi(source) {
  if (source === 'playwright') return 'browser-ui';
  return source ?? '';
}

/** Formats structured `details` from provision and similar API errors (no secrets). */
export function formatProvisionDetailsAppendix(details) {
  if (!details || typeof details !== 'object') return '';
  const lines = [];
  if (details.stage) lines.push(`Stage: ${details.stage}`);
  if (Array.isArray(details.phasesTried) && details.phasesTried.length) {
    lines.push(`Phases tried: ${details.phasesTried.join(' → ')}`);
  }
  if (details.trpcLastRoute) lines.push(`Last tRPC route (HTTP): ${details.trpcLastRoute}`);
  if (details.trpcLastHttp != null || details.trpcLastCode != null) {
    lines.push(
      `Last tRPC HTTP: ${details.trpcLastHttp ?? '—'}${details.trpcLastCode != null ? ` (code ${details.trpcLastCode})` : ''}`,
    );
  }
  if (details.connectMode) lines.push(`Browser: ${details.connectMode}`);
  if (details.pageUrlAtFailure) lines.push(`Page URL at failure: ${details.pageUrlAtFailure}`);
  if (details.trpcLastError) lines.push(`Last tRPC (HTTP phase): ${details.trpcLastError}`);
  if (details.trpcBusinessMessage) lines.push(`Dashboard mutation error: ${details.trpcBusinessMessage}`);
  if (details.trpcBusinessCode != null) lines.push(`Dashboard mutation code: ${details.trpcBusinessCode}`);
  if (details.createClicked != null) lines.push(`Create control clicked: ${details.createClicked}`);
  if (details.fallbacksExhausted) lines.push(`Fallbacks: ${details.fallbacksExhausted}`);
  if (details.debugDir) lines.push(`Artifacts: ${details.debugDir}`);
  return lines.length ? lines.join('\n') : '';
}

/** Appends server `hint`, Clerk debug hint (CLERK_DEBUG_OTP), and structured `details`. */
export function formatApiErrorMessage(err) {
  if (!err?.message) return 'Request failed';
  
  // Special handling for Google OAuth OTP requirement
  if (err.message?.includes('GOOGLE_OAUTH_REQUIRES_OTP')) {
    return 'This Google OAuth account requires OTP verification before provisioning.\n\n' +
           'Steps to fix:\n' +
           '1. Click "Authenticate" on this account\n' +
           '2. Select "Email OTP" method\n' +
           '3. Enter the 6-digit code from your email\n' +
           '4. Once authenticated, retry "Provision Key"';
  }
  
  const parts = [err.message];
  if (err.hint) parts.push(err.hint);
  if (err.clerkDebugHint) parts.push(err.clerkDebugHint);
  const detailBlock = formatProvisionDetailsAppendix(err.details);
  if (detailBlock) parts.push(detailBlock);
  return parts.join('\n\n');
}

/** Shown when fetch fails in Vite dev — starts API + UI together. */
export const HYDRA_DEV_START_COMMAND = 'npm run dev';
/** API only (if UI is already served elsewhere). */
export const HYDRA_DEV_API_ONLY_COMMAND = 'npm run server';

function getToken() {
  return localStorage.getItem('hydra_token') || '';
}

function isRetryableRequest(method) {
  return method === 'GET';
}

function isRetryableResponseStatus(status) {
  return RETRYABLE_STATUSES.has(status);
}

function isAbortError(err) {
  return err?.name === 'AbortError';
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let activeRequests = 0;
let handledAuthFailure = false;
function updateLoadingState() {
  window.dispatchEvent(new CustomEvent('hydra-loading', { detail: { active: activeRequests > 0 } }));
}

async function request(path, options = {}) {
  const { method = 'GET', body, skipAuth = false, signal, keepalive = false } = options;
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json' };
  if (!skipAuth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const fetchOptions = { method: normalizedMethod, headers, signal, keepalive };
  if (body) fetchOptions.body = JSON.stringify(body);
  const attempts = isRetryableRequest(normalizedMethod) ? 2 : 1;

  activeRequests++;
  updateLoadingState();

  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let res;
      try {
        res = await fetch(`${API}${path}`, fetchOptions);
      } catch (fetchErr) {
        if (attempt < attempts && !isAbortError(fetchErr)) {
          await wait(RETRY_DELAY_MS * attempt);
          continue;
        }
        const dev = import.meta.env.DEV;
        const msg = dev
          ? 'Hydra API unreachable — the Express backend is not running. From the project folder run npm run dev (starts API + UI together) or npm run server for the API only, then refresh.'
          : 'Hydra API unavailable. Check that the local server is running.';
        const err = new Error(msg);
        if (dev) err.hydraCopyCommand = HYDRA_DEV_START_COMMAND;
        throw err;
      }

      if (res.status === 401) {
        // Never reload on intentional auth endpoints - they handle errors in the UI
        if (path.startsWith('/auth/')) {
          let errMsg = 'Invalid credentials';
          try { const d = await res.clone().json(); errMsg = d?.error || errMsg; } catch (err) { void err; }
          throw new Error(errMsg);
        }
        clearToken();
        if (!handledAuthFailure) {
          handledAuthFailure = true;
          window.location.reload();
        }
        const err = new Error('Authentication expired. Sign in again.');
        err.status = 401;
        err.code = 'AUTH_EXPIRED';
        throw err;
      }

      if (!res.ok && attempt < attempts && isRetryableResponseStatus(res.status)) {
        await wait(RETRY_DELAY_MS * attempt);
        continue;
      }

      let data;
      try {
        data = await res.json();
      } catch {
        if (attempt < attempts && isRetryableResponseStatus(res.status)) {
          await wait(RETRY_DELAY_MS * attempt);
          continue;
        }
        throw new Error('Hydra API returned an invalid response.');
      }

      if (!res.ok) {
        const msg = data?.error || `Request failed (${res.status})`;
        const err = new Error(msg);
        err.status = res.status;
        if (data?.code) err.code = data.code;
        if (data?.hint) err.hint = data.hint;
        if (data?.details != null) err.details = data.details;
        if (data?.legacyCode) err.legacyCode = data.legacyCode;
        if (data?.debugDir) err.debugDir = data.debugDir;
        if (data?.clerkDebugOtp && data?.clerkDebugHint) {
          err.clerkDebugHint = data.clerkDebugHint;
        }
        throw err;
      }

      if (res.status === 202 && data?.requiresTwoFactor) {
        const e = new Error('NEEDS_2FA');
        e.requiresTwoFactor = true;
        if (data.signInId) e.signInId = data.signInId;
        throw e;
      }

      return data;
    }
  } finally {
    activeRequests--;
    updateLoadingState();
  }
}


// Auth
export const getAuthStatus = () => request('/auth/status');
export const setupPassword = (password) =>
  request('/auth/setup', { method: 'POST', body: { password }, skipAuth: true });
export const login = (password) =>
  request('/auth/login', { method: 'POST', body: { password }, skipAuth: true });
export const logout = () => request('/auth/logout', { method: 'POST' });
export const changePassword = (currentPassword, newPassword) =>
  request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
export const nukeApp = (password) =>
  request('/auth/nuke', { method: 'POST', body: { password, confirm: 'NUKE_HYDRA' }, skipAuth: true });
export const shutdownServer = () =>
  request('/shutdown', { method: 'POST', body: { confirm: 'SHUTDOWN_HYDRA' } });

export function saveToken(token) {
  handledAuthFailure = false;
  localStorage.setItem('hydra_token', token);
}
export function clearToken() {
  localStorage.removeItem('hydra_token');
}
export function hasToken() {
  return !!getToken();
}

// Dashboard
export const getDashboard = () => request('/dashboard');

// Accounts
export const getAccounts = () => request('/accounts');
export const addAccount = (alias, managementKey) =>
  request('/accounts', { method: 'POST', body: { alias, managementKey } });
export const addAccountWithCredentials = (alias, email, password, authMethod) =>
  request('/accounts/with-credentials', { method: 'POST', body: { alias, email, password, authMethod } });
export const bulkAddAccounts = (lines) =>
  request('/accounts/bulk', { method: 'POST', body: { lines } });
/** Create OTP-only vault rows from emails only (Bulk Auth wizard). */
export const bulkOtpStubs = (emails) =>
  request('/accounts/bulk-otp-stubs', { method: 'POST', body: { emails } });
export const updateAccount = (id, updates) =>
  request(`/accounts/${id}`, { method: 'PATCH', body: updates });
export const deleteAccount = (id) => request(`/accounts/${id}`, { method: 'DELETE' });
export const getAccountSnapshot = (id) => request(`/accounts/${id}/snapshot`);
export const getAccountManagementKey = (id) => request(`/accounts/${id}/management-key`);

// Auth flows
export const detectAuthMethod = (id) =>
  request(`/accounts/${id}/detect-auth`, { method: 'POST' });
export const loginAccount = (id, password) =>
  request(`/accounts/${id}/login`, { method: 'POST', body: { password } });
export const startOTP = (id, email) =>
  request(`/accounts/${id}/otp/start`, { method: 'POST', body: { email } });
export const verifyOTP = (id, signInId, code, options = {}) =>
  request(`/accounts/${id}/otp/verify`, {
    method: 'POST',
    body: { ...options, signInId, code },
  });
export const refreshAccountLogin = (id) =>
  request(`/accounts/${id}/refresh-login`, { method: 'POST' });
export const silentRefreshSession = (id) =>
  request(`/accounts/${id}/refresh`, { method: 'POST' });
export const getSessionStatus = (id) => request(`/accounts/${id}/session-status`);
export const checkSessionLive = (id) => request(`/accounts/${id}/session-check`);
export const silentRefreshOnly = (id) => request(`/accounts/${id}/silent-refresh`, { method: 'POST' });

// Magic link (email_link strategy)
export const sendMagicLink = (id, email) =>
  request(`/accounts/${id}/magic-link/send`, { method: 'POST', body: { email } });
export const getMagicLinkStatus = (id, signInId) =>
  request(`/accounts/${id}/magic-link/status/${encodeURIComponent(signInId)}`);

// Provisioning
export const provisionManagementKey = (id, keyName) =>
  request(`/accounts/${id}/provision`, { method: 'POST', body: { keyName } });
export const provisionAll = () =>
  request('/accounts/provision-all', { method: 'POST' });

// Keys
export const getKeys = (accountId) => request(`/accounts/${accountId}/keys`);
export const createKey = (accountId, data) =>
  request(`/accounts/${accountId}/keys`, { method: 'POST', body: data });
export const updateKey = (accountId, hash, updates) =>
  request(`/accounts/${accountId}/keys/${hash}`, { method: 'PATCH', body: updates });
export const deleteKey = (accountId, hash) =>
  request(`/accounts/${accountId}/keys/${hash}`, { method: 'DELETE' });

// Code Redemption
export const redeemCode = (accountId, code) =>
  request('/codes/redeem', { method: 'POST', body: { accountId, code } });
export const bulkRedeemCode = (accountIds, code) =>
  request('/codes/bulk', { method: 'POST', body: { accountIds, code } });
export const bulkMatrixRedeem = (assignments) =>
  request('/codes/bulk-matrix', { method: 'POST', body: { assignments } });
export const preflightRedeemAccounts = (accountIds) =>
  request('/codes/preflight', { method: 'POST', body: { accountIds } });
export const getDiscoveredEndpoints = () => request('/codes/endpoints');
export const getRedemptionLogs = () => request('/codes/history');

// Generator
export const startGeneratorJob = (emailTemplate, password, count) => 
  request('/generator/start', { method: 'POST', body: { emailTemplate, password, count } });
export const getGeneratorJobStatus = (taskId, signal) => 
  request(`/generator/status/${taskId}`, { signal });
export const heartbeatGeneratorJob = (taskId, signal) =>
  request(`/generator/${taskId}/heartbeat`, { method: 'POST', signal });
export const submitGeneratorOtp = (taskId, otp) => 
  request(`/generator/verify/${taskId}`, { method: 'POST', body: { otp } });
export const cleanupGeneratorJob = (taskId, reason = 'cancelled', options = {}) => 
  request(`/generator/${taskId}`, { method: 'DELETE', body: { reason }, ...options });

// Pool Manager
export const getPoolData = () => request('/pool');
export const getPoolStatus = () => request('/pool/status');
export const getMasterKey = () => request('/pool/master-key');
export const getNetworkInfo = () => request('/pool/network');
export const reloadPool = () => request('/pool/reload', { method: 'POST' });
export const toggleKeyPooled = (hash, isPooled) =>
  request(`/pool/key/${hash}`, { method: 'PATCH', body: { isPooled } });
export const toggleAccountPooled = (accountId, isPooled) =>
  request(`/pool/account/${accountId}/toggle`, { method: 'POST', body: { isPooled } });
export const registerKeyString = (hash, keyString) =>
  request(`/pool/key/${hash}/register`, { method: 'POST', body: { keyString } });
export const refreshModels = () => request('/pool/models/refresh', { method: 'POST' });
export const autoProvisionPoolKey = (accountId) =>
  request(`/pool/auto-provision/${accountId}`, { method: 'POST' });
export const syncPoolKeys = (accountId) =>
  request(`/pool/sync-keys/${accountId}`, { method: 'POST' });
export const disablePoolKey = (hash, disabled) =>
  request(`/pool/key/${hash}/disable`, { method: 'PATCH', body: { disabled } });
export const deletePoolKey = (hash) =>
  request(`/pool/key/${hash}`, { method: 'DELETE' });
export const getTraffic = () => request('/pool/traffic');
export const getPoolModels = () => request('/pool/models');
export const getPoolSyncStatus = () => request('/pool/sync-status');
export const rotateMasterKey = () => request('/pool/rotate-master-key', { method: 'POST' });

// System
export const getSystemTasks = () => request('/system/tasks');
export const cancelSystemTask = (taskId, reason = 'operator_cancelled') => request(`/system/tasks/${taskId}/cancel`, { method: 'POST', body: { reason } });
export const getSystemHealth = () => request('/system/health');
export const getProxyStatus = () => request('/system/proxy-status');
export const toggleProxy = (enabled) => request('/system/proxy-toggle', { method: 'POST', body: { enabled } });

// Test a stored key against OpenRouter /auth/key
export const testKey = (accountId, hash) =>
  request(`/accounts/${accountId}/keys/${hash}/test`, { method: 'POST' });

// Management Key Storage (New)
export const getManagementKeys = (accountId) => request(`/accounts/${accountId}/management-keys`);
export const getBestManagementKey = (accountId) => request(`/accounts/${accountId}/management-keys/best`);
export const storeManagementKey = (accountId, key, name, metadata) =>
  request(`/accounts/${accountId}/management-keys/store`, { method: 'POST', body: { key, name, metadata } });

export const importManagementKey = (accountId, key, name) =>
  request(`/accounts/${accountId}/management-keys/store`, { method: 'POST', body: { key, name } });

export const revokeManagementKey = (accountId, keyId) =>
  request(`/accounts/${accountId}/management-keys/${keyId}`, { method: 'DELETE' });
