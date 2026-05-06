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

import { join } from 'node:path';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { config } from '../config.js';

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
  return mkdtempSync(join(tmpdir(), 'hydra-pw-profile-'));
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
  const candidates = [
    // macOS: bundled inside Chromium.app
    join(resourcePath, 'chromium', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    join(resourcePath, 'chromium', 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    join(resourcePath, 'chromium', 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    join(resourcePath, 'chromium', 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    join(resourcePath, 'chromium', 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
    // Linux / Windows: plain executable
    join(resourcePath, 'chromium', 'chrome'),
    join(resourcePath, 'chromium', 'chromium'),
    join(resourcePath, 'chromium', 'chromium-browser'),
    // Playwright-downloaded under resourcesPath
    join(resourcePath, 'chromium', 'chrome-linux', 'chrome'),
    join(resourcePath, 'chromium', 'chrome-win', 'chrome.exe'),
    // Generic fallbacks
    join(resourcePath, 'browsers', 'chromium', 'chrome'),
    join(resourcePath, 'browsers', 'chrome', 'chrome'),
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
