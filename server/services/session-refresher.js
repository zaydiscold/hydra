/**
 * session-refresher.js — P13
 * Proactively refreshes Clerk sessions before they expire.
 * Runs 10s after startup then every 6 hours.
 * Silently skips OTP-only accounts (no clientCookie = can't refresh).
 */

import { prisma } from './db.js';
import { updateAccountSession, logAccountEvent } from './store.js';
import { refreshSession } from './clerk-auth.js';
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

        const { sessionExpiry, clientCookie } = config;

        if (!sessionExpiry) { skipped++; continue; }

        const expiresAt = new Date(sessionExpiry).getTime();

        // OTP-only account — can't silently refresh without __client cookie
        if (!clientCookie) { skipped++; continue; }

        // Not near expiry yet — skip (sessions last ~7 days, refresh in last 24h)
        if (expiresAt > now && expiresAt - now > REFRESH_WINDOW_MS) { skipped++; continue; }

        // Expired OR expiring soon — try refresh via __client cookie.
        // Old sessions may have stale JWT-based expiries (always in the past);
        // the __client cookie may still be alive. Try the refresh either way.

        logger.info(`[AUTO-REFRESH] Account ${account.id} (${account.alias}) expires in ${Math.round((expiresAt - now) / 60000)}m — refreshing…`);

        const result = await refreshSession(clientCookie, config.sessionCookie ?? '');
        if (!result) {
          logger.warn(`[AUTO-REFRESH] Refresh returned null for account=${account.id} — __client cookie may be dead`);
          await logAccountEvent(account.userId, account.id, 'SESSION_REFRESH_FAILED', '__client cookie refresh returned null — session may need manual re-auth');
          skipped++;
          continue;
        }

        await updateAccountSession(
          account.userId,
          account.id,
          result.sessionToken ?? result.sessionCookie ?? config.sessionCookie,
          result.clientCookie ?? clientCookie,
          result.sessionExpiry ?? null
        );
        await logAccountEvent(account.userId, account.id, 'AUTO_REFRESH', 'Session auto-refreshed before expiry');
        refreshed++;
        logger.info(`[AUTO-REFRESH] Refreshed session for account=${account.id}`);
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
