import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BaseController from './BaseController.js';
import * as store from '../services/store.js';
import * as openrouter from '../services/openrouter.js';
import * as clerkAuth from '../services/clerk-auth.js';
import * as dashboardApi from '../services/dashboard-api.js';
import { ProvisionKeyNotCapturedError } from '../services/dashboard-api.js';
import { assertManagementKey } from '../services/key-utils.js';
import { taskSupervisor } from '../services/task-supervisor.js';
import { logger } from '../services/logger.js';
import { runInBatches } from '../services/batch-runner.js';
import { invalidateSnapshotCache } from './DashboardController.js';
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

function pruneDeadClientCookies(stack, refreshed) {
  if (!Array.isArray(stack) || stack.length === 0) return [];
  if (!Array.isArray(refreshed?.deadClientCookies) || refreshed.deadClientCookies.length === 0) return stack;
  const deadSet = new Set(refreshed.deadClientCookies.map((entry) => entry.cookie));
  return stack.filter((entry) => !deadSet.has(entry.cookie));
}

function latestClientCookie(session) {
  const stacked = Array.isArray(session?.clientCookies)
    ? session.clientCookies.find((entry) => entry?.cookie && String(entry.cookie).trim() !== 'undefined')
    : null;
  return stacked?.cookie || session?.clientCookie || '';
}

function hasRefreshCookie(session) {
  return !!latestClientCookie(session);
}

function isAuthoritativeSessionFailure(errLike) {
  const code = String(errLike?.code || '').toUpperCase();
  const msg = String(errLike?.message || '').toLowerCase();
  if (code === 'OTP_REAUTH_REQUIRED') return true;
  return (
    msg.includes('session expired') ||
    msg.includes('re-authenticate') ||
    msg.includes('verification required') ||
    msg.includes('two-factor authentication')
  );
}

export class AccountController extends BaseController {
  async getAccounts(req, res) {
    const accounts = await store.getAccounts(req.user.id);
    return this.success(res, accounts);
  }

  async addAccount(req, res) {
    const { alias, managementKey } = this.validate(req.body, addAccountSchema);
    
    try {
      assertManagementKey(managementKey, 'account management');
    } catch (err) {
      err.status = 400;
      throw err;
    }
    
    try {
      await openrouter.getCredits(managementKey);
    } catch (err) {
      const wrappedErr = new Error(`Invalid management key: ${err.message}`);
      wrappedErr.status = 400;
      throw wrappedErr;
    }
    
    const account = await store.addAccount(req.user.id, alias, managementKey);
    return this.success(res, account, 201);
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
          // Pre-fetch existing accounts once for dedup lookup on 409
          let existingAccounts = [];
          try {
            existingAccounts = await store.getAccounts(req.user.id);
          } catch (err) {
            logger.warn(`[ACCOUNT] Bulk add dedup preload failed; duplicates may be reported as skipped errors: ${err.message}`);
          }

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
                batchResults.push({ success: true, created: true, ...account });
                continue;
              }

              const timestamp = new Date().getTime().toString().slice(-4);
              const alias = `bulk-${timestamp}-${index + 1}`;
              const account = await store.addAccountWithSessionCookie(req.user.id, alias, lineStr);
              batchResults.push({ success: true, created: true, ...account });
            } catch (err) {
              // Deduplicate: if the email already exists, return the existing account as skipped
              if (err.status === 409 && (err.message || '').toLowerCase().includes('email already exists')) {
                const lineParts = lineStr.split(':');
                const lineEmail = lineParts.length >= 3 ? lineParts[1].trim() : lineParts[0].trim();
                const existing = lineEmail
                  ? existingAccounts.find((a) => (a.email || '').toLowerCase() === lineEmail.toLowerCase())
                  : null;
                if (existing) {
                  batchResults.push({ success: true, skipped: true, id: existing.id, alias: existing.alias, email: existing.email, line: lineStr });
                } else {
                  batchResults.push({ success: false, skipped: true, error: err.message, line: lineStr });
                }
              } else {
                batchResults.push({ success: false, error: err.message, line: lineStr });
              }
            }
          }
          return batchResults;
        },
        { operation: 'bulk_add_accounts', size: lines.length },
      );

      const created = results.filter(r => r.success && r.created).length;
      const skipped = results.filter(r => r.skipped).length;
      const failed = results.filter(r => !r.success && !r.skipped).length;
      return this.success(res, { count: created, created, skipped, failed, data: results }, 201);
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
      const { emails: rawEmails } = this.validate(req.body, bulkOtpStubsSchema);

      // Expand *@domain wildcards to random aliases (e.g. *@zayd.wtf → nova4821@zayd.wtf)
      const RANDOM_WORDS = [
        'azure', 'cipher', 'comet', 'cosmic', 'delta', 'echo', 'ember', 'flash',
        'frost', 'ghost', 'helix', 'ion', 'jade', 'karma', 'laser', 'lunar',
        'mango', 'nexus', 'nova', 'onyx', 'orbit', 'pixel', 'plasma', 'pulse',
        'quartz', 'raven', 'sigma', 'solar', 'sonic', 'spark', 'storm', 'swift',
        'titan', 'turbo', 'ultra', 'vapor', 'vector', 'vibe', 'wave', 'xenon',
        'zeal', 'zero', 'zeta', 'drift', 'flare', 'forge', 'glyph', 'haze',
      ];
      const emails = rawEmails.flatMap(entry => {
        if (!entry.startsWith('*@')) return [entry];
        const domain = entry.slice(2);
        const word = RANDOM_WORDS[Math.floor(Math.random() * RANDOM_WORDS.length)];
        const suffix = String(Math.floor(Math.random() * 9000) + 1000);
        return [`${word}${suffix}@${domain}`];
      });

      const seen = new Set();
      const unique = emails.filter((e) => {
        if (seen.has(e)) return false;
        seen.add(e);
        return true;
      });

      const results = [];

      // Fetch existing accounts once so we can look up on 409 dedup
      let allAccounts = [];
      try {
        allAccounts = await store.getAccounts(req.user.id);
      } catch (err) {
        logger.warn(`[ACCOUNT] Bulk OTP dedup preload failed; duplicate emails may not reuse existing rows: ${err.message}`);
      }

      /**
       * Derive a display alias from an email address.
       * admin@zayd.world → admin-zayd.world
       * On alias collision the suffix increments: admin-zayd.world-2, -3, …
       */
      function emailToAlias(email, suffix = 0) {
        const base = String(email || '').trim().toLowerCase().replace('@', '-');
        return suffix === 0 ? base : `${base}-${suffix + 1}`;
      }

      for (const email of unique) {
        let created = false;
        let lastError = null;

        // Try alias variants until one is free (up to 30 conflict retries)
        for (let suffix = 0; suffix < 30 && !created; suffix += 1) {
          const alias = emailToAlias(email, suffix);
          
          try {
            const account = await store.addAccountWithCredentials(
              req.user.id,
              alias,
              email,
              undefined,
              'otp',
              null,
              { pendingVerification: true }, // hidden from dashboard until OTP completes
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
                const normalizedEmail = String(email || '').toLowerCase();
                const existing = allAccounts.find((a) => String(a.email || '').toLowerCase() === normalizedEmail);
                if (existing) {
                  results.push({
                    email,
                    success: true,
                    reused: true, // existing account — not a new stub
                    account: { id: existing.id, alias: existing.alias, email, authMethod: existing.authMethod || 'otp' },
                  });
                } else {
                  results.push({
                    email,
                    success: false,
                    error: err.message,
                    skipped: 'duplicate_email',
                  });
                }
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

  async refreshAccountLogin(req, res) {
    try {
      const session = await store.getAccountSession(req.user.id, req.params.id);

      // Ghost session recovery: try silent __client → __session refresh before forcing OTP
      if (hasRefreshCookie(session)) {
        try {
          const cookieInput244 = session.clientCookies?.length > 0 ? session.clientCookies : session.clientCookie;
          const refreshed = await clerkAuth.refreshSession(cookieInput244, session.sessionCookie);
          if (refreshed?.sessionToken) {
            const liveStack = pruneDeadClientCookies(session.clientCookies, refreshed);
            await store.updateAccountSession(
              req.user.id, req.params.id,
              refreshed.sessionToken,
              refreshed.clientCookie ?? latestClientCookie(session),
              refreshed.sessionExpiry ?? null,
              { replaceClientCookies: liveStack },
            );
            await store.logAccountEvent(req.user.id, req.params.id, 'GHOST_SESSION_RECOVERED', 'Silent __client refresh succeeded');
            invalidateSnapshotCache(req.params.id);
            return this.success(res, { success: true, recovered: true, message: 'Session recovered silently — no re-auth needed.' });
          }
        } catch (err) {
          logger.warn(`[ACCOUNT] Silent refresh recovery failed during refresh-login (account=${req.params.id}): ${err.message}`);
        }
      }

      // No recovery possible — clear session so UI prompts re-auth
      await store.updateAccountSession(req.user.id, req.params.id, null, null, null);
      await store.logAccountEvent(req.user.id, req.params.id, 'LOGIN_REFRESH_START', 'Session cleared for fresh re-auth');
      return this.success(res, { success: true, recovered: false, message: 'Session cleared. Please re-authenticate.' });
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
        // Keep existing stored expiry; don't fall back to JWT exp (that's ~2.5 min, not session TTL)
        const sessionExpiry = account.sessionExpiry ?? null;
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
    const { rotationManager } = await import('../services/rotation-manager.js');
    
    // Check login attempt limit to prevent account lockout
    const loginCheck = rotationManager.recordLoginAttempt(req.params.id);
    if (!loginCheck.allowed) {
      return this.error(
        res,
        `Too many failed login attempts. Please wait ${Math.ceil(loginCheck.cooldown / 60000)} minutes before retrying to prevent account lockout.`,
        429,
        'LOGIN_RATE_LIMITED'
      );
    }
    
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.id);
      const usePassword = req.body.password || account.password;
      if (!account.email) return this.error(res, 'No email on this account', 400);
      if (!usePassword) return this.error(res, 'Password required', 400);

      const session = await clerkAuth.signInWithPassword(account.email, usePassword);
      await store.updateAccountSession(req.user.id, req.params.id, session.sessionCookie, session.clientCookie, session.sessionExpiry, { isNewLogin: true });
      await store.updateAccountLastSync(req.user.id, req.params.id);
      await store.logAccountEvent(req.user.id, req.params.id, 'LOGIN_SUCCESS', 'Signed in via Password');
      
      // Success - reset login attempts
      rotationManager.resetLoginAttempts(req.params.id);

      return this.success(res, { sessionExpiry: session.sessionExpiry, status: 'active' });
    } catch (err) {
      if (err.name === 'NeedSecondFactorError' && err.signInId && err.clientCookie) {
        await store.updateAccountSession(req.user.id, req.params.id, null, err.clientCookie, null);
        await store.logAccountEvent(req.user.id, req.params.id, 'OTP_REQUIRED', 'Password accepted, OTP required');
        // 202 + top-level requiresTwoFactor: api.js checks data?.requiresTwoFactor directly.
        // Cannot use this.success() (wraps in data: {}) without updating the frontend check.
        return res.status(202).json({
          success: true,
          requiresTwoFactor: true,
          signInId: err.signInId,
        });
      }
      if (err.message === 'NEEDS_2FA') {
        return res.status(202).json({ success: true, requiresTwoFactor: true }); // intentional raw — see above
      }
      return this.error(res, err.message, err.status || 500, 'INTERNAL_ERROR', clerkDebugOtpExtra());
    }
  }

  async startOTP(req, res) {
    const { rotationManager } = await import('../services/rotation-manager.js');
    
    // Check login attempt limit to prevent account lockout
    const loginCheck = rotationManager.recordLoginAttempt(req.params.id);
    if (!loginCheck.allowed) {
      return this.error(
        res,
        `Too many OTP requests. Please wait ${Math.ceil(loginCheck.cooldown / 60000)} minutes before retrying to prevent account lockout.`,
        429,
        'OTP_RATE_LIMITED'
      );
    }
    
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.id);
      const email = req.body.email || account.email;
      if (!email) return this.error(res, 'Email required', 400);

      const { signInId, clientCookie, isSignUp } = await clerkAuth.startEmailOTP(email);
      await store.updateAccountSession(req.user.id, req.params.id, undefined, clientCookie, undefined, {
        preserveSessionToken: true,
      });
      await store.logAccountEvent(req.user.id, req.params.id, 'OTP_SENT', `OTP requested for ${email}${isSignUp ? ' (new account signup)' : ''}`);

      return this.success(res, {
        signInId,
        isSignUp: isSignUp ?? false,
        message: `OTP sent to ${email}`,
        remainingAttempts: loginCheck.remaining,
      });
    } catch (err) {
      return this.error(res, err.message, err.status || 500, 'INTERNAL_ERROR', clerkDebugOtpExtra());
    }
  }

  async verifyOTP(req, res) {
    try {
      const { signInId, code, totpSecondFactor, isSignUp } = this.validate(req.body, otpVerifySchema);

      const accountSession = await store.getAccountSession(req.user.id, req.params.id);
      const storedClient = latestClientCookie(accountSession);
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
        ? await clerkAuth.completeSecondFactor(signInId, code, storedClient)
        : await clerkAuth.completeEmailOTP(signInId, code, storedClient, { isSignUp: isSignUp ?? false });
      await store.updateAccountSession(req.user.id, req.params.id, session.sessionCookie, session.clientCookie, session.sessionExpiry, { isNewLogin: true });
      await store.updateAccountLastSync(req.user.id, req.params.id);
      await store.logAccountEvent(req.user.id, req.params.id, 'OTP_VERIFIED', 'Signed in via OTP');

      // OTP verified — unhide the account on the dashboard (was pendingVerification=true from bulkOtpStubs)
      await store.clearPendingVerification(req.user.id, req.params.id);

      // Success - reset login attempts
      const { rotationManager } = await import('../services/rotation-manager.js');
      rotationManager.resetLoginAttempts(req.params.id);

      // OTP sessions are SHORT-LIVED (1 min). Must provision SYNCHRONOUSLY before session expires.
      const userId = req.user.id;
      const accountId = req.params.id;
      let autoProvision = 'skipped';
      let provisionResult = null;
      try {
        // Check ManagementKey table (new system), not config (old system)
        const { getManagementKeys } = await import('../services/management-key-store.js');
        const existingKeys = await getManagementKeys(accountId);
        
        if (existingKeys.length === 0) {
          autoProvision = 'started';
          // SYNCHRONOUS - OTP sessions expire too fast for background processing
          provisionResult = await dashboardApi.createManagementKey(userId, accountId);
          if (provisionResult?.key) {
            autoProvision = 'completed';
            logger.info(`[ACCOUNT] Auto-provisioned management key after OTP (account=${accountId})`);
            // Invalidate dashboard cache since we have a new management key
            invalidateSnapshotCache(accountId);
          } else {
            autoProvision = 'failed';
            logger.warn(`[ACCOUNT] Auto-provision after OTP got no key (account=${accountId}): ${provisionResult?.message || 'unknown'}`);
          }
        } else {
          logger.info(`[ACCOUNT] Skipping auto-provision - ${existingKeys.length} key(s) already in ManagementKey table`);
        }
      } catch (checkErr) {
        autoProvision = 'error';
        logger.warn(`[ACCOUNT] Auto-provision after OTP failed (account=${accountId}): ${checkErr.message}`);
      }

      return this.success(res, { 
        sessionExpiry: session.sessionExpiry, 
        status: 'active', 
        autoProvision,
        managementKey: provisionResult?.key ? true : false
      });
    } catch (err) {
      logger.warn(`[ACCOUNT] verifyOTP failed (account=${req.params.id}): ${err.message}`);
      return this.error(res, err.message, err.status || 500, 'INTERNAL_ERROR', clerkDebugOtpExtra());
    }
  }

  async refresh(req, res) {
    try {
      const session = await store.getAccountSession(req.user.id, req.params.id);
      const cookieInput448 = session.clientCookies?.length > 0 ? session.clientCookies : session.clientCookie;
      const refreshed = await clerkAuth.refreshSession(cookieInput448, session.sessionCookie);
      if (!refreshed) return this.error(res, 'Session refresh failed — please log in again', 401);
      const cc = refreshed.clientCookie ?? latestClientCookie(session);
      const liveStack = pruneDeadClientCookies(session.clientCookies, refreshed);
      await store.updateAccountSession(req.user.id, req.params.id, refreshed.sessionCookie, cc, refreshed.sessionExpiry, {
        replaceClientCookies: liveStack,
      });
      await store.logAccountEvent(req.user.id, req.params.id, 'SESSION_REFRESHED', 'Session refreshed via Clerk API');
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
      const keyName = req.body?.keyName;
      let result;
      try {
        result = await dashboardApi.createManagementKey(req.user.id, req.params.id, keyName);
      } catch (err) {
        if (isAuthoritativeSessionFailure(err)) {
          invalidateSnapshotCache(req.params.id);
        }
        throw err;
      }
      if (result?.success === false) {
        if (isAuthoritativeSessionFailure(result)) {
          invalidateSnapshotCache(req.params.id);
        }
        return this.error(
          res,
          result.message || 'Could not provision management key',
          422,
          'PROVISION_FAILED',
          { source: result.source },
        );
      }

      // Key persistence is handled in dashboard-api persistProvisionedManagementKey.
      if (result.key) invalidateSnapshotCache(req.params.id);
      
      return this.success(res, result);
    } catch (err) {
      if (err instanceof ProvisionKeyNotCapturedError || err?.code === 'PROVISION_KEY_NOT_CAPTURED') {
        const debugDir = err.provisionDetails?.debugDir ?? join(tmpdir(), 'hydra-provision-debug');
        return this.error(res, err.message, err.status || 500, err.code || 'PROVISION_KEY_NOT_CAPTURED', {
          hint:
            'Hydra tried dashboard tRPC over HTTP first, then browser UI automation if needed. For stderr step logs use HYDRA_PROVISION_VERBOSE=1; for screenshots/traces/network POST lines use HYDRA_PROVISION_DEBUG=1 and HYDRA_PROVISION_NETWORK_LOG=1. When routes drift, capture live POSTs with scripts/capture-mgmt-key-network.mjs (see docs/recon/TRPC_ROUTES.md).',
          details: err.provisionDetails,
          legacyCode: err.legacyCode ?? 'PROVISION_PLAYWRIGHT_EXTRACT',
          debugDir,
        });
      }
      const msg = err?.message || String(err);
      if (
        msg.includes('Could not extract management key via Playwright') ||
        /Could not capture management key after HTTP/i.test(msg)
      ) {
        const debugDir = join(tmpdir(), 'hydra-provision-debug');
        return this.error(res, msg, err.status || 500, 'PROVISION_KEY_NOT_CAPTURED', {
          hint: `Check server stderr and ${debugDir} (screenshots, provision-network-*.log, provision-trace-*.zip when HYDRA_PROVISION_DEBUG=1). For route drift run scripts/capture-mgmt-key-network.mjs and update docs/recon/TRPC_ROUTES.md (redacted).`,
          legacyCode: 'PROVISION_PLAYWRIGHT_EXTRACT',
          details: { stage: 'browser_ui', debugDir },
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
          return runInBatches(eligible, async (account) => {
            try {
              const result = await dashboardApi.createManagementKey(req.user.id, account.id);
              return { id: account.id, alias: account.alias, ...result };
            } catch (err) {
              return { id: account.id, alias: account.alias, success: false, error: err.message };
            }
          });
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

  /** Return the stored management key for the account (for export / display purposes). */
  async getManagementKey(req, res) {
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.id);
      if (!account.managementKey) {
        return this.error(res, 'No management key stored for this account. Provision one first.', 404);
      }
      return this.success(res, { managementKey: account.managementKey, email: account.email });
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async getSnapshot(req, res) {
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.id);
      
      // Get key from ManagementKey table (new system), not config (old system)
      const { getBestManagementKey } = await import('../services/management-key-store.js');
      const bestKey = await getBestManagementKey(req.params.id);
      
      if (!bestKey) return this.error(res, 'Account has no management key — provision one from the Dashboard or Pool Manager', 400);
      try {
        assertManagementKey(bestKey.key, 'account snapshot');
      } catch (err) {
        return this.error(res, err.message, 400);
      }
      const snapshot = await openrouter.getAccountSnapshot(bestKey.key);
      await store.updateAccountLastSync(req.user.id, req.params.id);

      // Merge local plaintext key strings into snapshot keys (same pattern as KeyController.listKeys)
      const localKeys = await store.getLocalKeys(req.user.id, req.params.id);
      const localMap = new Map(localKeys.map(k => [k.hash, k]));
      if (snapshot.keys?.list) {
        snapshot.keys.list = snapshot.keys.list.map(k => {
          const local = localMap.get(k.hash);
          const plain = typeof local?.key === 'string' && local.key.length > 0 ? local.key : null;
          return { ...k, hasKeyString: !!plain, plaintextKey: plain };
        });
      }

      const mgmtPreview = bestKey.key
        ? bestKey.key.slice(0, 16) + '••••••••' + bestKey.key.slice(-4)
        : null;
      return this.success(res, { id: account.id, alias: account.alias, email: account.email, managementKeyPreview: mgmtPreview, ...snapshot });
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  // New management key storage endpoints
  async listManagementKeys(req, res) {
    try {
      const { getManagementKeys } = await import('../services/management-key-store.js');
      const keys = await getManagementKeys(req.params.id);
      // Return without exposing full key
      const sanitized = keys.map(k => ({
        id: k.id,
        name: k.name,
        status: k.status,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        preview: k.key ? `${k.key.slice(0, 12)}...${k.key.slice(-4)}` : null
      }));
      return this.success(res, { keys: sanitized });
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async storeProvisionedKey(req, res) {
    try {
      const { storeManagementKey } = await import('../services/management-key-store.js');
      const { key, name, metadata } = req.body;
      
      if (!key || !key.startsWith('sk-or-v1-')) {
        return this.error(res, 'Invalid key format', 400);
      }
      
      const stored = await storeManagementKey(req.params.id, key, name || 'Imported Key', metadata);
      return this.success(res, { id: stored.id, name: stored.name, status: stored.status }, 201);
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async getBestManagementKey(req, res) {
    try {
      const { getBestKey } = await import('../services/management-key-store.js');
      const key = await getBestKey(req.params.id);

      if (!key) {
        return this.error(res, 'No active management key found. Provision one first.', 404);
      }

      // Return full key for backend use (UI should warn this is sensitive)
      return this.success(res, {
        id: key.id,
        name: key.name,
        key: key.key, // Full key - handle with care
        status: key.status,
        createdAt: key.createdAt
      });
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async deleteManagementKey(req, res) {
    try {
      const { getManagementKey, revokeManagementKey } = await import('../services/management-key-store.js');
      const { id: accountId, keyId } = req.params;

      const keyRecord = await getManagementKey(keyId);
      if (!keyRecord || keyRecord.accountId !== accountId) {
        return this.error(res, 'Management key not found', 404);
      }

      await revokeManagementKey(keyId);
      return this.success(res, { id: keyId, status: 'revoked' });
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async getBalance(req, res) {
    try {
      const { getBestKey } = await import('../services/management-key-store.js');
      const { getCredits } = await import('../services/openrouter.js');

      const keyRecord = await getBestKey(req.params.id);
      if (!keyRecord) {
        return this.error(res, 'No active management key — provision one first', 404);
      }

      const credits = await getCredits(keyRecord.key);
      return this.success(res, { credits, keyId: keyRecord.id });
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  async testKey(req, res) {
    try {
      const { id, hash } = req.params;
      const localKeys = await store.getLocalKeys(req.user.id, id);
      const localKey = localKeys.find(k => k.hash === hash);
      if (!localKey || !localKey.key) {
        return this.error(res, 'Full key not stored locally — register the key string in Pool Manager first', 400);
      }
      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { 'Authorization': `Bearer ${localKey.key}` },
      });
      const data = await response.json();
      if (!response.ok) {
        const msg = data?.error?.message || data?.message || `OpenRouter returned ${response.status}`;
        return this.error(res, msg, 400);
      }
      return this.success(res, { valid: true, ...data });
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  // P6 — Send Clerk magic link (email_link strategy) for one account
  async sendMagicLink(req, res) {
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.id);
      const email = req.body.email || account.email;
      if (!email) return this.error(res, 'Email required for magic link', 400);

      // Build the callback URL Hydra will receive after the user clicks
      const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3001';
      const callbackUrl = `${proto}://${host}/api/auth/magic-callback?signInId=__SIGN_IN_ID__&accountId=${account.id}`;
      // Note: we replace __SIGN_IN_ID__ placeholder after we get it from Clerk

      const { signInId, clientCookie, isSignUp } = await clerkAuth.sendMagicLink(email, callbackUrl.replace('__SIGN_IN_ID__', 'pending'));

      // Build real callback URL — include isSignUp so the callback handler routes correctly
      const isSignUpParam = isSignUp ? '&isSignUp=1' : '';
      const realCallback = `${proto}://${host}/api/auth/magic-callback?signInId=${encodeURIComponent(signInId)}&accountId=${account.id}${isSignUpParam}`;
      // We store the pending entry so the callback can look it up
      const { pendingMagicLinks } = await import('../services/magic-link-manager.js');
      pendingMagicLinks.set(signInId, {
        accountId: account.id,
        userId: req.user.id,
        clientCookie,
        email,
        isSignUp: isSignUp ?? false,
        createdAt: Date.now(),
      });

      await store.logAccountEvent(req.user.id, account.id, 'MAGIC_LINK_SENT', `Magic link sent to ${email}`);

      return this.success(res, {
        signInId,
        email,
        callbackUrl: realCallback,
        message: `Magic link sent to ${email} — check inbox and click the link`,
      });
    } catch (err) {
      logger.warn(`[ACCOUNT] sendMagicLink failed (account=${req.params.id}): ${err.message}`);
      return this.error(res, err.message, err.status || 500, 'MAGIC_LINK_ERROR');
    }
  }

  // P6 — Poll status of a pending magic link
  async magicLinkStatus(req, res) {
    const signInId = req.params.signInId;
    const { pendingMagicLinks } = await import('../services/magic-link-manager.js');
    const pending = pendingMagicLinks.get(signInId);
    if (!pending) return this.success(res, { status: 'completed_or_expired' });
    return this.success(res, { status: 'pending', email: pending.email });
  }

  /**
   * Live session probe — bypasses the 5-minute in-memory cache.
   * Calls Clerk directly every time; use for the manual "Check Session" button.
   * contrast with getSessionStatus (cached, fast) used by the main dashboard list.
   */
  async checkSession(req, res) {
    try {
      const payload = await store.probeSessionLive(req.user.id, req.params.id);
      return this.success(res, {
        status: payload.status,
        sessionExpiry: payload.sessionExpiry,
        sessionDecryptFailed: payload.sessionDecryptFailed,
        live: payload.live,
      });
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }

  /**
   * Attempt silent cookie refresh. On failure, returns an error WITHOUT wiping the session.
   * Use POST /refresh-login if you want to clear session and be prompted to re-auth.
   */
  async silentRefreshOnly(req, res) {
    try {
      const session = await store.getAccountSession(req.user.id, req.params.id);

      if (!hasRefreshCookie(session)) {
        return this.error(res, 'No client cookie stored — silent refresh not possible. Use Sign In to re-authenticate.', 400);
      }

      let refreshed;
      try {
        const cookieInput851 = session.clientCookies?.length > 0 ? session.clientCookies : session.clientCookie;
        refreshed = await clerkAuth.refreshSession(cookieInput851, session.sessionCookie);
      } catch (err) {
        logger.warn(`[ACCOUNT] Silent refresh failed (account=${req.params.id}): ${err.message}`);
        return this.error(res, 'Silent refresh failed — use Sign In to re-authenticate', 400);
      }

      if (!refreshed?.sessionToken) {
        return this.error(res, 'Silent refresh failed — use Sign In to re-authenticate', 400);
      }

      await store.updateAccountSession(
        req.user.id, req.params.id,
        refreshed.sessionToken,
        refreshed.clientCookie ?? latestClientCookie(session),
        refreshed.sessionExpiry ?? null,
        { replaceClientCookies: pruneDeadClientCookies(session.clientCookies, refreshed) },
      );
      await store.logAccountEvent(req.user.id, req.params.id, 'SILENT_REFRESH', 'Session refreshed silently via client cookie');
      invalidateSnapshotCache(req.params.id);

      return this.success(res, { success: true, sessionExpiry: refreshed.sessionExpiry });
    } catch (err) {
      return this.error(res, err.message, err.status || 500);
    }
  }
}
