import BaseController from './BaseController.js';
import * as store from '../services/store.js';
import * as dashboardApi from '../services/dashboard-api.js';
import { z } from 'zod';
import { taskSupervisor } from '../services/task-supervisor.js';

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

class CodeController extends BaseController {
  async redeem(req, res) {
    try {
      const { accountId, code } = this.validate(req.body, redeemSchema);
      const result = await dashboardApi.redeemCode(req.user.id, accountId, code);
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
        () => dashboardApi.bulkRedeemCode(req.user.id, accountIds, code),
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
          const batchResults = [];
          for (const assignment of assignments) {
            const { accountId, code } = assignment;
            try {
              const account = await store.getAccountWithKey(req.user.id, accountId);
              const result = await dashboardApi.redeemCode(req.user.id, accountId, code);
              batchResults.push({ accountId, alias: account.alias, code, ...result, status: 'fulfilled' });
            } catch (err) {
              const { errorCode, message } = dashboardApi.classifyRedeemFailure(err.message, err);
              batchResults.push({
                accountId,
                code,
                error: message,
                message,
                status: 'rejected',
                errorCode,
              });
            }
          }
          return batchResults;
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
