/**
 * Prepare deterministic resources consumed by electron-builder.
 *
 * Outputs:
 *   - build/electron/data/empty-hydra.db
 *   - build/electron/chromium/<platform-specific Playwright Chromium payload>
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUILD_RESOURCES = resolve(ROOT, 'build/electron');
const DATA_OUT = resolve(BUILD_RESOURCES, 'data');
const CHROMIUM_OUT = resolve(BUILD_RESOURCES, 'chromium');
const EMPTY_DB_SRC = resolve(ROOT, 'data/empty-hydra.db');
const EMPTY_DB_OUT = resolve(DATA_OUT, 'empty-hydra.db');
const BROWSERS_JSON = resolve(ROOT, 'node_modules/playwright-core/browsers.json');

function chromiumRevision() {
  const json = JSON.parse(readFileSync(BROWSERS_JSON, 'utf-8'));
  const chromium = json.browsers?.find((browser) => browser.name === 'chromium');
  if (!chromium?.revision) {
    throw new Error('Could not resolve Playwright Chromium revision from playwright-core/browsers.json');
  }
  return chromium.revision;
}

function browserCacheRoots() {
  const roots = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') {
    roots.push(resolve(process.env.PLAYWRIGHT_BROWSERS_PATH));
  }
  const p = platform();
  if (p === 'darwin') {
    roots.push(resolve(homedir(), 'Library/Caches/ms-playwright'));
  } else if (p === 'linux') {
    roots.push(resolve(homedir(), '.cache/ms-playwright'));
  } else if (p === 'win32') {
    if (process.env.LOCALAPPDATA) roots.push(resolve(process.env.LOCALAPPDATA, 'ms-playwright'));
  }
  return [...new Set(roots.filter(Boolean))];
}

function findChromiumSource(revision) {
  const dirName = `chromium-${revision}`;
  for (const root of browserCacheRoots()) {
    const candidate = resolve(root, dirName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

mkdirSync(DATA_OUT, { recursive: true });
execFileSync(process.execPath, [resolve(ROOT, 'scripts/build-empty-db.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
});
cpSync(EMPTY_DB_SRC, EMPTY_DB_OUT);
console.log(`[prepare-electron-resources] copied ${EMPTY_DB_OUT}`);

const revision = chromiumRevision();
let chromiumSrc = findChromiumSource(revision);
if (!chromiumSrc) {
  console.log(`[prepare-electron-resources] Chromium ${revision} not found; installing with Playwright`);
  execFileSync(process.execPath, [resolve(ROOT, 'node_modules/playwright/cli.js'), 'install', 'chromium'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  chromiumSrc = findChromiumSource(revision);
}
if (!chromiumSrc) {
  throw new Error(`Playwright Chromium ${revision} was not found after install`);
}

rmSync(CHROMIUM_OUT, { recursive: true, force: true });
mkdirSync(CHROMIUM_OUT, { recursive: true });
for (const child of ['chrome-mac', 'chrome-mac-arm64', 'chrome-linux', 'chrome-win']) {
  const source = resolve(chromiumSrc, child);
  if (existsSync(source)) {
    cpSync(source, resolve(CHROMIUM_OUT, child), { recursive: true, dereference: true });
  }
}
console.log(`[prepare-electron-resources] copied ${basename(chromiumSrc)} to ${CHROMIUM_OUT}`);

// ── Chromium validation: verify copied directory contains expected executables ──
const chromiumBinCandidates = [
  resolve(CHROMIUM_OUT, 'chrome'),
  resolve(CHROMIUM_OUT, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  resolve(CHROMIUM_OUT, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  resolve(CHROMIUM_OUT, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
  resolve(CHROMIUM_OUT, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
  resolve(CHROMIUM_OUT, 'chrome-linux', 'chrome'),
  resolve(CHROMIUM_OUT, 'chrome-win', 'chrome.exe'),
  resolve(CHROMIUM_OUT, 'chrome-win', 'chrome'),
];
const foundBin = chromiumBinCandidates.find((p) => existsSync(p));
if (foundBin) {
  console.log(`[prepare-electron-resources] Chromium binary found: ${foundBin}`);
} else {
  throw new Error(
    `[prepare-electron-resources] no Chromium executable found in ${CHROMIUM_OUT}\n` +
    `Checked:\n  ${chromiumBinCandidates.join('\n  ')}`
  );
}
