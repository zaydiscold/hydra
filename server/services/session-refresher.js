/**
 * session-refresher.js — P13
 * Proactively refreshes Clerk sessions before they expire.
 * Runs 10s after startup then every 6 hours.
 * Silently skips OTP-only accounts (no clientCookie = can't refresh).
 *
 * Exploit #14: Cookie stacking — iterates clientCookies newest-first,
 * pops dead ones, appends fresh __client from response.
 */

import { prisma } from './db.js';
import { updateAccountSession, logAccountEvent, getLatestClientCookie } from './store.js';
import { refreshSession, extractNewClientCookie } from './clerk-auth.js';
import { logger } from './logger.js';

const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000; // probe within 24h of expiry
const INTERVAL_MS = 6 * 60 * 60 * 1000; // run every 6h

async function getConfigForAccount(account) {
  try {
    const { decryptConfig } = await import('./storage-codec.js');
    return account.config ? decryptConfig(account.config) : {};
  } catch {
    return null; // decrypt failed — skip
  }
}

/**
 * Normalize config.clientCookie / config.clientCookies into the new array format.
 * Duplicated from store.js to avoid circular import issues at module level.
 */
function normalizeClientCookies(config) {
  // New format already present
  if (Array.isArray(config.clientCookies) && config.clientCookies.length > 0) {
    return config.clientCookies;
  }
  // Legacy: string clientCookie → single-element array
  const cc = config.clientCookie ? String(config.clientCookie).trim() : '';
  if (cc && cc !== 'undefined') {
    const issuedAt = config.clientCookieIssuedAt || new Date().toISOString();
    return [{ cookie: cc, issuedAt }];
  }
  // Neither — empty array
  return [];
}

/**
 * Get the latest (newest) client cookie string from config.
 */
function latestClientCookie(config) {
  const stack = normalizeClientCookies(config);
  return stack.length > 0 ? stack[0].cookie : '';
}

export async function sweepAndRefresh() {
  let swept = 0;
  let refreshed = 0;
  let skipped = 0;

  try {
    const accounts = await prisma.account.findMany({});
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
        const resolvedClientCookie = refreshResult.clientCookie ?? latestClientCookie(config);

        // Update account session — this will APPEND the new cookie via store.js stacking logic
        await updateAccountSession(
          account.userId,
          account.id,
          refreshResult.sessionToken ?? refreshResult.sessionCookie ?? sessionCookie,
          resolvedClientCookie,
          refreshResult.sessionExpiry ?? null,
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
}

let _intervalHandle = null;

export function startSessionRefresher() {
  if (_intervalHandle) return;
  setTimeout(() => sweepAndRefresh(), 10_000);
  _intervalHandle = setInterval(() => sweepAndRefresh(), INTERVAL_MS);
  logger.info(`[AUTO-REFRESH] Session refresher scheduled (every ${INTERVAL_MS / 3600000}h)`);
}

export function stopSessionRefresher() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
    logger.info('[AUTO-REFRESH] Session refresher stopped');
  }
}
