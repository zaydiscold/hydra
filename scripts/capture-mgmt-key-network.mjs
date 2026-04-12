#!/usr/bin/env node
/**
 * Standalone browser (Playwright-driven) capture for OpenRouter management-key creation traffic.
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

/** Keep in sync with server/services/dashboard-api.js — cookie/consent overlays block headless clicks. */
async function dismissOpenRouterBlockingOverlays(page) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(180);
  }
  const dismissButtons = [
    page.getByRole('button', { name: /accept all cookies/i }),
    page.getByRole('button', { name: /accept all/i }),
    page.getByRole('button', { name: /^accept$/i }),
    page.getByRole('button', { name: /i agree/i }),
    page.getByRole('button', { name: /^got it$/i }),
    page.getByRole('button', { name: /^ok$/i }),
    page.getByRole('button', { name: /^close$/i }),
    page.getByRole('button', { name: /no thanks/i }),
    page.locator('#headlessui-portal-root button').filter({ hasText: /accept|agree|got it|close|ok/i }).first(),
  ];
  for (const loc of dismissButtons) {
    try {
      if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
        await loc.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(350);
      }
    } catch {
      void 0;
    }
  }
}

/** Mirror dashboard-api.js — prefer Create in main so portals do not steal the click. */
async function clickFirstVisibleCreateControl(page) {
  const main = page.locator('main, [role="main"]').first();
  if (await main.isVisible({ timeout: 800 }).catch(() => false)) {
    const mainCreate = main.getByRole('button', { name: /^create$/i });
    if (await mainCreate.first().isVisible({ timeout: 800 }).catch(() => false)) {
      await mainCreate.first().click();
      return true;
    }
  }
  const roleCandidates = [
    /^create$/i,
    /create management key/i,
    /add key/i,
    /new key/i,
    /create key/i,
    /^new$/i,
    /^generate$/i,
  ];
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

function managementDialog(page) {
  return page
    .locator(
      [
        '#headlessui-portal-root [role="dialog"]',
        '[role="dialog"]',
        '[aria-modal="true"]',
        '[data-state="open"]',
        'dialog[open]',
        'div[class*="modal"]',
        'div[class*="dialog"]',
        'div[class*="overlay"]',
      ].join(', '),
    )
    .first();
}

/** Mirror dashboard-api.js fillManagementKeyNameAndSubmit (no provisionStepLog). */
async function fillManagementKeyNameAndSubmit(page, keyName) {
  const dialog = managementDialog(page);
  const inDialog = await dialog.isVisible({ timeout: 2500 }).catch(() => false);
  const scope = inDialog ? dialog : page;

  const nameByRole = scope.getByRole('textbox', { name: /^name$/i });
  const nameByRoleAlt = scope.getByRole('textbox', { name: /name/i });
  const nameByPlaceholder = scope.locator(
    'input[placeholder*="Management Key" i], input[placeholder*="name" i], input[placeholder*="Name"], input[name="name"], input[aria-label*="name" i]',
  );
  const nameByFallback = scope
    .locator('input[type="text"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')
    .first();

  let nameInput;
  if (await nameByRole.isVisible({ timeout: 1500 }).catch(() => false)) {
    nameInput = nameByRole;
  } else if (await nameByRoleAlt.isVisible({ timeout: 1500 }).catch(() => false)) {
    nameInput = nameByRoleAlt;
  } else if (await nameByPlaceholder.first().isVisible({ timeout: 1500 }).catch(() => false)) {
    nameInput = nameByPlaceholder.first();
  } else {
    nameInput = nameByFallback;
  }
  const nameVisible = await nameInput.isVisible({ timeout: 4000 }).catch(() => false);
  if (!nameVisible) {
    throw new Error('Management key form: Name field not visible after opening the create flow.');
  }
  await nameInput.click();
  await nameInput.clear();
  await nameInput.fill('');
  await page.waitForTimeout(100);
  await nameInput.pressSequentially(keyName, { delay: 40 });
  await page.waitForTimeout(300);

  const saveBtn = scope.getByRole('button', { name: /^save$/i });
  if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    try {
      await saveBtn.click();
    } catch {
      await saveBtn.click({ force: true });
    }
    return;
  }
  const submit = scope.locator(
    'button[type="submit"], button:has-text("Save"), button:has-text("Confirm"), button:has-text("Generate"), button:has-text("Create")',
  );
  const altVisible = await submit.first().isVisible({ timeout: 2000 }).catch(() => false);
  if (!altVisible) {
    throw new Error('Management key form: Save (or fallback submit) button not visible.');
  }
  try {
    await submit.first().click();
  } catch {
    await submit.first().click({ force: true });
  }
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
  const serverActions = []; // Capture Server Action details
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
        if (/analytics|sentry|segment|datadog|fullstory|hotjar|clarity|googletagmanager|doubleclick/i.test(u)) {
          return;
        }
        const h = req.headers();
        const nextAction = h['next-action'] || h['Next-Action'] || '';
        const contentType = h['content-type'] || h['Content-Type'] || '';
        const postData = truncateForLog(req.postData() || '', 2000);

        // Capture Server Action details for replay documentation
        if (nextAction && u.includes('/settings/management-keys')) {
          serverActions.push({
            timestamp: new Date().toISOString(),
            url: u,
            nextAction: String(nextAction),
            contentType,
            postData: req.postData() || '',
            status: response.status(),
          });
        }

        const extra =
          nextAction || contentType
            ? `\nheaders: content-type=${contentType || '(none)'} next-action=${nextAction ? `${String(nextAction).slice(0, 80)}…` : '(none)'}`
            : '';
        const block = `${new Date().toISOString()} POST ${response.status()} ${u}\npostData: ${postData || '(empty)'}${extra}\n---`;
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

    await dismissOpenRouterBlockingOverlays(page);

    const clicked = await clickFirstVisibleCreateControl(page);
    if (!clicked) console.error('[capture] No Create control matched; continuing.');
    await page.waitForTimeout(1200);

    await fillManagementKeyNameAndSubmit(page, keyName);
    await page.waitForTimeout(8000);

    // Build Server Action documentation section if we captured any
    let serverActionDoc = '';
    if (serverActions.length > 0) {
      serverActionDoc = '\n\n## Captured Server Actions (for HYDRA_MGMT_KEY_SERVER_ACTION_ID)\n\n';
      for (const sa of serverActions) {
        serverActionDoc += `### ${sa.timestamp}\n`;
        serverActionDoc += `- **URL**: ${sa.url}\n`;
        serverActionDoc += `- **Next-Action**: ${sa.nextAction}\n`;
        serverActionDoc += `- **Content-Type**: ${sa.contentType}\n`;
        serverActionDoc += `- **Status**: ${sa.status}\n`;
        serverActionDoc += `- **Body**: ${sa.postData.slice(0, 200)}${sa.postData.length > 200 ? '...' : ''}\n\n`;
      }
      serverActionDoc += '## Environment Variable Setup\n\n';
      serverActionDoc += 'To enable Server Action replay in Hydra, set:\n\n';
      serverActionDoc += '```bash\n';
      serverActionDoc += '# Use the captured Next-Action ID\n';
      serverActionDoc += `export HYDRA_MGMT_KEY_SERVER_ACTION_ID='${serverActions[0].nextAction}'\n`;
      serverActionDoc += 'export HYDRA_PROVISION_SERVER_ACTION_REPLAY=1\n';
      serverActionDoc += '```\n\n';
    }

    const header = `# Hydra capture-mgmt-key-network — ${new Date().toISOString()}\n\n`;
    await appendFile(logFile, header + networkLines.join('\n') + serverActionDoc, 'utf8');
    console.error(`\n[capture] Wrote ${logFile}`);
    console.error('[capture] Copy relevant POST lines into docs/recon/TRPC_ROUTES.md → Management keys — captured network.');

    if (serverActions.length > 0) {
      console.error('\n[capture] Server Actions captured! To enable replay:');
      console.error(`   export HYDRA_MGMT_KEY_SERVER_ACTION_ID='${serverActions[0].nextAction}'`);
      console.error('   export HYDRA_PROVISION_SERVER_ACTION_REPLAY=1');
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
