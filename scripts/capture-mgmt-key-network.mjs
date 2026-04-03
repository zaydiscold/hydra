#!/usr/bin/env node
/**
 * Standalone Playwright capture for OpenRouter management-key creation traffic.
 * Does not load Hydra server config (no DATABASE_URL). Uses env only.
 *
 * Required:
 *   HYDRA_CAPTURE_OR_SESSION — value of the __session cookie (JWT), not the name=
 * Optional:
 *   HYDRA_CAPTURE_OR_CLIENT — device cookie jar (same shape as vault clientCookie:
 *     single legacy token, or "__client=...; __client_uat=...")
 *   OR_BASE — default https://openrouter.ai
 *   HYDRA_PLAYWRIGHT_HEADED=1 — visible browser
 *   HYDRA_CAPTURE_KEY_NAME — label for the form (default: Hydra-capture-<date>)
 *
 * Logs every POST to OR_BASE to stdout and $TMPDIR/hydra-provision-debug/capture-mgmt-<ts>.log
 * (postData truncated; no response bodies — same policy as HYDRA_PROVISION_NETWORK_LOG).
 *
 * Usage (from repo root, after exporting cookies from a logged-in session):
 *   HYDRA_CAPTURE_OR_SESSION='eyJ...' HYDRA_CAPTURE_OR_CLIENT='__client=...' \
 *     HYDRA_PLAYWRIGHT_HEADED=1 node scripts/capture-mgmt-key-network.mjs
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OR_BASE = process.env.OR_BASE || 'https://openrouter.ai';
const USER_AGENT =
  process.env.HYDRA_CAPTURE_UA ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

function parseOrigin(base) {
  try {
    return new URL(base).origin;
  } catch {
    return 'https://openrouter.ai';
  }
}

function parseHostname(base) {
  try {
    return new URL(base).hostname;
  } catch {
    return 'openrouter.ai';
  }
}

function isClerkDeviceCookieName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name === '__client') return true;
  if (name === '__client_uat') return true;
  if (name.startsWith('__client_uat_')) return true;
  return false;
}

function parseClerkDeviceCookieJar(stored) {
  const t = stored != null ? String(stored).trim() : '';
  if (!t || t === 'undefined') return {};
  if (!t.includes(';')) {
    return { __client: t };
  }
  const jar = {};
  for (const part of t.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (isClerkDeviceCookieName(k) && v) jar[k] = v;
  }
  return Object.keys(jar).length ? jar : { __client: t };
}

/** Mirror server/services/clerk-auth.js openRouterPlaywrightDeviceCookies (domain filled by caller). */
function playwrightDeviceCookiesFromJar(stored) {
  const jar = parseClerkDeviceCookieJar(stored);
  const list = [];
  const uat = jar.__client_uat ?? (Object.keys(jar).length === 1 && jar.__client ? jar.__client : null);
  if (uat) list.push({ name: '__client_uat', value: uat, path: '/' });
  if (jar.__client && jar.__client !== uat) {
    list.push({ name: '__client', value: jar.__client, path: '/' });
  }
  for (const k of Object.keys(jar)) {
    if (k.startsWith('__client_uat_')) {
      list.push({ name: k, value: jar[k], path: '/' });
    }
  }
  return list;
}

function truncateForLog(s, max = 2000) {
  if (!s || typeof s !== 'string') return '';
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

async function clickFirstVisibleCreateControl(page) {
  const roleCandidates = [/^create$/i, /create management key/i, /add key/i, /new key/i, /create key/i, /^new$/i, /^generate$/i];
  for (const name of roleCandidates) {
    const btn = page.getByRole('button', { name });
    if (await btn.first().isVisible({ timeout: 800 }).catch(() => false)) {
      await btn.first().click();
      return true;
    }
  }
  const locators = [
    page.locator('button:has-text("Create")'),
    page.locator('button:has-text("New")'),
    page.locator('button:has-text("Generate")'),
    page.locator('button:has-text("Add")'),
    page.locator('a:has-text("Create")'),
  ];
  for (const loc of locators) {
    if (await loc.first().isVisible({ timeout: 800 }).catch(() => false)) {
      await loc.first().click();
      return true;
    }
  }
  return false;
}

async function fillManagementKeyNameAndSubmit(page, keyName) {
  const nameByRole = page.getByRole('textbox', { name: /^name$/i });
  const nameByPlaceholder = page.locator(
    'input[placeholder*="Management Key" i], input[placeholder*="name" i], input[placeholder*="Name"], input[name="name"], input[aria-label*="name" i]',
  );
  const nameInput = (await nameByRole.isVisible({ timeout: 2000 }).catch(() => false))
    ? nameByRole
    : nameByPlaceholder.first();
  const nameVisible = await nameInput.isVisible({ timeout: 4000 }).catch(() => false);
  if (!nameVisible) {
    throw new Error('Management key form: Name field not visible after opening the create flow.');
  }
  await nameInput.click();
  await nameInput.fill(keyName);

  const saveBtn = page.getByRole('button', { name: /^save$/i });
  if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await saveBtn.click();
    return;
  }
  const submit = page.locator(
    'button[type="submit"], button:has-text("Save"), button:has-text("Confirm"), button:has-text("Generate"), button:has-text("Create")',
  );
  const altVisible = await submit.first().isVisible({ timeout: 2000 }).catch(() => false);
  if (!altVisible) {
    throw new Error('Management key form: Save (or fallback submit) button not visible.');
  }
  await submit.first().click();
}

async function main() {
  const session = process.env.HYDRA_CAPTURE_OR_SESSION?.trim();
  if (!session) {
    console.error('Missing HYDRA_CAPTURE_OR_SESSION (__session JWT value).');
    process.exit(1);
  }

  const OR_ORIGIN = parseOrigin(OR_BASE);
  const OR_HOSTNAME = parseHostname(OR_BASE);
  const clientJar = process.env.HYDRA_CAPTURE_OR_CLIENT?.trim() || '';
  const headed = ['1', 'true', 'yes', 'on'].includes(String(process.env.HYDRA_PLAYWRIGHT_HEADED || '').toLowerCase());
  const keyName =
    process.env.HYDRA_CAPTURE_KEY_NAME?.trim() ||
    `Hydra-capture-${new Date().toISOString().slice(0, 10)}`;

  const networkLines = [];
  const logLine = (line) => {
    networkLines.push(line);
    process.stdout.write(`${line}\n`);
  };

  const dir = join(tmpdir(), 'hydra-provision-debug');
  await mkdir(dir, { recursive: true });
  const logFile = join(dir, `capture-mgmt-${Date.now()}.log`);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: !headed });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const baseCookies = playwrightDeviceCookiesFromJar(clientJar).map((c) => ({
      ...c,
      domain: OR_HOSTNAME,
    }));
    await context.addCookies([{ name: '__session', value: session, domain: OR_HOSTNAME, path: '/' }, ...baseCookies]);

    const page = await context.newPage();
    page.on('response', (response) => {
      try {
        const req = response.request();
        if (req.method() !== 'POST') return;
        const u = response.url();
        if (!u.startsWith(OR_ORIGIN)) return;
        const postData = truncateForLog(req.postData() || '', 2000);
        const block = `${new Date().toISOString()} POST ${response.status()} ${u}\npostData: ${postData || '(empty)'}\n---`;
        logLine(block);
      } catch {
        void 0;
      }
    });

    logLine(`# capture-mgmt-key-network — ${new Date().toISOString()}`);
    logLine(`# OR_BASE=${OR_BASE} keyName=${keyName}`);

    await page.goto(`${OR_BASE.replace(/\/$/, '')}/settings/management-keys`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});

    const clicked = await clickFirstVisibleCreateControl(page);
    if (!clicked) console.error('[capture] No Create control matched; continuing.');
    await page.waitForTimeout(1200);

    await fillManagementKeyNameAndSubmit(page, keyName);
    await page.waitForTimeout(8000);

    const header = `# Hydra capture-mgmt-key-network — ${new Date().toISOString()}\n\n`;
    await appendFile(logFile, header + networkLines.join('\n'), 'utf8');
    console.error(`\n[capture] Wrote ${logFile}`);
    console.error('[capture] Copy relevant POST lines into docs/recon/TRPC_ROUTES.md → Management keys — captured network.');
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
