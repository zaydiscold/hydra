/**
 * Prepare deterministic resources consumed by electron-builder.
 *
 * Outputs:
 *   - build/electron/data/empty-hydra.db
 *   - build/electron/chromium.zip containing the platform-specific Playwright
 *     Chromium payload. Runtime extracts it under HYDRA_DATA_DIR/chromium.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { arch as osArch, homedir, platform } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUILD_RESOURCES = resolve(ROOT, 'build/electron');
const DATA_OUT = resolve(BUILD_RESOURCES, 'data');
const CHROMIUM_OUT = resolve(BUILD_RESOURCES, 'chromium');
const CHROMIUM_ZIP_OUT = resolve(BUILD_RESOURCES, 'chromium.zip');
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

function walkTree(root, visitor) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stat = lstatSync(current);
    visitor(current, stat);
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    for (const entry of readdirSync(current)) {
      stack.push(resolve(current, entry));
    }
  }
}

function rewriteChromiumSymlinks(outRoot, sourceRoot) {
  let rewritten = 0;
  const badLinks = [];
  walkTree(outRoot, (entry, stat) => {
    if (!stat.isSymbolicLink()) return;
    const target = readlinkSync(entry);
    if (!isAbsolute(target)) return;

    if (!target.startsWith(sourceRoot)) {
      badLinks.push(`${entry} -> ${target}`);
      return;
    }

    const selfContainedTarget = resolve(outRoot, relative(sourceRoot, target));
    const relTarget = relative(dirname(entry), selfContainedTarget) || '.';
    rmSync(entry, { force: true });
    symlinkSync(relTarget, entry);
    rewritten += 1;
  });

  if (badLinks.length > 0) {
    throw new Error(
      `[prepare-electron-resources] Chromium copy contains absolute symlinks outside its source cache:\n` +
      badLinks.map((line) => `  ${line}`).join('\n')
    );
  }
  if (rewritten > 0) {
    console.log(`[prepare-electron-resources] rewrote ${rewritten} absolute Chromium symlinks to bundle-relative targets`);
  }
}

console.log(`[prepare-electron-resources] start platform=${platform()} arch=${osArch()} target=${process.env.HYDRA_BUILD_TARGET || '(host)'}`);
console.log(`[prepare-electron-resources] ROOT=${ROOT}`);
console.log(`[prepare-electron-resources] BUILD_RESOURCES=${BUILD_RESOURCES}`);

mkdirSync(DATA_OUT, { recursive: true });
console.log(`[prepare-electron-resources] -> build-empty-db.mjs`);
execFileSync(process.execPath, [resolve(ROOT, 'scripts/build-empty-db.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
});
console.log(`[prepare-electron-resources] build-empty-db.mjs OK`);
cpSync(EMPTY_DB_SRC, EMPTY_DB_OUT);
console.log(`[prepare-electron-resources] copied ${EMPTY_DB_OUT}`);

const revision = chromiumRevision();
let chromiumSrc = findChromiumSource(revision);
if (!chromiumSrc) {
  // `playwright` is in optionalDependencies; if it failed to install (or was
  // skipped), fall back to playwright-core's CLI which is always present.
  const playwrightCli = resolve(ROOT, 'node_modules/playwright/cli.js');
  const playwrightCoreCli = resolve(ROOT, 'node_modules/playwright-core/cli.js');
  const cli = existsSync(playwrightCli) ? playwrightCli : playwrightCoreCli;
  console.log(`[prepare-electron-resources] Chromium ${revision} not found in cache: ${browserCacheRoots().join(', ')}`);
  console.log(`[prepare-electron-resources] installing via ${cli}`);
  execFileSync(process.execPath, [cli, 'install', 'chromium'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  chromiumSrc = findChromiumSource(revision);
}
if (!chromiumSrc) {
  throw new Error(
    `Playwright Chromium ${revision} was not found after install. ` +
    `Cache roots checked: ${browserCacheRoots().join(', ') || '(none)'}`
  );
}
console.log(`[prepare-electron-resources] Chromium source: ${chromiumSrc}`);

rmSync(CHROMIUM_OUT, { recursive: true, force: true });
rmSync(CHROMIUM_ZIP_OUT, { force: true });
mkdirSync(CHROMIUM_OUT, { recursive: true });

// Pick ONLY the Chromium subdir matching the build target's platform+arch.
// Dev machines often have multiple platform caches from cross-testing — copying
// all of them balloons the package by hundreds of MB.
//
// Override with HYDRA_BUILD_TARGET (e.g. "darwin-arm64", "linux-x64", "win32-x64")
// when cross-building; defaults to the host platform/arch.
function resolveChromiumChildren() {
  const target = process.env.HYDRA_BUILD_TARGET || `${platform()}-${osArch()}`;
  switch (target) {
    case 'darwin-arm64':
      return ['chrome-mac-arm64'];
    case 'darwin-x64':
      return ['chrome-mac-x64', 'chrome-mac'];
    case 'linux-x64':
    case 'linux-arm64':
      return ['chrome-linux', 'chrome-linux64'];
    case 'win32-x64':
    case 'win32-ia32':
    case 'win32-arm64':
      return ['chrome-win', 'chrome-win64'];
    default:
      throw new Error(`[prepare-electron-resources] unsupported build target: ${target}`);
  }
}
function chromiumCacheGuidance(target, wantedChildren) {
  const host = `${platform()}-${osArch()}`;
  const checked = wantedChildren.join(', ');
  const targetHint = target === host
    ? `Install Playwright Chromium for this machine with \`npx playwright install chromium\`, then rerun the build.`
    : `This host is ${host}, but HYDRA_BUILD_TARGET=${target} needs ${checked}. Build on the target runner/machine or provide a PLAYWRIGHT_BROWSERS_PATH cache that already contains that target payload.`;
  const runnerHint = [
    'Known release runners:',
    '  darwin-arm64 -> Apple Silicon macOS runner or local Apple Silicon Mac',
    '  darwin-x64   -> Intel Mac or macos-15-intel GitHub runner',
    '  win32-x64    -> Windows x64 GitHub runner or Windows machine',
    '  linux-x64    -> Linux x64 GitHub runner or Linux machine',
  ].join('\n');
  return `${targetHint}\n${runnerHint}`;
}
const wantedChildren = resolveChromiumChildren();
const buildTarget = process.env.HYDRA_BUILD_TARGET || `${platform()}-${osArch()}`;
console.log(`[prepare-electron-resources] wantedChildren=${wantedChildren.join(',')} for buildTarget=${buildTarget}`);
console.log(`[prepare-electron-resources] chromiumSrc contains: ${readdirSync(chromiumSrc).join(', ')}`);
const wantedChild = wantedChildren.find((child) => existsSync(resolve(chromiumSrc, child))) ?? wantedChildren[0];
const wantedSrc = resolve(chromiumSrc, wantedChild);
if (!existsSync(wantedSrc)) {
  throw new Error(
    `[prepare-electron-resources] expected Chromium subdir not found under ${chromiumSrc}.\n` +
    `Checked: ${wantedChildren.join(', ')}\n` +
    chromiumCacheGuidance(buildTarget, wantedChildren)
  );
}
const wantedOut = resolve(CHROMIUM_OUT, wantedChild);
console.log(`[prepare-electron-resources] copying ${wantedSrc} -> ${wantedOut}`);
cpSync(wantedSrc, wantedOut, { recursive: true });
rewriteChromiumSymlinks(wantedOut, wantedSrc);
console.log(`[prepare-electron-resources] copied ${basename(chromiumSrc)}/${wantedChild} to ${CHROMIUM_OUT}`);

// ── Chromium validation: verify copied directory contains expected executables ──
const chromiumBinCandidates = [
  resolve(CHROMIUM_OUT, 'chrome'),
  resolve(CHROMIUM_OUT, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  resolve(CHROMIUM_OUT, 'chrome-mac-x64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  resolve(CHROMIUM_OUT, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  resolve(CHROMIUM_OUT, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
  resolve(CHROMIUM_OUT, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
  resolve(CHROMIUM_OUT, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
  resolve(CHROMIUM_OUT, 'chrome-linux', 'chrome'),
  resolve(CHROMIUM_OUT, 'chrome-linux64', 'chrome'),
  resolve(CHROMIUM_OUT, 'chrome-win', 'chrome.exe'),
  resolve(CHROMIUM_OUT, 'chrome-win64', 'chrome.exe'),
  resolve(CHROMIUM_OUT, 'chrome-win', 'chrome'),
  resolve(CHROMIUM_OUT, 'chrome-win64', 'chrome'),
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

function archiveChromiumPayload(child) {
  console.log(`[prepare-electron-resources] archiving ${child} -> ${CHROMIUM_ZIP_OUT}`);
  if (platform() === 'win32') {
    // Compress-Archive can fail on Chromium's nested win32 paths (long-path
    // limit, slow on many small files). Prefer 7z which ships with the GitHub
    // windows-2022/windows-latest runners and produces a standard .zip; fall
    // back to Compress-Archive only if 7z isn't on PATH.
    try {
      execFileSync('7z', ['a', '-tzip', '-mx=1', '-bsp0', '-bso0', CHROMIUM_ZIP_OUT, child], {
        cwd: CHROMIUM_OUT,
        stdio: 'inherit',
      });
      return;
    } catch (sevenZipErr) {
      console.warn(`[prepare-electron-resources] 7z failed (${sevenZipErr.message}); falling back to PowerShell Compress-Archive`);
    }
    // Pass paths via env vars rather than $args; see listZipEntries comment.
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      [
        '$ErrorActionPreference = "Stop";',
        'Compress-Archive -Path $env:HYDRA_ZIP_SOURCE -DestinationPath $env:HYDRA_ZIP_OUT -Force',
      ].join(' '),
    ], {
      cwd: CHROMIUM_OUT,
      stdio: 'inherit',
      env: { ...process.env, HYDRA_ZIP_SOURCE: child, HYDRA_ZIP_OUT: CHROMIUM_ZIP_OUT },
    });
    return;
  }

  execFileSync('zip', ['-qry', CHROMIUM_ZIP_OUT, child], {
    cwd: CHROMIUM_OUT,
    stdio: 'inherit',
  });
}

archiveChromiumPayload(wantedChild);
rmSync(CHROMIUM_OUT, { recursive: true, force: true });
console.log(`[prepare-electron-resources] archived Chromium to ${CHROMIUM_ZIP_OUT}`);
