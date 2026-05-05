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
import { existsSync } from 'node:fs';
import { config } from '../config.js';

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
    // Fallback: try system Chrome
    console.warn(
      '[playwright-browser] No bundled Chromium found in process.resourcesPath, ' +
      'falling back to channel:chrome (requires Google Chrome to be installed)'
    );
    opts.channel = 'chrome';
    if (overrides.args) {
      opts.args = [...overrides.args];
    }
    return finalizeOptions(opts, overrides);
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
 * Merge callers' non-binary overrides (headless already handled).
 * Preserves caller-provided `headless`, merges `args`, forwards everything else.
 *
 * @param {import('playwright').LaunchOptions} opts
 * @param {import('playwright').LaunchOptions} overrides
 * @returns {import('playwright').LaunchOptions}
 */
function finalizeOptions(opts, overrides) {
  // Copy over any extra properties from overrides not already set
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'headless' || key === 'args') continue;
    if (value !== undefined && opts[key] === undefined) {
      opts[key] = value;
    }
  }
  return opts;
}
