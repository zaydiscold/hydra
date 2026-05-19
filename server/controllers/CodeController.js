import BaseController from './BaseController.js';
import * as store from '../services/store.js';
import * as dashboardApi from '../services/dashboard-api.js';
import { z } from 'zod';
import { taskSupervisor } from '../services/task-supervisor.js';
import { addRedemptionRecord, getRedemptionRecords } from '../services/redemption-log.js';
import { runInBatches } from '../services/batch-runner.js';
import { logger } from '../services/logger.js';

const redeemSchema = z.object({
  accountId: z.string().min(1, 'accountId is required'),
  code: z.string().min(1, 'code is required'),
});

const bulkRedeemSchema = z.object({
  accountIds: z.array(z.string()).min(1, 'accountIds array is required'),
  code: z.string().min(1, 'code is required'),
});

const bulkMatrixSchema = z.object({
  assignments: z.array(z.object({
    accountId: z.string().min(1),
    code: z.string().min(1),
  })).min(1, 'assignments array is required'),
});

const preflightSchema = z.object({
  accountIds: z.array(z.string()).min(1, 'accountIds array is required'),
});

async function recordRedemptionAttempt(userId, { code, accountId, accountAlias, success, message, creditsAdded }) {
  let alias = accountAlias;
  if (!alias) {
    try {
      const account = await store.getAccountWithKey(userId, accountId);
      alias = account.alias;
    } catch (err) {
      alias = accountId;
      logger.warn(`[CODES] Redemption history alias lookup failed for account=${accountId}: ${err.message}`);
    }
  }
  addRedemptionRecord({ code, accountId, accountAlias: alias, success, message, creditsAdded });
}

class CodeController extends BaseController {
  async redeem(req, res) {
    try {
      const { accountId, code } = this.validate(req.body, redeemSchema);
      const result = await dashboardApi.redeemCode(req.user.id, accountId, code);
      // P16 — log redemption
      await recordRedemptionAttempt(req.user.id, { code, accountId, success: !!result?.success, message: result?.message, creditsAdded: result?.creditsAdded ?? null });
      return this.success(res, result);
    } catch (err) {
      const status = err.status || 500;
      if (status === 400) {
        return this.error(res, err.message, 400, 'VALIDATION_ERROR');
      }
      const { errorCode } = dashboardApi.classifyRedeemFailure(err.message, err);
      const code =
        errorCode === dashboardApi.REDEEM_ERROR_CODES.SESSION ? 'REDEEM_SESSION' : 'INTERNAL_ERROR';
      const http = errorCode === dashboardApi.REDEEM_ERROR_CODES.SESSION ? 401 : status;
      return this.error(res, err.message, http, code);
    }
  }

  async bulkRedeem(req, res) {
    try {
      const { accountIds, code } = this.validate(req.body, bulkRedeemSchema);
      const results = await taskSupervisor.enqueueBatch(
        'batch_code_work',
        req.user.id,
        async () => {
          const res = await dashboardApi.bulkRedeemCode(req.user.id, accountIds, code);
          // P16 — log each outcome
          if (Array.isArray(res)) {
            for (const r of res) {
              await recordRedemptionAttempt(req.user.id, { code, accountId: r.accountId, accountAlias: r.alias, success: r.status === 'fulfilled', message: r.message ?? r.error });
            }
          }
          return res;
        },
        { operation: 'bulk_redeem', size: accountIds.length, code },
      );
      return this.success(res, results);
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  async bulkMatrix(req, res) {
    try {
      const { assignments } = this.validate(req.body, bulkMatrixSchema);
      const results = await taskSupervisor.enqueueBatch(
        'batch_code_work',
        req.user.id,
        async () => {
          return runInBatches(assignments, async (assignment) => {
            const { accountId, code } = assignment;
            try {
              const account = await store.getAccountWithKey(req.user.id, accountId);
              const result = await dashboardApi.redeemCode(req.user.id, accountId, code);
              const payload = { accountId, alias: account.alias, code, ...result, status: 'fulfilled' };
              // P16 — log success
              await recordRedemptionAttempt(req.user.id, { code, accountId, accountAlias: account.alias, success: true, message: result?.message, creditsAdded: result?.creditsAdded ?? null });
              return payload;
            } catch (err) {
              const { errorCode, message } = dashboardApi.classifyRedeemFailure(err.message, err);
              const payload = {
                accountId,
                code,
                error: message,
                message,
                status: 'rejected',
                errorCode,
              };
              // P16 — log failure
              await recordRedemptionAttempt(req.user.id, { code, accountId, success: false, message });
              return payload;
            }
          });
        },
        { operation: 'bulk_matrix_redeem', size: assignments.length },
      );
      return this.success(res, results.map((r) =>
        r.status === 'fulfilled'
          ? r
          : {
              accountId: r.accountId,
              code: r.code,
              success: false,
              error: r.error,
              message: r.message ?? r.error,
              errorCode: r.errorCode,
            }
      ));
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  async getHistory(req, res) {
    try {
      return this.success(res, getRedemptionRecords());
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  async getEndpoints(req, res) {
    try {
      const endpoints = await store.getDiscoveredEndpoints();
      return this.success(res, endpoints);
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  async preflight(req, res) {
    try {
      const { accountIds } = this.validate(req.body, preflightSchema);
      const result = await dashboardApi.preflightRedeemAccounts(req.user.id, accountIds);
      return this.success(res, result);
    } catch (err) {
      const status = err.status || 500;
      return this.error(res, err.message, status);
    }
  }
}

export default new CodeController();
