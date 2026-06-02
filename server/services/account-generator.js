/**
 * Account Generator Service
 *
 * NOTE: OpenRouter's Clerk instance now requires CAPTCHA for
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

/* global document, window */
import {
  cleanupEphemeralProfileDir,
  launchChromiumPersistentContext,
  resolveChromiumLaunchOptions,
} from '../lib/playwright-browser.js';
import * as store from './store.js';
import * as dashboardApi from './dashboard-api.js';
import { logger } from './logger.js';
import { taskSupervisor } from './task-supervisor.js';
import { USER_AGENT, OR_BASE, config } from '../config.js';
import { sleepWithSignal, throwIfAborted } from '../lib/abort.js';
import {
  describeAutomationNetworkRoute,
  mergeAutomationLaunchArgs,
  pickAutomationNetworkRoute,
  playwrightProxyForAutomation,
} from './automation-network.js';

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
const OTP_CHECK_INTERVAL_MS = 350;
const SIGNUP_FORM_BLOCKED_GRACE_MS = 3 * 1000;
const MANUAL_VERIFICATION_TIMEOUT_MS = 4 * 60 * 1000;
const COMPLETION_TIMEOUT_MS = 30 * 1000;
const OTP_INPUT_SELECTOR = [
  'input[autocomplete="one-time-code"]',
  'input.cl-otpCodeFieldInput',
  'input[data-testid*="otp" i]',
  'input[data-testid*="code" i]',
  'input[name*="code" i]',
  'input[id*="code" i]',
  'input[aria-label*="code" i]',
  'input[placeholder*="code" i]',
  'input[inputmode="numeric"]',
  'input[maxlength="6"]',
  'input[maxlength="1"][type="text"]',
  'input[maxlength="1"][type="tel"]',
].join(', ');

function serializeGeneratorTask(task) {
  const payload = taskSupervisor.serializeTask(task);
  return {
    taskId: payload.taskId,
    jobId: payload.taskId,
    status: payload.status,
    email: payload.metadata?.email ?? null,
    error: payload.error,
    account: payload.result?.account ?? payload.metadata?.account ?? null,
    mode: payload.metadata?.mode ?? null,
    automationRoute: payload.metadata?.automationRoute ?? null,
    checkpoint: payload.metadata?.checkpoint ?? null,
    startedAt: payload.startedAt,
    endedAt: payload.endedAt,
    lastHeartbeatAt: payload.lastHeartbeatAt,
    ttlMs: payload.ttlMs,
    cancelReason: payload.cancelReason,
  };
}

async function readSignupCheckpoint(page) {
  return page.evaluate((otpSelector) => {
    const text = document.body?.innerText?.toLowerCase?.() || '';
    const formInputs = Array.from(document.querySelectorAll('input'));
    const passwordInput = formInputs.find((input) => input.type === 'password' || /password/i.test(`${input.name || ''} ${input.id || ''} ${input.placeholder || ''}`));
    const legalCheckbox = formInputs.find((input) => input.type === 'checkbox' && /legal|terms|privacy|agree|accepted/i.test(`${input.name || ''} ${input.id || ''} ${input.getAttribute('aria-label') || ''}`));
    const signupFormVisible = Boolean(passwordInput || legalCheckbox)
      || text.includes('create your account')
      || text.includes('password')
      || text.includes('terms of service');
    const passwordBlocked = Boolean(passwordInput)
      && !passwordInput.value
      && (text.includes('password') || text.includes('8 or more characters'));
    const legalBlocked = Boolean(legalCheckbox)
      && !legalCheckbox.checked
      && (text.includes('terms of service') || text.includes('privacy policy') || text.includes('model terms') || text.includes('i agree'));
    const turnstileProbe = document.querySelector('input[name="cf-turnstile-response"], input[name*="turnstile" i], [id*="cf-chl-widget"], [class*="turnstile" i]');
    const turnstilePending = Boolean(turnstileProbe)
      && (!('value' in turnstileProbe) || !String(turnstileProbe.value || '').trim());
    const otpVisible = text.includes('check your email')
      || text.includes('verification code')
      || text.includes('verify your email')
      || text.includes('enter code')
      || text.includes('enter the code')
      || text.includes('one-time code')
      || text.includes('code sent')
      || Boolean(document.querySelector(otpSelector));
    const manualVisible = text.includes('captcha')
      || text.includes('verify you are human')
      || text.includes('human verification')
      || text.includes('security check')
      || text.includes('checking if the site connection is secure')
      || text.includes('review the security of your connection')
      || turnstilePending
      || Boolean(document.querySelector('iframe[src*="captcha" i], iframe[src*="turnstile" i], iframe[src*="hcaptcha" i], iframe[src*="recaptcha" i], iframe[src*="challenges.cloudflare.com" i], .cf-turnstile, [data-sitekey], [class*="captcha" i], [id*="captcha" i]'));
    return {
      otpVisible,
      manualVisible,
      signupFormVisible,
      signupBlocked: !otpVisible && !manualVisible && signupFormVisible && (passwordBlocked || legalBlocked),
      passwordBlocked,
      legalBlocked,
      url: document.location.href,
      title: document.title || '',
    };
  }, OTP_INPUT_SELECTOR).catch((err) => ({
    otpVisible: false,
    manualVisible: false,
    signupFormVisible: false,
    signupBlocked: false,
    passwordBlocked: false,
    legalBlocked: false,
    url: page.url?.() ?? 'unknown',
    title: '',
    error: err.message,
  }));
}

function summarizeSignupCheckpoint(checkpoint) {
  if (!checkpoint) return null;
  let state = 'unknown';
  if (checkpoint.otpVisible) state = 'otp';
  else if (checkpoint.manualVisible) state = 'manual_verification';
  else if (checkpoint.signupBlocked) state = 'signup_blocked';
  else if (checkpoint.signupFormVisible) state = 'signup_form';
  return {
    state,
    url: checkpoint.url,
    title: checkpoint.title,
    passwordBlocked: Boolean(checkpoint.passwordBlocked),
    legalBlocked: Boolean(checkpoint.legalBlocked),
    error: checkpoint.error || null,
  };
}

function updateTaskCheckpoint(task, checkpoint, extraMetadata = {}) {
  taskSupervisor.updateTask(task.taskId, {
    metadata: {
      ...task.metadata,
      ...extraMetadata,
      checkpoint: summarizeSignupCheckpoint(checkpoint),
    },
  });
}

async function waitForOtpChallenge(task, page) {
  const signal = task.abortController.signal;
  const startedAt = Date.now();
  let manualReported = false;
  let blockedSince = 0;
  let lastCheckpointReportAt = 0;

  while (Date.now() - startedAt < OTP_WAIT_TIMEOUT_MS) {
    throwIfAborted(signal);
    const checkpoint = await readSignupCheckpoint(page);
    if (Date.now() - lastCheckpointReportAt >= 2 * 1000) {
      updateTaskCheckpoint(task, checkpoint, { mode: 'browser_signup' });
      lastCheckpointReportAt = Date.now();
    }
    if (checkpoint.otpVisible) return;
    if (checkpoint.manualVisible) {
      manualReported = true;
      taskSupervisor.updateTask(task.taskId, {
        status: 'manual_verification',
        metadata: {
          ...task.metadata,
          mode: 'browser_signup',
          checkpoint: summarizeSignupCheckpoint(checkpoint),
        },
      });
      logger.warn(`[Account Generator] Manual upstream verification visible for ${task.taskId}; waiting for OTP screen in the isolated browser`);
      break;
    }
    if (checkpoint.signupBlocked) {
      blockedSince ||= Date.now();
      if (Date.now() - blockedSince >= SIGNUP_FORM_BLOCKED_GRACE_MS) {
        const fields = [
          checkpoint.passwordBlocked ? 'password' : null,
          checkpoint.legalBlocked ? 'terms acceptance' : null,
        ].filter(Boolean).join(' and ') || 'required signup fields';
        const err = new Error(`OpenRouter signup form did not advance because ${fields} is still required; current page ${checkpoint.url}`);
        err.code = 'GENERATOR_SIGNUP_FORM_BLOCKED';
        updateTaskCheckpoint(task, checkpoint, { mode: 'browser_signup' });
        throw err;
      }
    } else {
      blockedSince = 0;
    }
    await sleepWithSignal(OTP_CHECK_INTERVAL_MS, signal);
  }

  if (manualReported) {
    const manualStartedAt = Date.now();
    while (Date.now() - manualStartedAt < MANUAL_VERIFICATION_TIMEOUT_MS) {
      throwIfAborted(signal);
      const checkpoint = await readSignupCheckpoint(page);
      if (Date.now() - lastCheckpointReportAt >= 2 * 1000) {
        updateTaskCheckpoint(task, checkpoint, { mode: 'browser_signup' });
        lastCheckpointReportAt = Date.now();
      }
      if (checkpoint.otpVisible) return;
      await sleepWithSignal(OTP_CHECK_INTERVAL_MS, signal);
    }
    const err = new Error(`Timed out waiting for OpenRouter's OTP screen after manual verification window; current page ${page.url?.() ?? 'unknown'}`);
    err.code = 'GENERATOR_MANUAL_VERIFICATION_TIMEOUT';
    throw err;
  }

  const checkpoint = await readSignupCheckpoint(page);
  updateTaskCheckpoint(task, checkpoint, { mode: 'browser_signup' });
  const err = new Error(`Timed out waiting for OpenRouter's OTP screen after ${OTP_WAIT_TIMEOUT_MS}ms; current page ${checkpoint.url}`);
  err.code = 'GENERATOR_OTP_SCREEN_TIMEOUT';
  throw err;
}

async function fillVisibleSignupPassword(page, password, taskId) {
  const selectors = [
    'input[name="password"]',
    'input[type="password"]',
    'input[id*="password" i]',
    'input[placeholder*="password" i]',
    'input[autocomplete="new-password"]',
  ];

  for (const selector of selectors) {
    const input = page.locator(selector).first();
    try {
      if (await input.count() === 0) continue;
      if (!await input.isVisible({ timeout: 1000 })) continue;
      await input.fill(password);
      await input.evaluate((el) => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }).catch(() => {});
      logger.info(`[Account Generator] Filled signup password for ${taskId}`);
      return true;
    } catch (err) {
      logger.warn(`[Account Generator] Signup password candidate failed for ${taskId}: ${err.message}`);
    }
  }

  return false;
}

async function acceptVisibleSignupTerms(page, taskId) {
  const selectors = [
    'input[name="legalAccepted"]',
    'input[id*="legal" i]',
    'input[id*="terms" i]',
    'input[name*="terms" i]',
    'input[type="checkbox"]',
  ];

  for (const selector of selectors) {
    const checkbox = page.locator(selector).first();
    try {
      if (await checkbox.count() === 0) continue;
      if (!await checkbox.isVisible({ timeout: 1000 })) continue;
      if (await checkbox.isChecked().catch(() => false)) {
        logger.info(`[Account Generator] Signup terms already accepted for ${taskId}`);
        return true;
      }
      await checkbox.check({ timeout: 3000 });
      logger.info(`[Account Generator] Accepted signup terms for ${taskId}`);
      return true;
    } catch (err) {
      logger.warn(`[Account Generator] Signup terms checkbox candidate failed for ${taskId}: ${err.message}`);
    }
  }

  const labelCandidates = [
    page.getByText(/I agree to the Terms of Service/i).first(),
    page.getByText(/Terms of Service, Privacy Policy/i).first(),
    page.locator('label:has-text("I agree")').first(),
  ];

  for (const candidate of labelCandidates) {
    try {
      if (await candidate.count() === 0) continue;
      if (!await candidate.isVisible({ timeout: 1000 })) continue;
      await candidate.click({ timeout: 3000 });
      logger.info(`[Account Generator] Accepted signup terms via label for ${taskId}`);
      return true;
    } catch (err) {
      logger.warn(`[Account Generator] Signup terms label candidate failed for ${taskId}: ${err.message}`);
    }
  }

  return false;
}

async function clickVisibleOtpSubmitControl(page, taskId) {
  const candidates = [
    page.getByRole('button', { name: /continue|verify|submit|next/i }).first(),
    page.locator('button[type="submit"]').first(),
    page.locator('button.cl-formButtonPrimary').first(),
    page.locator('button[class*="primary" i]').first(),
  ];

  for (const candidate of candidates) {
    try {
      if (await candidate.count() === 0) continue;
      if (!await candidate.isVisible({ timeout: 1000 })) continue;
      if (!await candidate.isEnabled({ timeout: 1000 }).catch(() => true)) continue;
      await candidate.click({ timeout: 3000 });
      logger.info(`[Account Generator] Submitted OTP challenge for ${taskId} with visible button`);
      return true;
    } catch (err) {
      logger.warn(`[Account Generator] OTP submit candidate failed for ${taskId}: ${err.message}`);
    }
  }

  try {
    await page.keyboard.press('Enter');
    logger.info(`[Account Generator] Submitted OTP challenge for ${taskId} with Enter fallback`);
    return true;
  } catch (err) {
    logger.warn(`[Account Generator] OTP Enter fallback failed for ${taskId}: ${err.message}`);
    return false;
  }
}

async function waitForSignupShell(page) {
  return page.waitForFunction(() => {
    const hasInput = document.querySelector('input[type="email"], input[name="identifier"], input[name="emailAddress"], .cl-formFieldInput');
    const hasButton = document.querySelector('button[type="submit"], button.cl-formButtonPrimary');
    const text = document.body?.innerText?.toLowerCase?.() || '';
    const hasSecurityGate = text.includes('verify you are human')
      || text.includes('security check')
      || Boolean(document.querySelector('iframe[src*="turnstile" i], iframe[src*="captcha" i], input[name="cf-turnstile-response"]'));
    return hasInput || hasButton || hasSecurityGate;
  }, undefined, { timeout: STARTUP_TIMEOUT_MS });
}

async function fillVisibleOtpInput(page, otpCode, taskId) {
  const input = page.locator(OTP_INPUT_SELECTOR).first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.click();

  const maxLength = await input.getAttribute('maxlength').catch(() => null);
  if (maxLength === '1') {
    await page.keyboard.type(otpCode, { delay: 75 });
    logger.info(`[Account Generator] Filled segmented OTP challenge for ${taskId}`);
    return;
  }

  await input.fill(otpCode);
  await input.evaluate((el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }).catch(() => {});
  logger.info(`[Account Generator] Filled OTP challenge for ${taskId}`);
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
  const taskId = task?.taskId || 'unknown';

  if (page) {
    await page.close().catch((err) => {
      logger.warn(`[Account Generator] Page cleanup failed for ${taskId}: ${err.message}`);
    });
  }
  if (context) {
    await context.close().catch((err) => {
      logger.warn(`[Account Generator] Context cleanup failed for ${taskId}: ${err.message}`);
    });
  }
  if (browser) {
    await browser.close().catch((err) => {
      logger.warn(`[Account Generator] Browser cleanup failed for ${taskId}: ${err.message}`);
    });
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
  const signal = task.abortController.signal;
  const promise = (async () => {
    try {
      throwIfAborted(signal);
      taskSupervisor.updateTask(task.taskId, { status: 'launching_browser' });
      const launchArgs = [];
      if (process.env.HYDRA_PLAYWRIGHT_NO_SANDBOX === '1') {
        launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
      }
      // playwright-core: API-only package (no auto-downloaded browser bundle).
      // Saves ~200 MB in the production deps tree. The Chromium binary itself
      // is provided by `electron/builders/afterPack.js`, which copies a curated
      // build into the packaged app's resourcesPath; `resolveChromiumLaunchOptions`
      // points `executablePath` there.
      const { chromium } = await import('playwright-core');
      const automationRoute = pickAutomationNetworkRoute();
      if (automationRoute.accountProxy) {
        logger.info(`[Account Generator] Using account proxy ${describeAutomationNetworkRoute(automationRoute)} for task ${task.taskId}`);
        taskSupervisor.updateTask(task.taskId, {
          metadata: { ...task.metadata, automationRoute: automationRoute.label },
        });
      } else {
        taskSupervisor.updateTask(task.taskId, {
          metadata: { ...task.metadata, automationRoute: automationRoute.label },
        });
      }
      const launchOptions = resolveChromiumLaunchOptions({
        headless: config.HYDRA_GENERATOR_HEADLESS,
        args: mergeAutomationLaunchArgs(launchArgs, automationRoute),
      });
      const profileDir = launchOptions.userDataDir;
      taskSupervisor.updateTask(task.taskId, {
        cleanup: async () => cleanupEphemeralProfileDir(profileDir),
        metadata: { ...task.metadata, mode: 'browser_signup' },
      });
      const context = await launchChromiumPersistentContext(chromium, launchOptions, {
        userAgent: USER_AGENT,
        proxy: playwrightProxyForAutomation(automationRoute),
      });
      const browser = context.browser();
      const page = await context.newPage();
      taskSupervisor.attachResources(task.taskId, { browser, context, page });
      throwIfAborted(signal);

      taskSupervisor.updateTask(task.taskId, { status: 'navigating_signup' });
      // Use /sign-up directly (OpenRouter changed from /login?intent=signup)
      await page.goto(`${OR_BASE}/sign-up`, {
        waitUntil: 'domcontentloaded',
        timeout: STARTUP_TIMEOUT_MS,
      });

      // Wait for Next.js/React to hydrate and Clerk to render
      taskSupervisor.updateTask(task.taskId, { status: 'waiting_for_page_hydrate' });
      await page.waitForTimeout(3000);

      // Wait for any form or security element to appear. Playwright's
      // waitForFunction signature is (fn, arg, options), so keep the timeout in
      // the third slot; otherwise it silently falls back to 30 seconds.
      await waitForSignupShell(page);

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

      taskSupervisor.updateTask(task.taskId, { status: 'entering_signup_details' });

      const preDetailCheckpoint = await readSignupCheckpoint(page);
      updateTaskCheckpoint(task, preDetailCheckpoint, { mode: 'browser_signup' });
      const passwordFilled = await fillVisibleSignupPassword(page, task.metadata.password, task.taskId);
      if (!passwordFilled && preDetailCheckpoint.passwordBlocked) {
        const err = new Error('Could not find OpenRouter signup password field - page may have changed');
        err.code = 'GENERATOR_SIGNUP_PASSWORD_FIELD_MISSING';
        throw err;
      }

      const termsAccepted = await acceptVisibleSignupTerms(page, task.taskId);
      const postPasswordCheckpoint = await readSignupCheckpoint(page);
      updateTaskCheckpoint(task, postPasswordCheckpoint, { mode: 'browser_signup' });
      if (!termsAccepted && postPasswordCheckpoint.legalBlocked) {
        const err = new Error('Could not accept OpenRouter signup terms - page may have changed');
        err.code = 'GENERATOR_SIGNUP_TERMS_FIELD_MISSING';
        throw err;
      }

      // Try multiple continue button selectors
      const continueSelectors = [
        'button:has-text("Continue")',
        'button.cl-formButtonPrimary',
        'button:has-text("Sign up")',
        'button:has-text("Next")',
        'button.cl-button',
        'button[class*="primary" i]',
        'button[type="submit"]',
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
      await waitForOtpChallenge(task, page);

      taskSupervisor.updateTask(task.taskId, { status: 'awaiting_otp' });
    } catch (err) {
      if (signal.aborted) {
        logger.info(`[Account Generator] Launch stopped for ${task.taskId}: ${err.message}`);
        return;
      }
      logger.error(`[Account Generator] Launch failed for ${task.taskId}: ${err.message}`);
      // Defensive: close any Playwright resources we managed to attach BEFORE
      // marking the task failed. taskSupervisor.fail also runs the configured
      // cleanup, but if `attachResources` itself threw or the supervisor's
      // cleanup hook is missing, the browser would orphan and balloon to many
      // GB of memory waiting for nothing. Belt + suspenders.
      try {
        await closeGeneratorResources(task);
      } catch (cleanupErr) {
        logger.warn(`[Account Generator] Launch-failure cleanup failed for ${task.taskId}: ${cleanupErr.message}`);
      }
      await taskSupervisor.fail(task.taskId, err);
    }
  })();

  return trackPromise(task, promise);
}

async function finalizeOtpSubmissionPlaywright(task, otpCode) {
  const signal = task.abortController.signal;
  const promise = (async () => {
    try {
      const page = task.resources.page;
      const context = task.resources.context;
      if (!page || !context) {
        throw new Error('Job resources were lost before OTP submission. Start a new generation job.');
      }

      taskSupervisor.updateTask(task.taskId, { status: 'submitting_otp' });
      await fillVisibleOtpInput(page, otpCode, task.taskId);
      await page.waitForTimeout(250);
      await clickVisibleOtpSubmitControl(page, task.taskId);

      taskSupervisor.updateTask(task.taskId, { status: 'waiting_for_completion' });
      await page.waitForURL(/.*(settings|chat|dashboard).*/, { timeout: COMPLETION_TIMEOUT_MS }).catch(async () => {
        const pwdInput = page.locator('input[type="password"]');
        if (await pwdInput.count() > 0 && await pwdInput.first().isVisible()) {
          taskSupervisor.updateTask(task.taskId, { status: 'setting_password' });
          await pwdInput.first().fill(task.metadata.password);
          try {
            await page.click('button[type="submit"], button:has-text("Continue")');
          } catch (clickErr) {
            console.warn(`[Account Generator] Password submit click failed for ${task.taskId}: ${clickErr.message}`);
          }
          await page.waitForURL(/.*(settings|chat|dashboard).*/, { timeout: 15000 });
          return;
        }

        await page.waitForFunction(() => {
          const text = document.body?.innerText?.toLowerCase?.() || '';
          return text.includes('settings')
            || text.includes('billing')
            || text.includes('dashboard')
            || text.includes('management keys');
        }, undefined, { timeout: 15000 });
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
        await sleepWithSignal(1000, signal);

        // Try to refresh using the client cookie AND expired session to get a proper session
        const refreshed = await refreshSession(allDeviceCookies, sessionCookie, { signal });
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
      throwIfAborted(signal);
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
        { signal },
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
  const signal = task.abortController.signal;
  const promise = (async () => {
    try {
      throwIfAborted(signal);
      taskSupervisor.updateTask(task.taskId, { status: 'detecting_account' });

      let authInfo;
      try {
        authInfo = await detectAuthMethod(task.metadata.email, { signal });
      } catch (fapiErr) {
        throwIfAborted(signal);
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
        otpInfo = await startEmailOTP(task.metadata.email, { signal });
      } catch (fapiErr) {
        throwIfAborted(signal);
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
      taskSupervisor.updateTask(task.taskId, {
        metadata: { ...task.metadata, mode: 'https_otp' },
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
  const signal = task.abortController.signal;
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

      const session = await completeEmailOTP(signInId, otpCode, clientCookie, { isSignUp, signal });

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
        await sleepWithSignal(1000, signal); // Clerk propagation delay (OTP sessions need 1-4s)
        const allDeviceCookies = openRouterDashboardDeviceCookies(deviceCookies);
        const refreshed = await refreshSession(allDeviceCookies, sessionCookie, { signal });
        if (refreshed?.sessionCookie &&
            new Date(refreshed.sessionExpiry || 0).getTime() - Date.now() > ONE_HOUR) {
          sessionCookie = refreshed.sessionCookie;
          deviceCookies = refreshed.clientCookie ?? deviceCookies;
          logger.info('[Account Generator] Upgraded to long-lived session via refresh');
        } else {
          logger.warn('[Account Generator] Session still short-lived after refresh attempt');
        }
      }

      taskSupervisor.updateTask(task.taskId, { status: 'saving_profile' });
      throwIfAborted(signal);
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
        { signal },
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

export async function focusSignupBrowser(taskId, ownerUserId) {
  const task = taskSupervisor.assertOwnership(taskId, ownerUserId);
  if (task.type !== 'generator_job') {
    const error = new Error('Task not found');
    error.status = 404;
    throw error;
  }

  const page = task.resources?.page;
  if (!page) {
    const error = new Error('This generator job is not using an isolated browser.');
    error.status = 409;
    error.code = 'GENERATOR_BROWSER_NOT_AVAILABLE';
    throw error;
  }

  await page.bringToFront();
  await page.evaluate(() => window.focus()).catch(() => {});
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
