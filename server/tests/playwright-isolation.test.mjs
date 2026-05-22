// @platform all
/**
 * Browser-isolation contract tests for `server/lib/playwright-browser.js`.
 *
 * These guard the three knobs documented in docs/BROWSER_ISOLATION.md:
 *   1. Binary    — never your real `/Applications/Google Chrome.app`
 *   2. Profile   — fresh ephemeral userDataDir per launch
 *   3. Flags     — isolation args present + sane
 *
 * If any of these fail, Hydra has the ability to take over the user's
 * daily Chrome with all their tabs / cookies / sessions. Don't ship.
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  cleanupEphemeralProfileDir,
  resolveChromiumLaunchOptions,
  makeEphemeralProfileDir,
} from '../lib/playwright-browser.js';

// Snapshot env to restore between tests — these tests mutate process.env.
const envSnapshot = {};
const envKeys = [
  'HYDRA_PLAYWRIGHT_EXECUTABLE_PATH',
  'HYDRA_PLAYWRIGHT_CHANNEL',
  'HYDRA_PLAYWRIGHT_HEADED',
  'HYDRA_PLAYWRIGHT_ALLOW_SYSTEM_CHROME_FALLBACK',
  'HYDRA_EMBEDDED',
];

before(() => {
  for (const k of envKeys) envSnapshot[k] = process.env[k];
});
after(() => {
  for (const k of envKeys) {
    if (envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = envSnapshot[k];
  }
});
beforeEach(() => {
  for (const k of envKeys) delete process.env[k];
});
afterEach(() => {
  for (const k of envKeys) delete process.env[k];
});

const cleanupDirs = [];
afterEach(() => {
  for (const dir of cleanupDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[playwright-isolation-test] failed to remove temp dir ${dir}: ${err.message}`);
    }
  }
  cleanupDirs.length = 0;
});

describe('browser isolation — knob 1: binary', () => {
  it('default dev mode does NOT set executablePath or channel — Playwright picks its own bundled Chromium', () => {
    delete process.env.HYDRA_EMBEDDED;
    const opts = resolveChromiumLaunchOptions();
    assert.strictEqual(opts.executablePath, undefined,
      'dev mode must not pin executablePath — let Playwright choose its bundle');
    assert.strictEqual(opts.channel, undefined,
      'dev mode must not set channel — that would attach to system browser');
  });

  it('does NOT default to channel:chrome (which would launch user\'s real Chrome)', () => {
    delete process.env.HYDRA_PLAYWRIGHT_CHANNEL;
    const opts = resolveChromiumLaunchOptions();
    assert.notStrictEqual(opts.channel, 'chrome',
      'channel:chrome would launch /Applications/Google Chrome.app with the user\'s real profile');
  });

  // NOTE: priority-1 (HYDRA_PLAYWRIGHT_EXECUTABLE_PATH) and priority-2
  // (HYDRA_PLAYWRIGHT_CHANNEL) opt-in tests are NOT here — `config` loads
  // env once at module-load time, so setting process.env after import has
  // no effect. The opt-in paths are exercised in real life when the user
  // sets the env BEFORE Hydra boots. The safety-critical test is "default
  // does NOT set channel" (above), which guards the unintended-leak case.
});

describe('browser isolation — knob 2: ephemeral userDataDir', () => {
  it('every launch gets a fresh userDataDir', () => {
    const a = resolveChromiumLaunchOptions();
    const b = resolveChromiumLaunchOptions();
    cleanupDirs.push(a.userDataDir, b.userDataDir);
    assert.ok(a.userDataDir, 'opts.userDataDir must be set');
    assert.ok(b.userDataDir, 'opts.userDataDir must be set');
    assert.notStrictEqual(a.userDataDir, b.userDataDir,
      'two consecutive resolves must produce distinct profile dirs');
  });

  it('userDataDir is under tmpdir() (NOT in the user\'s real Chrome profile location)', () => {
    const opts = resolveChromiumLaunchOptions();
    cleanupDirs.push(opts.userDataDir);
    const tmp = tmpdir();
    assert.ok(opts.userDataDir.startsWith(tmp),
      `userDataDir must start with ${tmp}; got ${opts.userDataDir}`);
    // Sanity: must not point at the user's real Chrome profile
    assert.ok(!opts.userDataDir.includes('Library/Application Support/Google/Chrome'),
      'userDataDir must NEVER point at the user\'s real Chrome profile');
    assert.ok(!opts.userDataDir.includes('Library/Application Support/Chromium'),
      'userDataDir must NEVER point at the user\'s real Chromium profile');
  });

  it('userDataDir uses the hydra-pw-profile- prefix (so leftover dirs are findable)', () => {
    const opts = resolveChromiumLaunchOptions();
    cleanupDirs.push(opts.userDataDir);
    const base = basename(opts.userDataDir);
    assert.ok(base.startsWith('hydra-pw-profile-'),
      `expected prefix hydra-pw-profile-; got ${base}`);
  });

  it('makeEphemeralProfileDir creates a real, empty directory', () => {
    const dir = makeEphemeralProfileDir();
    cleanupDirs.push(dir);
    assert.ok(existsSync(dir), 'directory must exist after creation');
    assert.ok(statSync(dir).isDirectory(), 'must be a directory');
  });

  it('cleanupEphemeralProfileDir removes only Hydra-owned ephemeral profile dirs', () => {
    const dir = makeEphemeralProfileDir();
    assert.ok(existsSync(dir), 'directory must exist before cleanup');
    cleanupEphemeralProfileDir(dir);
    assert.equal(existsSync(dir), false, 'Hydra-owned ephemeral profile dir should be removed');

    const foreign = join(tmpdir(), `not-hydra-profile-${process.pid}`);
    mkdirSync(foreign, { recursive: true });
    cleanupDirs.push(foreign);
    cleanupEphemeralProfileDir(foreign);
    assert.ok(existsSync(foreign), 'non-Hydra temp dirs must not be removed');
  });

  it('caller can opt out of ephemeral profile by passing userDataDir: null', () => {
    const opts = resolveChromiumLaunchOptions({ userDataDir: null });
    if (opts.userDataDir != null) cleanupDirs.push(opts.userDataDir);
    // null means "don't manage userDataDir for me" — Playwright defaults take over.
    // Either undefined OR null is acceptable here; what's NOT acceptable is the
    // fallback ephemeral mkdtemp dir.
    assert.ok(
      opts.userDataDir == null || !String(opts.userDataDir).includes('hydra-pw-profile-'),
      'opt-out should NOT have an ephemeral hydra-pw-profile- dir',
    );
  });

  it('caller-provided userDataDir is respected (e.g. for tests that need a stable dir)', () => {
    const stable = join(tmpdir(), 'caller-supplied-dir');
    const opts = resolveChromiumLaunchOptions({ userDataDir: stable });
    assert.strictEqual(opts.userDataDir, stable);
  });
});

describe('browser isolation — knob 3: launch flags', () => {
  it('always includes --no-default-browser-check', () => {
    const opts = resolveChromiumLaunchOptions();
    cleanupDirs.push(opts.userDataDir);
    assert.ok(opts.args.includes('--no-default-browser-check'),
      'without this, the test browser may try to register as default');
  });

  it('always includes --no-first-run', () => {
    const opts = resolveChromiumLaunchOptions();
    cleanupDirs.push(opts.userDataDir);
    assert.ok(opts.args.includes('--no-first-run'));
  });

  it('always includes --disable-sync', () => {
    const opts = resolveChromiumLaunchOptions();
    cleanupDirs.push(opts.userDataDir);
    assert.ok(opts.args.includes('--disable-sync'),
      'without this, any leftover Google account state would phone home');
  });

  it('always includes --disable-background-networking', () => {
    const opts = resolveChromiumLaunchOptions();
    cleanupDirs.push(opts.userDataDir);
    assert.ok(opts.args.includes('--disable-background-networking'));
  });

  it('always includes --use-mock-keychain (macOS keychain isolation)', () => {
    const opts = resolveChromiumLaunchOptions();
    cleanupDirs.push(opts.userDataDir);
    assert.ok(opts.args.includes('--use-mock-keychain'),
      'without this, the test browser reads/writes the user\'s real Keychain');
  });

  it('caller args are appended AFTER isolation args (caller wins on Chromium dedupe semantics)', () => {
    const opts = resolveChromiumLaunchOptions({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    cleanupDirs.push(opts.userDataDir);
    assert.ok(opts.args.includes('--no-default-browser-check'), 'isolation arg present');
    assert.ok(opts.args.includes('--no-sandbox'), 'caller arg preserved');
    const isolationIdx = opts.args.indexOf('--no-default-browser-check');
    const callerIdx = opts.args.indexOf('--no-sandbox');
    assert.ok(callerIdx > isolationIdx,
      'caller args must come after isolation defaults so they can override on collision');
  });
});

describe('browser isolation — overall sanity', () => {
  it('a fresh resolve produces a fully self-contained launch spec', () => {
    const opts = resolveChromiumLaunchOptions();
    cleanupDirs.push(opts.userDataDir);
    assert.strictEqual(typeof opts.headless, 'boolean');
    assert.ok(Array.isArray(opts.args) && opts.args.length >= 5,
      'isolation args + caller args yield a non-empty list');
    assert.ok(opts.userDataDir,
      'every launch has a userDataDir set (either ephemeral or caller-supplied)');
  });

  it('packaged mode extracts archived Chromium into userData before launch', { skip: process.platform === 'win32' ? 'fixture builds chrome-linux via the zip CLI; not available on Windows runners' : false }, () => {
    const root = join(tmpdir(), `hydra-chromium-archive-test-${process.pid}`);
    const resources = join(root, 'resources');
    const archiveSrc = join(root, 'archive-src');
    const dataDir = join(root, 'data');
    const bin = join(archiveSrc, 'chrome-linux', 'chrome');
    cleanupDirs.push(root);
    mkdirSync(join(archiveSrc, 'chrome-linux'), { recursive: true });
    mkdirSync(resources, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);

    const zip = spawnSync('zip', ['-qry', join(resources, 'chromium.zip'), 'chrome-linux'], {
      cwd: archiveSrc,
      encoding: 'utf8',
    });
    assert.equal(zip.status, 0, zip.stderr || zip.stdout);

    const script = `
      Object.defineProperty(process, 'resourcesPath', { value: ${JSON.stringify(resources)}, configurable: true });
      process.env.HYDRA_EMBEDDED = '1';
      process.env.HYDRA_DATA_DIR = ${JSON.stringify(dataDir)};
      const { resolveChromiumLaunchOptions } = await import(${JSON.stringify(new URL('../lib/playwright-browser.js', import.meta.url).href)});
      const opts = resolveChromiumLaunchOptions();
      if (!opts.executablePath || !opts.executablePath.includes('/chromium/chrome-linux/chrome')) {
        throw new Error('unexpected executablePath: ' + opts.executablePath);
      }
      const { existsSync } = await import('node:fs');
      if (!existsSync(opts.executablePath)) throw new Error('extracted executable missing');
      console.log(opts.executablePath);
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HYDRA_EMBEDDED: '1',
        HYDRA_DATA_DIR: dataDir,
      },
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.match(child.stdout, /chromium\/chrome-linux\/chrome/);
  });

  it('stale profile sweep failures keep path-level warning evidence', () => {
    const source = readFileSync(new URL('../lib/playwright-browser.js', import.meta.url), 'utf-8');

    assert.match(source, /sweep: cannot stat stale profile \$\{full\}: \$\{e\.message\}/);
    assert.match(source, /sweep: failed to remove stale profile \$\{full\}: \$\{e\.message\}/);
    assert.doesNotMatch(source, /catch \{\s*continue;\s*\}/);
    assert.doesNotMatch(source, /catch \{\s*stats\.failed \+= 1;\s*\}/);
  });
});
