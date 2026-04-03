import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BaseController from './BaseController.js';
import * as store from '../services/store.js';
import * as openrouter from '../services/openrouter.js';
import * as clerkAuth from '../services/clerk-auth.js';
import * as dashboardApi from '../services/dashboard-api.js';
import { assertManagementKey } from '../services/key-utils.js';
import { taskSupervisor } from '../services/task-supervisor.js';
import { logger } from '../services/logger.js';
import {
  addAccountSchema,
  addAccountWithCredentialsSchema,
  bulkAddSchema,
  bulkOtpStubsSchema,
  otpVerifySchema,
  updateAccountSchema
} from '../validators/account.js';

/** When set, OTP/Clerk errors include UI + JSON hints; server logs use [CLERK_DEBUG_OTP]. */
function clerkDebugOtpExtra() {
  if (process.env.CLERK_DEBUG_OTP !== '1') return {};
  return {
    clerkDebugOtp: true,
    clerkDebugHint:
      'Clerk trace is on (CLERK_DEBUG_OTP=1). In the terminal running the API, search for lines starting with [CLERK_DEBUG_OTP] right after this request.',
  };
}

export class AccountController extends BaseController {
  async getAccounts(req, res) {
    try {
      const accounts = await store.getAccounts(req.user.id);
      return this.success(res, accounts);
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async addAccount(req, res) {
    try {
      const { alias, managementKey } = this.validate(req.body, addAccountSchema);
      try {
        assertManagementKey(managementKey, 'account management');
      } catch (err) {
        return this.error(res, err.message, 400);
      }
      
      try {
        await openrouter.getCredits(managementKey);
      } catch (err) {
        return this.error(res, `Invalid management key: ${err.message}`, 400);
      }
      
      const account = await store.addAccount(req.user.id, alias, managementKey);
      return this.success(res, account, 201);
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async addAccountWithCredentials(req, res) {
    try {
      const { alias, email, password, authMethod } = this.validate(req.body, addAccountWithCredentialsSchema);
      const account = await store.addAccountWithCredentials(req.user.id, alias, email, password, authMethod);
      return this.success(res, account, 201);
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async bulkAdd(req, res) {
    try {
      const { lines } = this.validate(req.body, bulkAddSchema);
      
      const results = await taskSupervisor.enqueueBatch(
        'batch_account_work',
        req.user.id,
        async () => {
          const batchResults = [];
          for (const [index, lineStr] of lines.entries()) {
            try {
              if (lineStr.includes(':')) {
                const parts = lineStr.split(':').map(p => p.trim());
                let alias, email, password;
                if (parts.length >= 3) {
                  alias = parts[0];
                  email = parts[1];
                  password = parts.slice(2).join(':');
                } else {
                  email = parts[0];
                  alias = email.split('@')[0] || `acc-${index + 1}`;
                  password = parts[1];
                }
                const account = await store.addAccountWithCredentials(req.user.id, alias, email, password, 'password');
                batchResults.push({ success: true, ...account });
                continue;
              }

              const timestamp = new Date().getTime().toString().slice(-4);
              const alias = `bulk-${timestamp}-${index + 1}`;
              const account = await store.addAccountWithSessionCookie(req.user.id, alias, lineStr);
              batchResults.push({ success: true, ...account });
            } catch (err) {
              batchResults.push({ success: false, error: err.message, line: lineStr });
            }
          }
          return batchResults;
        },
        { operation: 'bulk_add_accounts', size: lines.length },
      );

      const count = results.filter(r => r.success).length;
      return this.success(res, { count, data: results }, 201);
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  /**
   * Create OTP-only vault rows for a list of OpenRouter emails (sequential; no Clerk calls).
   * Used by Bulk Auth wizard before per-account otp/start + otp/verify.
   */
  async bulkOtpStubs(req, res) {
    try {
      const { emails } = this.validate(req.body, bulkOtpStubsSchema);
      const seen = new Set();
      const unique = emails.filter((e) => {
        if (seen.has(e)) return false;
        seen.add(e);
        return true;
      });

      const aliasFromEmail = (email, suffix) => {
        const [localRaw, domRaw = 'x'] = email.split('@');
        const local = (localRaw || 'user').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 24) || 'user';
        const dom = (domRaw || 'x').replace(/[^a-zA-Z0-9.-]/g, '-').slice(0, 20);
        const base = `${local}-${dom}`;
        const withSuffix = suffix === 0 ? base : `${base}-${suffix}`;
        return withSuffix.slice(0, 50);
      };

      const results = [];
      for (const email of unique) {
        let created = false;
        let lastError = null;
        for (let suffix = 0; suffix < 30 && !created; suffix += 1) {
          const alias = aliasFromEmail(email, suffix);
          try {
            const account = await store.addAccountWithCredentials(
              req.user.id,
              alias,
              email,
              undefined,
              'otp',
            );
            results.push({
              email,
              success: true,
              account: { id: account.id, alias: account.alias, email, authMethod: 'otp' },
            });
            created = true;
          } catch (err) {
            lastError = err;
            if (err.status === 409) {
              const msg = (err.message || '').toLowerCase();
              if (msg.includes('email already exists')) {
                results.push({
                  email,
                  success: false,
                  error: err.message,
                  skipped: 'duplicate_email',
                });
                created = true;
              }
              // else: alias clash — try next suffix
            } else {
              results.push({ email, success: false, error: err.message });
              created = true;
            }
          }
        }
        if (!created) {
          results.push({
            email,
            success: false,
            error: lastError?.message || 'Could not allocate unique alias',
          });
        }
      }

      return this.success(res, { results }, 201);
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async detectAuth(req, res) {
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.id);
      if (!account.email) return this.error(res, 'Account has no email stored', 400);
      
      const result = await clerkAuth.detectAuthMethod(account.email);
      if (result.clientCookie) {
        const sessionExpiry =
          account.sessionExpiry ??
          (account.sessionCookie ? clerkAuth.getJwtExpiry(account.sessionCookie) : null);
        await store.updateAccountSession(
          req.user.id,
          req.params.id,
          account.sessionCookie,
          result.clientCookie,
          sessionExpiry,
        );
      }
      return this.success(res, result);
    } catch (err) {
      return this.error(res, err.message, err.status || 500, 'INTERNAL_ERROR', clerkDebugOtpExtra());
    }
  }

  async login(req, res) {
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.id);
      const usePassword = req.body.password || account.password;
      if (!account.email) return this.error(res, 'No email on this account', 400);
      if (!usePassword) return this.error(res, 'Password required', 400);

      const session = await clerkAuth.signInWithPassword(account.email, usePassword);
      await store.updateAccountSession(req.user.id, req.params.id, session.sessionCookie, session.clientCookie, session.sessionExpiry);
      await store.updateAccountLastSync(req.user.id, req.params.id);

      return this.success(res, { sessionExpiry: session.sessionExpiry, status: 'active' });
    } catch (err) {
      if (err.name === 'NeedSecondFactorError' && err.signInId && err.clientCookie) {
        await store.updateAccountSession(req.user.id, req.params.id, null, err.clientCookie, null);
        return res.status(202).json({
          success: true,
          requiresTwoFactor: true,
          signInId: err.signInId,
        });
      }
      if (err.message === 'NEEDS_2FA') {
        return res.status(202).json({ success: true, requiresTwoFactor: true });
      }
      return this.error(res, err.message, err.status || 500, 'INTERNAL_ERROR', clerkDebugOtpExtra());
    }
  }

  async startOTP(req, res) {
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.id);
      const email = req.body.email || account.email;
      if (!email) return this.error(res, 'Email required', 400);

      const { signInId, clientCookie } = await clerkAuth.startEmailOTP(email);
      await store.updateAccountSession(req.user.id, req.params.id, undefined, clientCookie, undefined, {
        preserveSessionToken: true,
      });

      return this.success(res, {
        signInId,
        message: `OTP sent to ${email}`,
      });
    } catch (err) {
      return this.error(res, err.message, err.status || 500, 'INTERNAL_ERROR', clerkDebugOtpExtra());
    }
  }

  async verifyOTP(req, res) {
    try {
      const { signInId, code, totpSecondFactor } = this.validate(req.body, otpVerifySchema);

      const accountSession = await store.getAccountSession(req.user.id, req.params.id);
      const storedClient = accountSession.clientCookie;
      if (
        !storedClient ||
        String(storedClient).trim() === '' ||
        String(storedClient).trim() === 'undefined'
      ) {
        return this.error(
          res,
          'No Clerk device cookie stored. Click “Send verification code” again, then verify.',
          400,
          'INTERNAL_ERROR',
          clerkDebugOtpExtra(),
        );
      }
      const session = totpSecondFactor
        ? await clerkAuth.completeSecondFactor(signInId, code, accountSession.clientCookie)
        : await clerkAuth.completeEmailOTP(signInId, code, accountSession.clientCookie);
      await store.updateAccountSession(req.user.id, req.params.id, session.sessionCookie, session.clientCookie, session.sessionExpiry);
      await store.updateAccountLastSync(req.user.id, req.params.id);

      return this.success(res, { sessionExpiry: session.sessionExpiry, status: 'active' });
    } catch (err) {
      logger.warn(`[ACCOUNT] verifyOTP failed (account=${req.params.id}): ${err.message}`);
      return this.error(res, err.message, err.status || 500, 'INTERNAL_ERROR', clerkDebugOtpExtra());
    }
  }

  async refresh(req, res) {
    try {
      const session = await store.getAccountSession(req.user.id, req.params.id);
      const refreshed = await clerkAuth.refreshSession(session.clientCookie);
      if (!refreshed) return this.error(res, 'Session refresh failed — please log in again', 401);
      const cc = refreshed.clientCookie ?? session.clientCookie;
      await store.updateAccountSession(req.user.id, req.params.id, refreshed.sessionCookie, cc, refreshed.sessionExpiry);
      return this.success(res, { sessionExpiry: refreshed.sessionExpiry, status: 'active' });
    } catch (err) {
      return this.error(res, err.message, err.status || 500, 'INTERNAL_ERROR', clerkDebugOtpExtra());
    }
  }

  async getSessionStatus(req, res) {
    try {
      const payload = await store.getStoredSessionStatusPayload(req.user.id, req.params.id);
      return this.success(res, {
        status: payload.status,
        sessionExpiry: payload.sessionExpiry,
        sessionDecryptFailed: payload.sessionDecryptFailed,
      });
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async provision(req, res) {
    try {
      const result = await dashboardApi.createManagementKey(req.user.id, req.params.id, req.body.keyName);
      if (result?.success === false) {
        return this.error(
          res,
          result.message || 'Could not provision management key',
          422,
          'PROVISION_FAILED',
          { source: result.source },
        );
      }
      return this.success(res, result);
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg.includes('Could not extract management key via Playwright')) {
        const debugDir = join(tmpdir(), 'hydra-provision-debug');
        return this.error(res, msg, err.status || 500, 'PROVISION_PLAYWRIGHT_EXTRACT', {
          hint: `Check server stderr and ${debugDir} (screenshots, provision-network-*.log, provision-trace-*.zip when HYDRA_PROVISION_DEBUG=1).`,
        });
      }
      return this.error(res, msg, err.status || 500);
    }
  }

  async provisionAll(req, res) {
    try {
      const candidates = (await store.getAllAccountsWithKeys(req.user.id)).filter((a) => !a.managementKey && a.email);

      const canProvisionWithoutUi = (a) => {
        const hasCookie = !!(a.sessionCookie && String(a.sessionCookie).trim());
        const canPasswordReauth = !!(a.password && a.authMethod === 'password');
        return hasCookie || canPasswordReauth;
      };

      const eligible = candidates.filter(canProvisionWithoutUi);
      const skipped = candidates
        .filter((a) => !canProvisionWithoutUi(a))
        .map((a) => ({
          id: a.id,
          alias: a.alias,
          skipped: true,
          reason:
            'No session cookie and no stored password for auto re-auth — use [UNLOCK] Authenticate in Hydra first (OTP / email-only accounts).',
        }));

      const results = await taskSupervisor.enqueueBatch(
        'batch_account_work',
        req.user.id,
        async () => {
          const batchResults = [];
          for (const account of eligible) {
            try {
              const result = await dashboardApi.createManagementKey(req.user.id, account.id);
              batchResults.push({ id: account.id, alias: account.alias, ...result });
            } catch (err) {
              batchResults.push({ id: account.id, alias: account.alias, success: false, error: err.message });
            }
          }
          return batchResults;
        },
        { operation: 'provision_all', size: eligible.length },
      );
      return this.success(res, { results, skipped });
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async updateAccount(req, res) {
    try {
      const validated = this.validate(req.body, updateAccountSchema);
      if (validated.managementKey) {
        try {
          assertManagementKey(validated.managementKey, 'account management');
        } catch (err) {
          return this.error(res, err.message, 400);
        }
        try {
          await openrouter.getCredits(validated.managementKey);
        } catch (err) {
          return this.error(res, `Invalid management key: ${err.message}`, 400);
        }
      }
      const result = await store.updateAccount(req.user.id, req.params.id, validated);
      return this.success(res, result);
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async deleteAccount(req, res) {
    try {
      await store.deleteAccount(req.user.id, req.params.id);
      return this.success(res, { deleted: true });
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async getSnapshot(req, res) {
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.id);
      if (!account.managementKey) return this.error(res, 'Account has no management key — use /provision first', 400);
      try {
        assertManagementKey(account.managementKey, 'account snapshot');
      } catch (err) {
        return this.error(res, err.message, 400);
      }
      const snapshot = await openrouter.getAccountSnapshot(account.managementKey);
      await store.updateAccountLastSync(req.user.id, req.params.id);
      const mgmtPreview = account.managementKey
        ? account.managementKey.slice(0, 16) + '••••••••' + account.managementKey.slice(-4)
        : null;
      return this.success(res, { id: account.id, alias: account.alias, email: account.email, managementKeyPreview: mgmtPreview, ...snapshot });
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }
}
