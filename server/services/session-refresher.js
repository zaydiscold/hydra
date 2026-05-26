/**
 * session-refresher.js — P13
 * Proactively refreshes Clerk sessions before they expire.
 * Runs after a quiet startup delay, then every 6 hours.
 * Silently skips OTP-only accounts (no clientCookie = can't refresh).
 *
 * Exploit #14: Cookie stacking — iterates clientCookies newest-first,
 * pops dead ones, appends fresh __client from response.
 */

import { prisma } from './db.js';
import { updateAccountSession, logAccountEvent, getLatestClientCookie, normalizeClientCookies } from './store.js';
import { refreshSession, extractNewClientCookie } from './clerk-auth.js';
import { logger } from './logger.js';
import { decrypt, encryptConfig } from './storage-codec.js';

const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000; // probe within 24h of expiry
const INTERVAL_MS = 6 * 60 * 60 * 1000; // run every 6h
const STARTUP_DELAY_MS = Number(process.env.HYDRA_SESSION_REFRESH_STARTUP_DELAY_MS || 5 * 60 * 1000);
const SESSION_PROBE_ENABLED = process.env.HYDRA_SESSION_LIFETIME_PROBE === '1';
const SESSION_PROBE_INTERVAL_MS = Number(process.env.HYDRA_SESSION_LIFETIME_PROBE_INTERVAL_MS || 24 * 60 * 60 * 1000);
let _sweepRunning = false;
/** @type {Promise<void>|null} — tracks the current sweep so stop() can await it. */
let _sweepPromise = null;
let _lastSessionProbeAt = 0;

async function getConfigForAccount(account) {
  try {
    const { decryptConfig } = await import('./storage-codec.js');
    return account.config ? decryptConfig(account.config) : {};
  } catch {
    return null; // decrypt failed — skip
  }
}


export async function sweepAndRefresh() {
  if (_sweepRunning) {
    logger.warn('[AUTO-REFRESH] Previous sweep still running; skipping overlap');
    return _sweepPromise;
  }
  _sweepRunning = true;

  // #44: Save the promise so stopSessionRefresher() can await the in-flight
  // sweep instead of only clearing timers and returning immediately.
  _sweepPromise = _sweepImpl().finally(() => { _sweepRunning = false; });
  return _sweepPromise;
}

async function _sweepImpl() {
  let swept = 0;
  let refreshed = 0;
  let skipped = 0;

  try {
    const accounts = await prisma.account.findMany({
      select: {
        id: true,
        userId: true,
        alias: true,
        config: true,
        sessionToken: true,
      },
    });
    swept = accounts.length;
    const now = Date.now();

    for (const account of accounts) {
      try {
        const config = await getConfigForAccount(account);
        if (!config) { skipped++; continue; }

        const { sessionExpiry } = config;

        // Exploit #14: Get stacked client cookies
        const clientCookiesStack = normalizeClientCookies(config);

        if (!sessionExpiry) { skipped++; continue; }

        const expiresAt = new Date(sessionExpiry).getTime();

        // OTP-only account — can't silently refresh without __client cookie
        if (clientCookiesStack.length === 0) { skipped++; continue; }

        // Not near expiry yet — skip (sessions last ~7 days, refresh in last 24h)
        if (expiresAt > now && expiresAt - now > REFRESH_WINDOW_MS) { skipped++; continue; }

        // Expired OR expiring soon — try refresh via __client cookies.
        // Exploit #14: Iterate clientCookies newest-first. Pop dead ones. Append fresh.

        logger.info(`[AUTO-REFRESH] Account ${account.id} (${account.alias}) expires in ${Math.round((expiresAt - now) / 60000)}m — refreshing with ${clientCookiesStack.length} stacked cookie(s)…`);

        // Try stacked cookies newest-first
        let refreshResult = null;
        let liveStack = [...clientCookiesStack]; // copy so we can remove dead ones
        const sessionCookie = config.sessionCookie ?? '';

        for (let i = 0; i < liveStack.length; i++) {
          const entry = liveStack[i];
          logger.info(`[AUTO-REFRESH] Account ${account.id} trying stacked cookie ${i + 1}/${liveStack.length} (issued ${entry.issuedAt})`);
          const result = await refreshSession(entry.cookie, sessionCookie);
          if (result) {
            refreshResult = result;
            break;
          }
          // Cookie is dead — remove from stack
          logger.warn(`[AUTO-REFRESH] Stacked cookie ${i + 1} is dead for account=${account.id} — removing`);
          liveStack.splice(i, 1);
          i--; // adjust index since we spliced
        }

        if (!refreshResult) {
          logger.warn(`[AUTO-REFRESH] All ${clientCookiesStack.length} stacked cookie(s) dead for account=${account.id} — session needs manual re-auth`);
          await logAccountEvent(account.userId, account.id, 'SESSION_REFRESH_FAILED', `All ${clientCookiesStack.length} stacked __client cookie(s) are dead — session may need manual re-auth`);
          skipped++;
          continue;
        }

        // Extract fresh __client from the response Set-Cookie (if any)
        const freshClientCookie = extractNewClientCookie(refreshResult.setCookieLines);
        const resolvedClientCookie = refreshResult.clientCookie ?? getLatestClientCookie(config);

        // Update account session — this will APPEND the new cookie via store.js stacking logic
        await updateAccountSession(
          account.userId,
          account.id,
          refreshResult.sessionToken ?? refreshResult.sessionCookie ?? sessionCookie,
          resolvedClientCookie,
          refreshResult.sessionExpiry ?? null,
          { replaceClientCookies: liveStack },
        );

        // If the refresh also returned a fresh __client in Set-Cookie that differs,
        // stack it as well
        if (freshClientCookie && freshClientCookie !== resolvedClientCookie) {
          logger.info(`[AUTO-REFRESH] Fresh __client from Set-Cookie differs — stacking for account=${account.id}`);
          await updateAccountSession(
            account.userId,
            account.id,
            null, // don't update session cookie again
            freshClientCookie,
            null, // don't update session expiry again
            { preserveSessionToken: true },
          );
        }

        await logAccountEvent(account.userId, account.id, 'AUTO_REFRESH', `Session auto-refreshed before expiry (stacked cookies: ${liveStack.length})`);
        refreshed++;
        logger.info(`[AUTO-REFRESH] Refreshed session for account=${account.id} (stack has ${liveStack.length} cookie(s))`);
      } catch (err) {
        logger.warn(`[AUTO-REFRESH] Failed for account=${account.id}: ${err.message}`);
        skipped++;
      }
    }
  } catch (err) {
    logger.error(`[AUTO-REFRESH] Sweep failed: ${err.message}`);
  }

  if (swept > 0) {
    logger.info(`[AUTO-REFRESH] Sweep done — ${swept} checked, ${refreshed} refreshed, ${skipped} skipped`);
  }

  // ── Session lifetime probe pass ──────────────────────────────────────────
  // This is useful instrumentation, but it performs live Clerk refresh probes
  // for every logged-in account. Keep it opt-in so an idle desktop app does not
  // heat the machine just to collect observational lifetime data.
  if (SESSION_PROBE_ENABLED && Date.now() - _lastSessionProbeAt >= SESSION_PROBE_INTERVAL_MS) {
    _lastSessionProbeAt = Date.now();
    _runSessionProbe().catch((err) =>
      logger.warn(`[SESSION_PROBE] Probe pass failed: ${err.message}`));
  }
}

/** Decode a JWT payload without verifying — only used to read stable Clerk sid claim. */
function _jwtSid(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.sid || null; // Clerk's stable session id, e.g. "sess_abc123"
  } catch {
    return null;
  }
}

function _redactAlias(alias) {
  if (!alias || typeof alias !== 'string') return 'unknown';
  const [head = 'account', ...rest] = alias.split('@');
  if (rest.length > 0) {
    const domain = rest.join('@');
    const domainParts = domain.split('.');
    const root = domainParts[0] || 'domain';
    const tld = domainParts.length > 1 ? `.${domainParts.at(-1)}` : '';
    return `${head.slice(0, 2)}…@${root.slice(0, 2)}…${tld}`;
  }
  return `${head.slice(0, 6)}…`;
}

function _redactSid(sid) {
  if (!sid || sid === '(no-sid)') return '(no-sid)';
  const value = String(sid);
  if (value.length <= 10) return `${value.slice(0, 3)}…`;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

async function _runSessionProbe() {
  const accounts = await prisma.account.findMany({
    select: {
      id: true,
      userId: true,
      alias: true,
      config: true,
      sessionToken: true,
    },
  });
  const probeAccounts = [];

  for (const account of accounts) {
    const config = await getConfigForAccount(account);
    if (!config || !config.lastLoginAt) continue; // not logged in yet — nothing to track
    if (config.pendingVerification) continue;      // OTP stub not verified — skip
    probeAccounts.push({ account, config });
  }

  if (probeAccounts.length === 0) {
    logger.info('[SESSION_PROBE] No accounts with a recorded login yet — probe will fire after first bulk login');
    return;
  }



  for (const { account, config } of probeAccounts) {
    try {
      // ── Decode session ID from stored JWT (stable Clerk identifier) ──────
      let rawJwt = '';
      try {
        rawJwt = decrypt(account.sessionToken) || '';
      } catch (err) {
        logger.warn(`[SESSION_PROBE] Stored session token decrypt failed for account=${account.id}: ${err.message}`);
      }
      const currentSid = rawJwt ? _jwtSid(rawJwt) : null;

      // ── Detect session rotation (re-login since last probe) ──────────────
      const trackedSid   = config._probeSid      || null;
      const trackedSince = config._probeSidSince || config.lastLoginAt;

      if (currentSid && currentSid !== trackedSid) {
        // Session rotated (or first time seen) — persist the new sid
        const verb = trackedSid ? 'rotated' : 'first seen';
        logger.info(
          `[SESSION_PROBE] 🔄 session ${verb} for alias="${_redactAlias(account.alias)}" ` +
          `old_sid=${_redactSid(trackedSid)} → new_sid=${_redactSid(currentSid)} ` +
          `login_at=${config.lastLoginAt}`
        );
        const updatedConfig = { ...config, _probeSid: currentSid, _probeSidSince: new Date().toISOString() };
        prisma.account.update({ where: { id: account.id }, data: { config: encryptConfig(updatedConfig) } })
          .catch((e) => logger.warn(`[SESSION_PROBE] Failed to persist sid for ${account.id}: ${e.message}`));
      }

      const sid         = currentSid || trackedSid || '(no-sid)';
      const sinceMs     = Date.now() - new Date(trackedSince).getTime();
      const elapsedHours = (sinceMs / 3600000).toFixed(1);

      // ── Live Clerk probe ─────────────────────────────────────────────────
      const cookieStack = normalizeClientCookies(config);
      let status = 'no-cookie';
      if (cookieStack.length > 0) {
        try {
          const result = await refreshSession(cookieStack, rawJwt);
          status = result ? 'active' : 'expired';
        } catch (err) {
          logger.warn(`[SESSION_PROBE] Live refresh probe failed for account=${account.id}: ${err.message}`);
          status = 'error';
        }
      }

      // ── Log result ───────────────────────────────────────────────────────
      if (status === 'active') {
        logger.info(
          `[SESSION_PROBE] ✅ active | alias="${_redactAlias(account.alias)}" sid=${_redactSid(sid)} ` +
          `elapsed=${elapsedHours}h since_login=${trackedSince}`
        );
      } else if (status === 'expired') {
        logger.warn(
          `[SESSION_PROBE] 🔴 DEAD | alias="${_redactAlias(account.alias)}" sid=${_redactSid(sid)} ` +
          `elapsed=${elapsedHours}h — session expired after ${elapsedHours} hours`
        );
      } else {
        logger.warn(
          `[SESSION_PROBE] ⚠️ ${status} | alias="${_redactAlias(account.alias)}" sid=${_redactSid(sid)} ` +
          `elapsed=${elapsedHours}h since_login=${trackedSince}`
        );
      }
    } catch (err) {
      logger.warn(`[SESSION_PROBE] Failed for account=${account.id} alias="${_redactAlias(account.alias)}": ${err.message}`);
    }
  }
}


let _intervalHandle = null;
let _startupTimeoutHandle = null;

export function startSessionRefresher() {
  if (_intervalHandle) return;
  _startupTimeoutHandle = setTimeout(() => {
    _startupTimeoutHandle = null;
    sweepAndRefresh();
  }, STARTUP_DELAY_MS);
  _intervalHandle = setInterval(() => sweepAndRefresh(), INTERVAL_MS);
  _startupTimeoutHandle.unref?.();
  _intervalHandle.unref?.();
  logger.info(`[AUTO-REFRESH] Session refresher scheduled (every ${INTERVAL_MS / 3600000}h)`);
}

export async function stopSessionRefresher() {
  if (_startupTimeoutHandle) {
    clearTimeout(_startupTimeoutHandle);
    _startupTimeoutHandle = null;
  }
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
  // #44: Await the in-flight sweep so DB writes complete before shutdown
  // continues. Without this, stop() could return while a sweep is still
  // writing session updates to the database.
  if (_sweepPromise) {
    logger.info('[AUTO-REFRESH] Waiting for in-flight sweep to complete before stop…');
    await _sweepPromise;
    logger.info('[AUTO-REFRESH] In-flight sweep completed — session refresher stopped');
  } else {
    logger.info('[AUTO-REFRESH] Session refresher stopped');
  }
}
