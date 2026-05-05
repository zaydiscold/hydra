/**
 * Account Generator Service
 *
 * NOTE (2026-04-24): OpenRouter's Clerk instance now requires CAPTCHA for
 * /client/sign_ups. New account signup therefore cannot be pure HTTP.
 * Hydra still uses direct Clerk FAPI calls for existing-account email OTP and
 * session materialization, and falls back to Playwright for CAPTCHA-gated signup.
 *
 * The Clerk FAPI functions (detectAuthMethod, startEmailOTP, completeEmailOTP, etc.)
 * remain in clerk-auth.js and are actively used for:
 *   - Existing account sign-in
 *   - Session refresh
 *   - Password authentication
 * They are not sufficient for new account signup while CAPTCHA is enabled.
 *
 * Flow:
 * Existing account HTTP flow:
 *   detecting_account → sending_otp → awaiting_otp → verifying_otp →
 *   [activating_session] → saving_profile → provisioning_key → completed
 *
 * New account flow:
 *   detecting_account → falling_back_to_browser → launching_browser →
 *   navigating_signup → awaiting_otp → submitting_otp → completed
 */

/* global document */
import { resolveChromiumLaunchOptions } from '../lib/playwright-browser.js';
import * as store from './store.js';
import * as dashboardApi from './dashboard-api.js';
import { logger } from './logger.js';
import { taskSupervisor } from './task-supervisor.js';
import { USER_AGENT, OR_BASE } from '../config.js';

import {
  detectAuthMethod,
  startEmailOTP,
  completeEmailOTP,
  getJwtExpiry,
  openRouterDashboardDeviceCookies,
  refreshSession,
} from './clerk-auth.js';

// TTL was 2 min (sized for Playwright browser startup + OTP wait).
// 5 min leaves enough time for the user to check email and type the OTP code
// while still cleaning up browser resources promptly.
const GENERATOR_TTL_MS = 5 * 60 * 1000;
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
  // HTTP path never sets page/context/browser on task.resources.
  // Playwright fallback does. Null-safe destructure handles both.
  const { page, context, browser } = task.resources ?? {};

  if (page) {
    await page.close().catch(() => {});
  }
  if (context) {
    await context.close().catch(() => {});
  }
  if (browser) {
    await browser.close().catch(() => {});
  }
}

function trackPromise(task, promise) {
  taskSupervisor.attachResources(task.taskId, { pending: promise });
  promise.finally(() => taskSupervisor.detachPending(task.taskId, promise));
  return promise;
}

// ---------------------------------------------------------------------------
// Playwright fallback — original browser-based signup flow (kept verbatim).
// Only invoked when FAPI calls fail with network/non-retryable errors.
// Do NOT delete this — it provides resilience when Clerk's API is unreachable.
// ---------------------------------------------------------------------------

async function launchSignupFlowPlaywright(task) {
  const promise = (async () => {
    try {
      taskSupervisor.updateTask(task.taskId, { status: 'launching_browser' });
      const launchArgs = [];
      if (process.env.HYDRA_PLAYWRIGHT_NO_SANDBOX === '1') {
        launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
      }
      const { chromium } = await import('playwright');
      const browser = await chromium.launch(resolveChromiumLaunchOptions({ headless: true, args: launchArgs }));
      const context = await browser.newContext({ userAgent: USER_AGENT });
      const page = await context.newPage();
      taskSupervisor.attachResources(task.taskId, { browser, context, page });

      taskSupervisor.updateTask(task.taskId, { status: 'navigating_signup' });
      // Use /sign-up directly (OpenRouter changed from /login?intent=signup)
      await page.goto(`${OR_BASE}/sign-up`, {
        waitUntil: 'domcontentloaded',
        timeout: STARTUP_TIMEOUT_MS,
      });

      // Wait for Next.js/React to hydrate and Clerk to render
      taskSupervisor.updateTask(task.taskId, { status: 'waiting_for_page_hydrate' });
      await page.waitForTimeout(3000);

      // Wait for any form element to appear
      await page.waitForFunction(() => {
        const hasInput = document.querySelector('input[type="email"], input[name="identifier"], input[name="emailAddress"], .cl-formFieldInput');
        const hasButton = document.querySelector('button[type="submit"], button.cl-formButtonPrimary');
        return hasInput || hasButton;
      }, { timeout: STARTUP_TIMEOUT_MS });

      taskSupervisor.updateTask(task.taskId, { status: 'entering_email' });

      // Try multiple email input selectors (OpenRouter/Clerk may vary)
      const emailSelectors = [
        'input[type="email"]',
        'input[name="emailAddress"]',
        'input[name="identifier"]',
        'input[id*="email" i]',
        'input[placeholder*="email" i]',
        'input[autocomplete="email"]',
        '.cl-formFieldInput[type="email"]',
        'input[class*="email" i]',
      ];

      let emailInput = null;
      for (const selector of emailSelectors) {
        const locator = page.locator(selector).first();
        try {
          await locator.waitFor({ state: 'visible', timeout: 5000 });
          emailInput = locator;
          logger.info(`[Account Generator] Found email input using: ${selector}`);
          break;
        } catch {
          // Try next selector
        }
      }

      if (!emailInput) {
        // Dump page HTML for debugging
        const html = await page.content().catch(() => 'failed to get HTML');
        logger.error(`[Account Generator] Could not find email input. Page HTML snippet: ${html.slice(0, 2000)}`);
        throw new Error('Could not find email input field - page may have changed');
      }

      await emailInput.fill(task.metadata.email);
      await page.waitForTimeout(500);

      // Try multiple continue button selectors
      const continueSelectors = [
        'button:has-text("Continue")',
        'button[type="submit"]',
        'button.cl-formButtonPrimary',
        'button:has-text("Sign up")',
        'button:has-text("Next")',
        'button.cl-button',
        'button[class*="primary" i]',
      ];

      let clicked = false;
      for (const selector of continueSelectors) {
        const btn = page.locator(selector).first();
        try {
          if (await btn.isVisible({ timeout: 2000 })) {
            await btn.click();
            logger.info(`[Account Generator] Clicked continue using: ${selector}`);
            clicked = true;
            break;
          }
        } catch {
          // Try next
        }
      }

      if (!clicked) {
        // Try pressing Enter as fallback
        await emailInput.press('Enter');
        logger.info('[Account Generator] Used Enter key fallback');
      }

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

async function finalizeOtpSubmissionPlaywright(task, otpCode) {
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
      let sessionCookie = cookies.find(cookie => cookie.name === '__session')?.value;
      if (!sessionCookie) throw new Error('Signup succeeded but could not extract __session cookie');

      // Build a cookie jar string from all Playwright cookies for proper serialization
      const cookieJarString = cookies
        .filter(c => c.value && c.value.trim() !== '')
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

      // Serialize ALL device cookies (Clerk + Cloudflare) using same logic as clerk-auth.js
      const allDeviceCookies = openRouterDashboardDeviceCookies(cookieJarString);

      // OTP-created sessions can have very short initial expiry (1-5 minutes).
      // Wait for Clerk propagation and try to get a proper long-lived session.
      const initialExpiry = getJwtExpiry(sessionCookie);
      const initialExpiryMs = new Date(initialExpiry).getTime();
      const nowMs = Date.now();
      const ONE_HOUR = 60 * 60 * 1000;

      if (initialExpiryMs - nowMs < ONE_HOUR) {
        taskSupervisor.updateTask(task.taskId, { status: 'activating_long_lived_session' });
        logger.info(`[Account Generator] Short-lived session detected (${Math.round((initialExpiryMs - nowMs)/1000)}s), activating long-lived session...`);

        // Wait for Clerk propagation (OTP sessions take 2-4 seconds to propagate)
        await new Promise(r => setTimeout(r, 1000));

        // Try to refresh using the client cookie AND expired session to get a proper session
        const refreshed = await refreshSession(allDeviceCookies, sessionCookie);
        if (refreshed && refreshed.sessionCookie) {
          const refreshedExpiryMs = new Date(refreshed.sessionExpiry).getTime();
          if (refreshedExpiryMs - nowMs > ONE_HOUR) {
            logger.info(`[Account Generator] Got long-lived session (${Math.round((refreshedExpiryMs - nowMs)/1000/60)}min)`);
            sessionCookie = refreshed.sessionCookie;
          } else {
            logger.warn(`[Account Generator] Refreshed session still short-lived (${Math.round((refreshedExpiryMs - nowMs)/1000)}s)`);
          }
        } else {
          logger.warn('[Account Generator] Could not refresh to long-lived session');
        }
      }

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
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7-day realistic session TTL
        { isNewLogin: true },
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

// ---------------------------------------------------------------------------
// HTTP-first generator flow. Existing-account OTP can be completed with direct
// Clerk FAPI requests. Brand-new signup is CAPTCHA-gated upstream, so unknown
// accounts fall back to the browser path.
// ---------------------------------------------------------------------------

async function launchSignupFlow(task) {
  const promise = (async () => {
    try {
      taskSupervisor.updateTask(task.taskId, { status: 'detecting_account' });

      let authInfo;
      try {
        authInfo = await detectAuthMethod(task.metadata.email);
      } catch (fapiErr) {
        logger.warn(`[Account Generator] FAPI detectAuthMethod failed for ${task.metadata.email}: ${fapiErr.message} — falling back to browser`);
        taskSupervisor.updateTask(task.taskId, { status: 'falling_back_to_browser' });
        return launchSignupFlowPlaywright(task);
      }

      if (authInfo?.isSignUp) {
        logger.warn(`[Account Generator] Clerk reported sign-up for ${task.metadata.email}, but sign_up preparation is CAPTCHA-gated — falling back to browser`);
        taskSupervisor.updateTask(task.taskId, { status: 'falling_back_to_browser' });
        return launchSignupFlowPlaywright(task);
      }

      taskSupervisor.updateTask(task.taskId, { status: 'sending_otp' });
      let otpInfo;
      try {
        otpInfo = await startEmailOTP(task.metadata.email);
      } catch (fapiErr) {
        logger.warn(`[Account Generator] FAPI startEmailOTP failed for ${task.metadata.email}: ${fapiErr.message} — falling back to browser`);
        taskSupervisor.updateTask(task.taskId, { status: 'falling_back_to_browser' });
        return launchSignupFlowPlaywright(task);
      }

      taskSupervisor.attachResources(task.taskId, {
        signInId: otpInfo.signInId,
        clientCookie: otpInfo.clientCookie,
        isSignUp: otpInfo.isSignUp,
        httpMode: true,
      });

      taskSupervisor.updateTask(task.taskId, { status: 'awaiting_otp' });
      logger.info(`[Account Generator] OTP sent to ${task.metadata.email} via Clerk FAPI`);
    } catch (err) {
      logger.error(`[Account Generator] Launch failed: ${err.message}`);
      await taskSupervisor.fail(task.taskId, err);
    }
  })();
  return trackPromise(task, promise);
}

async function finalizeOtpSubmission(task, otpCode) {
  const promise = (async () => {
    try {
      // HTTP tasks carry signInId/clientCookie in resources. Browser fallback
      // tasks carry page/context/browser and complete through Playwright.
      if (!task.resources?.httpMode) {
        return finalizeOtpSubmissionPlaywright(task, otpCode);
      }

      const { signInId, clientCookie, isSignUp } = task.resources ?? {};
      if (!signInId || !clientCookie) {
        throw new Error('OTP session state missing. Start a new job.');
      }

      taskSupervisor.updateTask(task.taskId, { status: 'verifying_otp' });

      const session = await completeEmailOTP(signInId, otpCode, clientCookie, { isSignUp });

      if (!session?.sessionCookie) {
        throw new Error('OTP verified but no session cookie returned from Clerk');
      }

      let sessionCookie = session.sessionCookie;
      let deviceCookies = session.clientCookie;

      // OTP-created sessions often have very short JWT lifetime (1-5 minutes).
      // Try to upgrade to a proper long-lived session via refreshSession.
      // refreshSession accepts EITHER a string OR a [{cookie, issuedAt}] array.
      const initialExpiry = getJwtExpiry(sessionCookie);
      const ONE_HOUR = 60 * 60 * 1000;
      if (new Date(initialExpiry).getTime() - Date.now() < ONE_HOUR) {
        taskSupervisor.updateTask(task.taskId, { status: 'activating_session' });
        await new Promise(r => setTimeout(r, 1000)); // Clerk propagation delay (OTP sessions need 1-4s)
        const allDeviceCookies = openRouterDashboardDeviceCookies(deviceCookies);
        const refreshed = await refreshSession(allDeviceCookies, sessionCookie);
        if (refreshed?.sessionCookie &&
            new Date(refreshed.sessionExpiry || 0).getTime() - Date.now() > ONE_HOUR) {
          sessionCookie = refreshed.sessionCookie;
          logger.info('[Account Generator] Upgraded to long-lived session via refresh');
        } else {
          logger.warn('[Account Generator] Session still short-lived after refresh attempt');
        }
      }

      taskSupervisor.updateTask(task.taskId, { status: 'saving_profile' });
      // openRouterDashboardDeviceCookies returns [{cookie, issuedAt}] array (Exploit #14 cookie stacking).
      // updateAccountSession expects this array — do NOT join it into a string.
      const allDeviceCookies = openRouterDashboardDeviceCookies(deviceCookies);
      const accountAlias = task.metadata.email.split('@')[0];

      const newAccount = await store.addAccountWithCredentials(
        task.ownerUserId,
        accountAlias,
        task.metadata.email,
        task.metadata.password,
        isSignUp ? 'password' : 'otp',
      );

      await store.updateAccountSession(
        task.ownerUserId,
        newAccount.id,
        sessionCookie,
        allDeviceCookies,
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7-day realistic Clerk session TTL
        { isNewLogin: true },
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
      logger.error(`[Account Generator] OTP finalization failed: ${err.message}`);
      await taskSupervisor.fail(task.taskId, err);
    }
  })();
  return trackPromise(task, promise);
}

// ============================================================================
// Public API surface — these 5 exports are called by GeneratorController.
// Do NOT change signatures without updating GeneratorController.js and the route.
// ============================================================================

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

  // Fire-and-forget — the promise is tracked via trackPromise inside launchSignupFlow.
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

  // Fire-and-forget — the promise is tracked via trackPromise inside finalizeOtpSubmission.
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
