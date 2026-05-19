/**
 * Playwright Browser Resolution
 *
 * Shared helper to resolve Chromium launch options for server-side Playwright.
 * Handles packaged Electron apps, system Chrome, explicit binary paths,
 * and standard dev-mode Playwright cache directory.
 *
 * Priority order for launch resolution:
 *   1. HYDRA_PLAYWRIGHT_EXECUTABLE_PATH → explicit binary path
 *   2. HYDRA_PLAYWRIGHT_CHANNEL → system browser channel (e.g. 'chrome')
 *   3. Packaged Electron → bundled Chromium at process.resourcesPath
 *   4. Default → standard Playwright-managed binary (dev mode)
 *
 * HYDRA_PLAYWRIGHT_CDP_ENDPOINT is intentionally handled at call sites because
 * it uses chromium.connectOverCDP() instead of chromium.launch().
 *
 * @module playwright-browser
 */

import { execFileSync } from 'node:child_process';
import { basename, join, relative } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { config } from '../config.js';

/**
 * Common prefix for every ephemeral profile dir we create. Used by both the
 * creation path (`mkdtempSync(prefix)`) and the cleanup sweep (so the sweep
 * cannot delete anything we didn't create — defense against accidental
 * recursive rm of an unrelated `/var/folders/.../T/...` entry).
 */
const PROFILE_DIR_PREFIX = 'hydra-pw-profile-';

/**
 * Browser ISOLATION FLAGS — the standard "this browser is for automation,
 * keep your hands off my real installation" set.
 *
 *   --no-default-browser-check   don't prompt to set as default
 *   --no-first-run               skip the first-run welcome flow
 *   --disable-default-apps       no Chrome Web Store / Play apps
 *   --disable-background-networking  no background sync, update, telemetry
 *   --disable-sync               no Google account sync
 *   --disable-features=...       turn off translate UI + occlusion (also good for us)
 *   --metrics-recording-only     no metrics uploaded
 *   --use-mock-keychain          don't touch the user's macOS Keychain
 *
 * Combined with a fresh ephemeral userDataDir (below), this gives a browser
 * instance that is completely walled off from the user's daily Chrome.
 */
const ISOLATION_ARGS = Object.freeze([
  '--no-default-browser-check',
  '--no-first-run',
  '--disable-default-apps',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-features=Translate,CalculateNativeWinOcclusion,MediaRouter',
  '--metrics-recording-only',
  '--use-mock-keychain',
]);

/**
 * Generate a fresh ephemeral profile dir for this launch.
 * Lives under the OS temp dir, prefixed `hydra-pw-` so the orphan-sweep
 * (electron/utils/cleanupAuxProcesses.js) and ad-hoc `find` greps can spot
 * leftover dirs from crashed runs.
 *
 * @returns {string} absolute path to a fresh empty directory
 */
export function makeEphemeralProfileDir() {
  return mkdtempSync(join(tmpdir(), PROFILE_DIR_PREFIX));
}

/**
 * Delete a single ephemeral profile dir. Safe-by-construction:
 *   - Only acts on absolute paths whose basename starts with our prefix.
 *   - Only acts on paths under the OS tmpdir.
 *   - Uses `rmSync(force:true, recursive:true)`. Never throws — failure
 *     just leaves the dir behind (sweep will catch it next boot).
 *
 * Callers should invoke this after `await browser.close()` succeeds, in a
 * `finally` block. Pairing creation + deletion at the call site is much
 * more robust than relying on a separate sweep.
 *
 * @param {string} dirPath - absolute path returned by makeEphemeralProfileDir()
 */
export function cleanupEphemeralProfileDir(dirPath) {
  if (typeof dirPath !== 'string' || !dirPath) return;
  const tmpRoot = tmpdir();
  // Refuse anything not under the OS tmpdir or not prefixed.
  const rel = relative(tmpRoot, dirPath);
  if (!rel || rel.startsWith('..') || rel.includes('..') || rel === dirPath) return;
  if (!basename(dirPath).startsWith(PROFILE_DIR_PREFIX)) return;
  try {
    rmSync(dirPath, { recursive: true, force: true, maxRetries: 2 });
  } catch (e) {
    // Best-effort. Common failure: EBUSY because Chromium is still flushing
    // its sqlite databases. Sweep will retry on next boot.
    console.warn(`[playwright-browser] failed to remove ephemeral profile ${dirPath}: ${e.message}`);
  }
}

/**
 * Boot-time sweep: remove every `hydra-pw-profile-*` dir in the OS tmpdir
 * that is older than `minAgeMs` (default 60s). The age floor protects
 * against racing a sibling Hydra process that just created a fresh dir.
 *
 * Why this matters: each crashed/killed Hydra run leaves behind one of
 * these dirs. They're empty (size 64 bytes, just the dir entry) so the
 * disk impact is trivial, but the inode pressure adds up over weeks of
 * dev cycles, and they make `ls /var/folders/.../T/` unreadable.
 *
 * Called from electron/main.js at startup alongside the orphan-process
 * sweep so all the leak hygiene happens together.
 *
 * @param {number} [minAgeMs=60000] - only remove dirs older than this
 * @returns {{ removed: number, kept: number, failed: number }}
 */
export function sweepStaleEphemeralProfiles(minAgeMs = 60_000) {
  const stats = { removed: 0, kept: 0, failed: 0 };
  const tmpRoot = tmpdir();
  let entries;
  try {
    entries = readdirSync(tmpRoot);
  } catch (e) {
    console.warn(`[playwright-browser] sweep: cannot read tmpdir ${tmpRoot}: ${e.message}`);
    return stats;
  }
  const now = Date.now();
  for (const name of entries) {
    if (!name.startsWith(PROFILE_DIR_PREFIX)) continue;
    const full = join(tmpRoot, name);
    let age;
    try {
      age = now - statSync(full).mtimeMs;
    } catch (e) {
      stats.failed += 1;
      console.warn(`[playwright-browser] sweep: cannot stat stale profile ${full}: ${e.message}`);
      continue;
    }
    if (age < minAgeMs) {
      stats.kept += 1;
      continue;
    }
    try {
      rmSync(full, { recursive: true, force: true, maxRetries: 1 });
      stats.removed += 1;
    } catch (e) {
      stats.failed += 1;
      console.warn(`[playwright-browser] sweep: failed to remove stale profile ${full}: ${e.message}`);
    }
  }
  if (stats.removed || stats.failed) {
    console.log(`[playwright-browser] swept stale ephemeral profiles — removed=${stats.removed} kept=${stats.kept} failed=${stats.failed}`);
  }
  return stats;
}

/**
 * Resolve Playwright Chromium launch options with proper browser binary resolution.
 *
 * Returns an options object suitable for `chromium.launch()`. Does NOT handle
 * `connectOverCDP` — callers should check `config.HYDRA_PLAYWRIGHT_CDP_ENDPOINT`
 * separately and use `chromium.connectOverCDP()` when set.
 *
 * @param {import('playwright').LaunchOptions} [overrides={}] - Additional launch options
 *   (e.g. `headless`, `args`) that override defaults but do not override resolved
 *   `executablePath` or `channel` unless explicitly passed.
 * @returns {import('playwright').LaunchOptions}
 *
 * @example
 *   import { resolveChromiumLaunchOptions } from '../lib/playwright-browser.js';
 *   const browser = await chromium.launch(resolveChromiumLaunchOptions({ headless: true }));
 */
export function resolveChromiumLaunchOptions(overrides = {}) {
  const headless = overrides.headless !== undefined
    ? overrides.headless
    : !config.HYDRA_PLAYWRIGHT_HEADED;

  /** @type {import('playwright').LaunchOptions} */
  const opts = { headless };

  // ── Priority 1: Explicit executable path ──
  if (config.HYDRA_PLAYWRIGHT_EXECUTABLE_PATH) {
    opts.executablePath = config.HYDRA_PLAYWRIGHT_EXECUTABLE_PATH;
    // Merge caller args on top
    if (overrides.args) {
      opts.args = [...overrides.args];
    }
    return finalizeOptions(opts, overrides);
  }

  // ── Priority 2: Browser channel (e.g. 'chrome' for system Chrome) ──
  if (config.HYDRA_PLAYWRIGHT_CHANNEL) {
    opts.channel = config.HYDRA_PLAYWRIGHT_CHANNEL;
    if (overrides.args) {
      opts.args = [...overrides.args];
    }
    return finalizeOptions(opts, overrides);
  }

  // ── Priority 3: Packaged Electron app — bundled Chromium ──
  if (process.env.HYDRA_EMBEDDED === '1' && typeof process.resourcesPath === 'string') {
    const resolved = resolveBundledChromium();
    if (resolved) {
      opts.executablePath = resolved;
      if (overrides.args) {
        opts.args = [...overrides.args];
      }
      return finalizeOptions(opts, overrides);
    }
    if (process.env.HYDRA_PLAYWRIGHT_ALLOW_SYSTEM_CHROME_FALLBACK === '1') {
      console.warn(
        '[playwright-browser] No bundled Chromium found in process.resourcesPath, ' +
        'using explicit system Chrome fallback because HYDRA_PLAYWRIGHT_ALLOW_SYSTEM_CHROME_FALLBACK=1'
      );
      opts.channel = 'chrome';
      if (overrides.args) {
        opts.args = [...overrides.args];
      }
      return finalizeOptions(opts, overrides);
    }
    throw new Error(
      'Bundled Chromium was not found in the packaged Hydra resources. ' +
      'Rebuild with `npm run electron:prepare && npm run electron:build`, set HYDRA_PLAYWRIGHT_EXECUTABLE_PATH, ' +
      'or explicitly opt into system Chrome with HYDRA_PLAYWRIGHT_ALLOW_SYSTEM_CHROME_FALLBACK=1.'
    );
  }

  // ── Priority 4: Default — Playwright's own browser cache ──
  if (overrides.args) {
    opts.args = [...overrides.args];
  }
  return finalizeOptions(opts, overrides);
}

/**
 * Scan common bundled Chromium paths under process.resourcesPath.
 *
 * @returns {string|null} First existing binary path, or null.
 */
function resolveBundledChromium() {
  const resourcePath = process.resourcesPath;
  const extractedRoot = ensureBundledChromiumExtracted(resourcePath);
  const searchRoots = [resourcePath];
  if (extractedRoot) searchRoots.unshift(extractedRoot);

  for (const root of searchRoots) {
    const resolved = findChromiumExecutable(root);
    if (resolved) return resolved;
  }
  return null;
}

function ensureBundledChromiumExtracted(resourcePath) {
  const archivePath = join(resourcePath, 'chromium.zip');
  if (!existsSync(archivePath)) return null;

  const dataDir = process.env.HYDRA_DATA_DIR;
  if (!dataDir) return null;

  const extractRoot = join(dataDir, 'chromium');
  const existing = findChromiumExecutable(extractRoot);
  if (existing) return extractRoot;

  rmSync(extractRoot, { recursive: true, force: true });
  mkdirSync(extractRoot, { recursive: true, mode: 0o700 });

  try {
    if (process.platform === 'darwin') {
      execFileSync('ditto', ['-x', '-k', archivePath, extractRoot], { stdio: 'ignore' });
    } else if (process.platform === 'win32') {
      execFileSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(extractRoot)} -Force`,
      ], { stdio: 'ignore', windowsHide: true });
    } else {
      execFileSync('unzip', ['-q', archivePath, '-d', extractRoot], { stdio: 'ignore' });
    }
  } catch (err) {
    rmSync(extractRoot, { recursive: true, force: true });
    throw new Error(`Failed to extract bundled Chromium archive: ${err.message}`);
  }

  return extractRoot;
}

function findChromiumExecutable(root) {
  const candidates = [
    // macOS: bundled inside Chromium.app
    join(root, 'chromium', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    join(root, 'chromium', 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    join(root, 'chromium', 'chrome-mac-x64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    join(root, 'chromium', 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    join(root, 'chromium', 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    join(root, 'chromium', 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    join(root, 'chromium', 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    join(root, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    join(root, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    join(root, 'chrome-mac-x64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    join(root, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    join(root, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    join(root, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    join(root, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    // Linux / Windows: plain executable
    join(root, 'chromium', 'chrome'),
    join(root, 'chromium', 'chromium'),
    join(root, 'chromium', 'chromium-browser'),
    // Playwright-downloaded under resourcesPath
    join(root, 'chromium', 'chrome-linux', 'chrome'),
    join(root, 'chromium', 'chrome-linux64', 'chrome'),
    join(root, 'chromium', 'chrome-win', 'chrome.exe'),
    join(root, 'chromium', 'chrome-win64', 'chrome.exe'),
    join(root, 'chrome-linux', 'chrome'),
    join(root, 'chrome-linux64', 'chrome'),
    join(root, 'chrome-win', 'chrome.exe'),
    join(root, 'chrome-win64', 'chrome.exe'),
    // Generic fallbacks
    join(root, 'browsers', 'chromium', 'chrome'),
    join(root, 'browsers', 'chrome', 'chrome'),
  ];

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // existsSync can throw on some platform edge cases; ignore
    }
  }
  return null;
}

/**
 * Merge callers' overrides + apply isolation defaults.
 *
 * The result ALWAYS has:
 *   - ISOLATION_ARGS prepended to args (so launches can't accidentally
 *     pollute or read the user's real Chrome profile)
 *   - userDataDir set to a fresh ephemeral path (unless caller passed one)
 *
 * Callers can opt out of ephemeral profile dir by passing `userDataDir: null`
 * — currently no caller does this, but it's there as an escape hatch.
 *
 * @param {import('playwright').LaunchOptions} opts
 * @param {import('playwright').LaunchOptions} overrides
 * @returns {import('playwright').LaunchOptions}
 */
function finalizeOptions(opts, overrides) {
  // Copy over any extra properties from overrides not already set.
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'headless' || key === 'args') continue;
    if (value !== undefined && opts[key] === undefined) {
      opts[key] = value;
    }
  }

  // Always prepend isolation args. Caller's args win on collision (caller
  // passed them for a reason), but the isolation defaults still apply.
  const callerArgs = Array.isArray(opts.args) ? opts.args : [];
  opts.args = [...ISOLATION_ARGS, ...callerArgs];

  // Ephemeral profile dir. If caller explicitly passed `userDataDir: null`
  // they've opted out (e.g. for a test that needs to inspect profile state).
  // Otherwise: always fresh, no leak across runs, no contact with real Chrome.
  if (!('userDataDir' in overrides)) {
    opts.userDataDir = makeEphemeralProfileDir();
  } else if (overrides.userDataDir !== null) {
    opts.userDataDir = overrides.userDataDir;
  }

  return opts;
}
