/**
 * API-based OTP Account Generator
 * Uses Clerk API directly instead of browser automation
 */

import * as store from './store.js';
import { logger } from './logger.js';
import { taskSupervisor } from './task-supervisor.js';
import { startEmailOTP, completeEmailOTP } from './clerk-auth.js';

const GENERATOR_TTL_MS = 5 * 60 * 1000; // 5 minutes for OTP flow

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
  // Check for existing active task
  const existing = taskSupervisor
    .listActive(ownerUserId)
    .find(t => t.type === 'otp_signup_job');
  if (existing) {
    const err = new Error('An account generation job is already running. Wait for it to complete or cancel it.');
    err.code = 'TASK_BUSY';
    throw err;
  }

  const task = taskSupervisor.createTask(ownerUserId, {
    type: 'otp_signup_job',
    status: 'starting',
    metadata: { email, password, ownerUserId },
    ttlMs: GENERATOR_TTL_MS,
  });

  // Start the OTP flow
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
      
      // Store the OTP session data for later verification
      taskSupervisor.attachResources(task.taskId, {
        signInId: otpStart.signInId,
        clientCookie: otpStart.clientCookie,
        emailAddressId: otpStart.emailAddressId,
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

  const { signInId, clientCookie } = task.resources || {};
  if (!signInId || !clientCookie) {
    throw new Error('OTP session data missing. Start a new signup job.');
  }

  const promise = (async () => {
    try {
      taskSupervisor.updateTask(task.taskId, { status: 'verifying_otp' });
      logger.info(`[OTP Generator] Verifying OTP code`);
      
      // Complete the OTP verification
      const session = await completeEmailOTP(signInId, code, clientCookie);
      
      if (!session || !session.sessionCookie) {
        throw new Error('OTP verification succeeded but no session returned');
      }
      
      logger.info(`[OTP Generator] OTP verified, session obtained`);
      taskSupervisor.updateTask(task.taskId, { status: 'saving_account' });
      
      // Save the account to database
      const { email, password, ownerUserId } = task.metadata;
      const alias = email;
      
      // Create account record
      const account = await store.createAccount(ownerUserId, {
        alias,
        email,
        password, // May be null for OTP-only accounts
        authMethod: 'otp',
        sessionCookie: session.sessionCookie,
        clientCookie: session.clientCookie,
        sessionExpiry: session.sessionExpiry,
        requiresProvisioning: true, // Will need to generate management key
      });
      
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
 */
export async function cleanupOtpJob(taskId, ownerUserId, reason = 'cancelled') {
  return taskSupervisor.cleanup(taskId, ownerUserId, reason);
}

/**
 * Heartbeat to keep job alive
 */
export function heartbeatOtpJob(taskId, ownerUserId) {
  return taskSupervisor.heartbeat(taskId, ownerUserId);
}
