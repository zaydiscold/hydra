/* global document */
import { chromium } from 'playwright';
import * as store from './store.js';
import * as dashboardApi from './dashboard-api.js';
import { logger } from './logger.js';
import { taskSupervisor } from './task-supervisor.js';
import { USER_AGENT, OR_BASE } from '../config.js';
import { getJwtExpiry, openRouterDashboardDeviceCookies } from './clerk-auth.js';

const GENERATOR_TTL_MS = 2 * 60 * 1000;
const STARTUP_TIMEOUT_MS = 45 * 1000;
const OTP_WAIT_TIMEOUT_MS = 30 * 1000;
const COMPLETION_TIMEOUT_MS = 30 * 1000;

function serializeGeneratorTask(task) {
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

function getRecentGeneratorTask(taskId, ownerUserId) {
  return taskSupervisor
    .listRecent(ownerUserId)
    .find(task => task.taskId === taskId && task.type === 'generator_job') ?? null;
}

function getGeneratorTask(taskId, ownerUserId) {
  try {
    const active = taskSupervisor.assertOwnership(taskId, ownerUserId);
    if (active.type !== 'generator_job') {
      throw new Error('Task not found');
    }
    return active;
  } catch {
    const recent = getRecentGeneratorTask(taskId, ownerUserId);
    if (recent) return recent;
    return null;
  }
}

async function closeGeneratorResources(task) {
  const { page, context, browser } = task.resources;

  if (page) {
    await page.close().catch(() => {});
    task.resources.page = null;
  }
  if (context) {
    await context.close().catch(() => {});
    task.resources.context = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    task.resources.browser = null;
  }
}

function trackPromise(task, promise) {
  taskSupervisor.attachResources(task.taskId, { pending: promise });
  promise.finally(() => taskSupervisor.detachPending(task.taskId, promise));
  return promise;
}

async function launchSignupFlow(task) {
  const promise = (async () => {
    try {
      taskSupervisor.updateTask(task.taskId, { status: 'launching_browser' });
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ userAgent: USER_AGENT });
      const page = await context.newPage();
      taskSupervisor.attachResources(task.taskId, { browser, context, page });

      taskSupervisor.updateTask(task.taskId, { status: 'navigating_signup' });
      await page.goto(`${OR_BASE}/login?intent=signup`, {
        waitUntil: 'networkidle',
        timeout: STARTUP_TIMEOUT_MS,
      });

      taskSupervisor.updateTask(task.taskId, { status: 'entering_email' });
      const emailInput = page.locator('input[type="email"], input[name="emailAddress"]').first();
      await emailInput.waitFor({ state: 'visible', timeout: STARTUP_TIMEOUT_MS });
      await emailInput.fill(task.metadata.email);
      await page.waitForTimeout(1000);

      const continueBtn = page.locator('button:has-text("Continue"), button[type="submit"], button.cl-formButtonPrimary').first();
      await continueBtn.click();

      taskSupervisor.updateTask(task.taskId, { status: 'waiting_for_otp_screen' });
      await page.waitForFunction(() => {
        const text = document.body?.innerText?.toLowerCase?.() || '';
        return text.includes('check your email') || text.includes('verification code') || text.includes('enter code');
      }, { timeout: OTP_WAIT_TIMEOUT_MS });

      taskSupervisor.updateTask(task.taskId, { status: 'awaiting_otp' });
    } catch (err) {
      logger.error(`[Account Generator] Launch failed for ${task.taskId}: ${err.message}`);
      await taskSupervisor.fail(task.taskId, err);
    }
  })();

  return trackPromise(task, promise);
}

async function finalizeOtpSubmission(task, otpCode) {
  const promise = (async () => {
    try {
      const page = task.resources.page;
      const context = task.resources.context;
      if (!page || !context) {
        throw new Error('Job resources were lost before OTP submission. Start a new generation job.');
      }

      taskSupervisor.updateTask(task.taskId, { status: 'submitting_otp' });
      const firstDigitInput = page
        .locator('input[autocomplete="one-time-code"], input.cl-otpCodeFieldInput, input[data-testid*="otp"], input[maxlength="1"][type="text"], input[maxlength="1"][type="tel"]')
        .first();
      await firstDigitInput.waitFor({ state: 'visible', timeout: 5000 });
      await firstDigitInput.click();
      await page.keyboard.type(otpCode, { delay: 100 });

      taskSupervisor.updateTask(task.taskId, { status: 'waiting_for_completion' });
      await page.waitForURL(/.*(settings|chat|dashboard).*/, { timeout: COMPLETION_TIMEOUT_MS }).catch(async () => {
        const pwdInput = page.locator('input[type="password"]');
        if (await pwdInput.count() > 0 && await pwdInput.first().isVisible()) {
          taskSupervisor.updateTask(task.taskId, { status: 'setting_password' });
          await pwdInput.first().fill(task.metadata.password);
          await page.click('button[type="submit"], button:has-text("Continue")').catch(() => {});
          await page.waitForURL(/.*(settings|chat|dashboard).*/, { timeout: 15000 });
          return;
        }

        await page.waitForFunction(() => {
          const text = document.body?.innerText?.toLowerCase?.() || '';
          return text.includes('settings')
            || text.includes('billing')
            || text.includes('dashboard')
            || text.includes('management keys');
        }, { timeout: 15000 });
      });

      taskSupervisor.updateTask(task.taskId, { status: 'extracting_session' });
      const cookies = await context.cookies('https://openrouter.ai');
      const sessionCookie = cookies.find(cookie => cookie.name === '__session')?.value;
      if (!sessionCookie) throw new Error('Signup succeeded but could not extract __session cookie');

      // Build a cookie jar string from all Playwright cookies for proper serialization
      const cookieJarString = cookies
        .filter(c => c.value && c.value.trim() !== '')
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

      // Serialize ALL device cookies (Clerk + Cloudflare) using same logic as clerk-auth.js
      const allDeviceCookies = openRouterDashboardDeviceCookies(cookieJarString);

      taskSupervisor.updateTask(task.taskId, { status: 'saving_local_profile' });
      const accountAlias = task.metadata.email.split('@')[0];
      const newAccount = await store.addAccountWithCredentials(
        task.ownerUserId,
        accountAlias,
        task.metadata.email,
        task.metadata.password,
        'password',
      );

      await store.updateAccountSession(
        task.ownerUserId,
        newAccount.id,
        sessionCookie,
        allDeviceCookies,
        getJwtExpiry(sessionCookie),
      );

      taskSupervisor.updateTask(task.taskId, {
        status: 'provisioning_key',
        metadata: { account: newAccount },
      });
      const provisioned = await dashboardApi.createManagementKey(
        task.ownerUserId,
        newAccount.id,
        `Hydra Gen ${accountAlias}`,
      );
      if (provisioned?.success === false) {
        throw new Error(provisioned.message || 'Management key provisioning failed');
      }

      await taskSupervisor.complete(task.taskId, { account: newAccount });
    } catch (err) {
      logger.error(`[Account Generator] OTP submission failed for ${task.taskId}: ${err.message}`);
      await taskSupervisor.fail(task.taskId, err);
    }
  })();

  return trackPromise(task, promise);
}

export async function startSignupJob(userId, emailTemplate, alias, password) {
  const task = await taskSupervisor.startInteractive({
    type: 'generator_job',
    ownerUserId: userId,
    ttlMs: GENERATOR_TTL_MS,
    metadata: {
      email: alias,
      emailTemplate,
      password,
    },
    cleanup: closeGeneratorResources,
  });

  void launchSignupFlow(task);
  return serializeGeneratorTask(task);
}

export async function submitOtpForJob(taskId, ownerUserId, otpCode) {
  const task = taskSupervisor.assertOwnership(taskId, ownerUserId);
  if (task.type !== 'generator_job') {
    const error = new Error('Task not found');
    error.status = 404;
    throw error;
  }
  if (task.status !== 'awaiting_otp') {
    const error = new Error(`Cannot submit OTP in status: ${task.status}`);
    error.status = 409;
    throw error;
  }

  void finalizeOtpSubmission(task, otpCode);
  return { success: true, message: 'OTP submitted, completing signup...' };
}

export function getSignupJob(taskId, ownerUserId) {
  const task = getGeneratorTask(taskId, ownerUserId);
  if (!task) return null;
  return serializeGeneratorTask(task);
}

export function heartbeatJob(taskId, ownerUserId) {
  const task = taskSupervisor.heartbeat(taskId, ownerUserId);
  return serializeGeneratorTask(task);
}

export async function cleanupJob(taskId, ownerUserId, reason = 'cancelled') {
  const task = taskSupervisor.assertOwnership(taskId, ownerUserId);
  if (task.type !== 'generator_job') {
    const error = new Error('Task not found');
    error.status = 404;
    throw error;
  }

  await taskSupervisor.cancel(task.taskId, reason);
  return { success: true };
}
