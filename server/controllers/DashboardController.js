import BaseController from './BaseController.js';
import * as store from '../services/store.js';
import * as openrouter from '../services/openrouter.js';
import * as clerkAuth from '../services/clerk-auth.js';
import { logger } from '../services/logger.js';
import { assertManagementKey } from '../services/key-utils.js';

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

      let refreshedSessions = false;
      for (const account of accounts) {
        const meta = metaById.get(account.id);
        // Refresh both 'expiring' (proactive) and 'expired' (reactive) sessions as long as a
        // clientCookie exists — the __client device cookie can obtain a fresh __session JWT
        // without a full re-login.
        const needsRefresh = meta?.sessionStatus === 'expiring' || meta?.sessionStatus === 'expired';
        if (!needsRefresh) continue;
        const cc = account.clientCookie?.trim();
        if (!cc || cc === 'undefined') continue;
        try {
          const refreshed = await clerkAuth.refreshSession(cc);
          if (refreshed) {
            const nextCc = refreshed.clientCookie ?? cc;
            await store.updateAccountSession(
              req.user.id,
              account.id,
              refreshed.sessionCookie,
              nextCc,
              refreshed.sessionExpiry,
            );
            refreshedSessions = true;
            logger.info(`[DASHBOARD] Session refreshed via clientCookie (account=${account.id}, was=${meta.sessionStatus})`);
          }
        } catch (err) {
          logger.warn(`[DASHBOARD] Proactive refresh failed (account=${account.id}): ${err.message}`);
        }
      }
      if (refreshedSessions) {
        metaById = new Map(
          (await store.getAccounts(req.user.id)).map((a) => [a.id, a]),
        );
      }

      const snapshots = await Promise.all(
        accounts.map(async (account, index) => {
          const meta = metaById.get(account.id) || {};
          try {
            // Stagger by 50ms per account to smooth out spikes
            if (index > 0) await new Promise(r => setTimeout(r, index * 50));
            if (!account.managementKey) {
              throw new Error('No management key — provision one first');
            }
            assertManagementKey(account.managementKey, 'account snapshot');
            const snapshot = await openrouter.getAccountSnapshot(account.managementKey);
            return {
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
          } catch (err) {
            return {
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
          }
        })
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

      return this.success(res, { accounts: snapshots, totals });
    } catch (err) {
      return this.error(res, err.message);
    }
  }
}

export default new DashboardController();
