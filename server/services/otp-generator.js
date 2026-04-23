/**
 * API-based OTP Account Generator
 *
 * MIGRATION NOTE (2026-04-21):
 * This file was dead code — it called 4 APIs that don't exist:
 *   taskSupervisor.createTask() → should be startInteractive()
 *   store.createAccount() → should be addAccountWithCredentials() + updateAccountSession()
 *   taskSupervisor.cleanup() → should be cancel()
 *   heartbeatOtpJob() returned raw task → should wrap in serializeTask()
 *
 * All 4 bugs have been fixed. Plus: session.clientCookie is now piped through
 * openRouterDashboardDeviceCookies() before updateAccountSession() — the raw
 * string from completeEmailOTP() is the wrong type; updateAccountSession()
 * expects a [{cookie, issuedAt}] array.
 *
 * IMPORTANT: This file is currently DEAD CODE — nothing in the active
 * codebase imports it. GeneratorController uses account-generator.js only.
 * The fixes are correct but won't run until someone wires this into a route.
 */

import * as store from './store.js';
import { logger } from './logger.js';
import { taskSupervisor } from './task-supervisor.js';

// openRouterDashboardDeviceCookies is needed to convert the raw cookie string
// from completeEmailOTP() into the [{cookie, issuedAt}] array that
// updateAccountSession() expects. Without this, stored sessions break on refresh.
import { startEmailOTP, completeEmailOTP, openRouterDashboardDeviceCookies } from './clerk-auth.js';

// 5 minutes — OTP email delivery + user typing time. No Playwright startup needed.
const GENERATOR_TTL_MS = 5 * 60 * 1000;

function serializeTask(task) {
  const payload = taskSupervisor.serializeTask(task);
  return {
    taskId: payload.taskId,
    jobId: payload.taskId,
    status: payload.status,
    email: payload.metadata?.email ?? null,
    error: payload.error,
    account: payload.result?.account ?? payload.metadata?.account ?? null,
    startedAt: payload.startedAt,
    endedAt: payload.endedAt,
    lastHeartbeatAt: payload.lastHeartbeatAt,
    ttlMs: payload.ttlMs,
    cancelReason: payload.cancelReason,
  };
}

/**
 * Start OTP-based account creation
 * @param {string} ownerUserId
 * @param {string} email - Email address for the new account
 * @param {string} password - Optional password to set after signup
 * @returns {Promise<{taskId, status, email}>}
 */
export async function startOtpSignup(ownerUserId, email, password = null) {
  // FIX (was createTask() which doesn't exist):
  // startInteractive() handles TASK_BUSY internally — no need for duplicate check.
  const task = await taskSupervisor.startInteractive({
    type: 'otp_signup_job',
    ownerUserId,
    ttlMs: GENERATOR_TTL_MS,
    metadata: { email, password },
    cleanup: async () => {}, // no browser resources to clean up (pure HTTP path)
  });

  // Start the OTP flow in the background.
  launchOtpFlow(task);

  return serializeTask(task);
}

async function launchOtpFlow(task) {
  const promise = (async () => {
    try {
      const { email } = task.metadata;

      // Step 1: Start OTP - this sends the email
      taskSupervisor.updateTask(task.taskId, { status: 'sending_otp_email' });
      logger.info(`[OTP Generator] Sending OTP to ${email}`);

      const otpStart = await startEmailOTP(email);

      // Store the OTP session data for later verification (including isSignUp flag)
      taskSupervisor.attachResources(task.taskId, {
        signInId: otpStart.signInId,
        clientCookie: otpStart.clientCookie,
        emailAddressId: otpStart.emailAddressId,
        isSignUp: otpStart.isSignUp,
      });

      logger.info(`[OTP Generator] OTP sent to ${email}, awaiting code`);
      taskSupervisor.updateTask(task.taskId, { status: 'awaiting_otp' });

    } catch (err) {
      logger.error(`[OTP Generator] Failed to send OTP: ${err.message}`);
      await taskSupervisor.fail(task.taskId, err);
    }
  })();

  taskSupervisor.attachResources(task.taskId, { pending: promise });
  promise.finally(() => taskSupervisor.detachPending(task.taskId, promise));
}

/**
 * Submit the 6-digit OTP code from email
 * @param {string} taskId
 * @param {string} ownerUserId
 * @param {string} code - 6-digit OTP code
 * @returns {Promise<{success, account}>}
 */
export async function submitOtpCode(taskId, ownerUserId, code) {
  const task = taskSupervisor.assertOwnership(taskId, ownerUserId);
  if (task.type !== 'otp_signup_job') {
    throw new Error('Task not found');
  }
  if (task.status !== 'awaiting_otp') {
    throw new Error(`Cannot submit OTP: task status is ${task.status}, expected awaiting_otp`);
  }

  const { signInId, clientCookie, isSignUp } = task.resources || {};
  if (!signInId || !clientCookie) {
    throw new Error('OTP session data missing. Start a new signup job.');
  }

  const promise = (async () => {
    try {
      taskSupervisor.updateTask(task.taskId, { status: 'verifying_otp' });
      logger.info(`[OTP Generator] Verifying OTP code`);

      // FIX: pass isSignUp flag so completeEmailOTP hits the right Clerk endpoint
      // (sign_ups/:id/attempt_email_address_verification vs sign_ins/:id/attempt_first_factor)
      const session = await completeEmailOTP(signInId, code, clientCookie, { isSignUp });

      if (!session || !session.sessionCookie) {
        throw new Error('OTP verification succeeded but no session returned');
      }

      logger.info(`[OTP Generator] OTP verified, session obtained`);
      taskSupervisor.updateTask(task.taskId, { status: 'saving_account' });

      // Save the account to database
      const { email, password, ownerUserId } = task.metadata;
      const alias = email;

      // FIX (was store.createAccount() which doesn't exist):
      // Use the two-call pattern matching account-generator.js.
      const account = await store.addAccountWithCredentials(
        ownerUserId,
        alias,
        email,
        password ?? null,
        'otp',
      );

      // FIX: completeEmailOTP returns clientCookie as a raw string.
      // updateAccountSession expects a [{cookie, issuedAt}] array.
      // Pipe through openRouterDashboardDeviceCookies to get the right type.
      const allDeviceCookies = openRouterDashboardDeviceCookies(session.clientCookie);

      await store.updateAccountSession(
        ownerUserId,
        account.id,
        session.sessionCookie,
        allDeviceCookies,
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        { isNewLogin: true },
      );

      logger.info(`[OTP Generator] Account saved: ${account.id}`);

      // Complete the task
      await taskSupervisor.complete(task.taskId, { account });

      return { success: true, account };

    } catch (err) {
      logger.error(`[OTP Generator] OTP verification failed: ${err.message}`);
      await taskSupervisor.fail(task.taskId, err);
      throw err;
    }
  })();

  taskSupervisor.attachResources(task.taskId, { pending: promise });
  return promise;
}

/**
 * Get task status
 */
export function getOtpSignupStatus(taskId, ownerUserId) {
  try {
    const task = taskSupervisor.assertOwnership(taskId, ownerUserId);
    if (task.type !== 'otp_signup_job') return null;
    return serializeTask(task);
  } catch {
    // Check recent tasks
    const recent = taskSupervisor
      .listRecent(ownerUserId)
      .find(t => t.taskId === taskId && t.type === 'otp_signup_job');
    return recent ? serializeTask(recent) : null;
  }
}

/**
 * Cleanup/cancel a job
 * FIX (was taskSupervisor.cleanup() which doesn't exist → taskSupervisor.cancel())
 */
export async function cleanupOtpJob(taskId, ownerUserId, reason = 'cancelled') {
  return taskSupervisor.cancel(taskId, reason);
}

/**
 * Heartbeat to keep job alive
 * FIX (was returning raw task object; now wraps in serializeTask() for consistent shape)
 */
export function heartbeatOtpJob(taskId, ownerUserId) {
  const task = taskSupervisor.heartbeat(taskId, ownerUserId);
  return serializeTask(task);
}
