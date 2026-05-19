import BaseController from './BaseController.js';
import * as store from '../services/store.js';
import { invalidateSessionStatusCache } from '../services/store.js';
import * as openrouter from '../services/openrouter.js';
import * as clerkAuth from '../services/clerk-auth.js';
import { logger } from '../services/logger.js';
import { assertManagementKey } from '../services/key-utils.js';
import pLimit from 'p-limit';


// Simple in-memory cache for account snapshots
// TTL: 5 minutes — OpenRouter balance data doesn't change that fast.
// The Refresh button (or re-auth events) invalidates per-account.
const snapshotCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCachedSnapshot(accountId) {
  const cached = snapshotCache.get(accountId);
  if (!cached) return null;
  
  const now = Date.now();
  if (now - cached.timestamp > CACHE_TTL_MS) {
    snapshotCache.delete(accountId);
    return null;
  }
  return cached.data;
}

function setCachedSnapshot(accountId, data) {
  snapshotCache.set(accountId, {
    data,
    timestamp: Date.now(),
  });
}

// Invalidate cache for an account (call when keys/balance updated)
export function invalidateSnapshotCache(accountId) {
  snapshotCache.delete(accountId);
  invalidateSessionStatusCache(accountId);
}

// Clear entire cache (useful for testing/logout)
export function clearSnapshotCache() {
  snapshotCache.clear();
}

class DashboardController extends BaseController {
  async refreshDashboard(req, res) {
    return this.getDashboard(req, res);
  }

  async getDashboard(req, res) {
    try {
      const accounts = await store.getAllAccountsWithKeys(req.user.id);
      
      if (accounts.length === 0) {
        return this.success(res, {
          accounts: [],
          totals: { totalCredits: 0, totalUsed: 0, totalRemaining: 0, totalKeys: 0, totalActiveKeys: 0 },
        });
      }

      let metaById = new Map(
        (await store.getAccounts(req.user.id)).map((a) => [a.id, a]),
      );

      // Refresh expired/expiring sessions in parallel (no stagger)
      let refreshedSessions = false;
      await Promise.all(
        accounts.map(async (account) => {
          const meta = metaById.get(account.id);
          // 'unknown' = JWT stale but __client may be alive — try refresh proactively.
          // 'expiring' = JWT about to die — refresh before it does.
          const needsRefresh = meta?.sessionStatus === 'expiring' || meta?.sessionStatus === 'expired' || meta?.sessionStatus === 'unknown';
          if (!needsRefresh) return;
          
          // Exploit #14: Cookie stacking — try all stacked cookies newest-first
          const cc = account.clientCookie?.trim();
          const stackedCookies = account.clientCookies; // from getAllAccountsWithKeys
          if ((!cc || cc === 'undefined') && (!stackedCookies || stackedCookies.length === 0)) return;
          
          try {
            // If stacked cookies available, pass the array; otherwise use single cookie
            const refreshInput = (stackedCookies && stackedCookies.length > 0) ? stackedCookies : cc;
            const refreshed = await clerkAuth.refreshSession(refreshInput, account.sessionCookie);
            if (refreshed) {
              const nextCc = refreshed.clientCookie ?? (typeof refreshInput === 'string' ? refreshInput : cc);
              const liveStack = Array.isArray(stackedCookies) && stackedCookies.length > 0
                ? (refreshed.deadClientCookies && refreshed.deadClientCookies.length > 0
                  ? (() => {
                    const deadSet = new Set(refreshed.deadClientCookies.map((e) => e.cookie));
                    return stackedCookies.filter((entry) => !deadSet.has(entry.cookie));
                  })()
                  : stackedCookies)
                : [];
              await store.updateAccountSession(
                req.user.id,
                account.id,
                refreshed.sessionCookie,
                nextCc,
                refreshed.sessionExpiry,
                { replaceClientCookies: liveStack },
              );
              refreshedSessions = true;
              logger.info(`[DASHBOARD] Session refreshed via clientCookie (account=${account.id}, was=${meta.sessionStatus})`);
            }
          } catch (err) {
            logger.warn(`[DASHBOARD] Proactive refresh failed (account=${account.id}): ${err.message}`);
          }
        })
      );
      
      if (refreshedSessions) {
        metaById = new Map(
          (await store.getAccounts(req.user.id)).map((a) => [a.id, a]),
        );
      }

      // Fetch snapshots with concurrency limiting (no artificial delays)
      // Concurrency of 5 to respect OpenRouter rate limits while maximizing speed
      const CONCURRENCY = 5;
      const limit = pLimit(CONCURRENCY);
      
      const snapshots = await Promise.all(
        accounts.map((account) =>
          limit(async () => {
            const meta = metaById.get(account.id) || {};
            
            // Check cache first (unless account has error status)
            const cached = getCachedSnapshot(account.id);
            if (cached && cached.status !== 'error') {
              logger.debug(`[DASHBOARD] Using cached snapshot for account=${account.id}`);
              return {
                ...cached,
                id: account.id,
                alias: account.alias,
                email: meta.email,
                authMethod: meta.authMethod,
                passwordOnFile: meta.passwordOnFile,
                sessionStatus: meta.sessionStatus,
                sessionDecryptFailed: meta.sessionDecryptFailed,
                hasManagementKey: meta.hasManagementKey,
                hasCredentials: meta.hasCredentials,
                _cached: true, // Flag for debugging
              };
            }
            
            try {
              if (!account.managementKey) {
                throw new Error('No management key — provision one first');
              }
              assertManagementKey(account.managementKey, 'account snapshot');
              
              const snapshot = await openrouter.getAccountSnapshot(account.managementKey);
              const result = {
                id: account.id,
                alias: account.alias,
                status: 'ok',
                email: meta.email,
                authMethod: meta.authMethod,
                passwordOnFile: meta.passwordOnFile,
                sessionStatus: meta.sessionStatus,
                sessionDecryptFailed: meta.sessionDecryptFailed,
                hasManagementKey: meta.hasManagementKey,
                hasCredentials: meta.hasCredentials,
                ...snapshot,
              };
              
              // Cache successful snapshot
              setCachedSnapshot(account.id, result);
              // Persist balance to DB (non-blocking, non-fatal)
              store.updateAccountBalance(account.id, {
                remaining: snapshot.credits?.remaining,
                total: snapshot.credits?.total,
              }).catch((err) => {
                logger.warn(`[DASHBOARD] Balance cache update failed (account=${account.id}): ${err.message}`);
              });
              return result;
              
            } catch (err) {
              const errorResult = {
                id: account.id,
                alias: account.alias,
                status: 'error',
                error: err.message,
                email: meta.email,
                authMethod: meta.authMethod,
                passwordOnFile: meta.passwordOnFile,
                sessionStatus: meta.sessionStatus,
                sessionDecryptFailed: meta.sessionDecryptFailed,
                hasManagementKey: meta.hasManagementKey,
                hasCredentials: meta.hasCredentials,
                credits: { total: 0, used: 0, remaining: 0 },
                keys: { total: 0, active: 0, disabled: 0, list: [] },
              };
              // Don't cache errors - let them retry next time
              return errorResult;
            }
          })
        )
      );

      // Compute totals
      const totals = snapshots.reduce(
        (acc, a) => {
          acc.totalCredits += a.credits?.total || 0;
          acc.totalUsed += a.credits?.used || 0;
          acc.totalRemaining += a.credits?.remaining || 0;
          acc.totalKeys += a.keys?.total || 0;
          acc.totalActiveKeys += a.keys?.active || 0;
          return acc;
        },
        { totalCredits: 0, totalUsed: 0, totalRemaining: 0, totalKeys: 0, totalActiveKeys: 0 },
      );

      // Warm display session status cache server-side (cheap/cached status).
      // This payload is for passive UI display only.
      const displaySessionStatuses = {};
      const liveStatusLimit = pLimit(CONCURRENCY);
      await Promise.allSettled(
        snapshots.map((snapshot) => liveStatusLimit(async () => {
          try {
            const payload = await store.getStoredSessionStatusPayload(req.user.id, snapshot.id);
            displaySessionStatuses[snapshot.id] = payload.status;
            // Merge display status into snapshot so response is immediately accurate
            snapshot.sessionStatus = payload.status;
            // Also add lastLoginAt if not already present from meta
            if (!snapshot.lastLoginAt) {
              const meta = metaById.get(snapshot.id);
              if (meta?.lastLoginAt) snapshot.lastLoginAt = meta.lastLoginAt;
            }
            if (!snapshot.sessionExpiry) {
              const meta = metaById.get(snapshot.id);
              if (meta?.sessionExpiry) snapshot.sessionExpiry = meta.sessionExpiry;
            }
          } catch (err) {
            // Non-fatal: keep existing sessionStatus from meta
            logger.warn(`[DASHBOARD] Stored session status payload failed (account=${snapshot.id}): ${err.message}`);
          }
        }))
      );

      return this.success(res, {
        accounts: snapshots,
        totals,
        liveStatuses: displaySessionStatuses,
        displaySessionStatuses,
      });

    } catch (err) {
      return this.error(res, err.message);
    }
  }
}

export default new DashboardController();
