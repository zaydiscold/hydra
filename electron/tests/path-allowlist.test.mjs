// @platform all
/**
 * Path-allowlist contract test for the `native:open-path` IPC handler.
 *
 * The renderer is treated as untrusted — it can pass any string as a path.
 * `isPathInAllowlist` must:
 *   - reject non-strings
 *   - reject empty strings
 *   - reject paths that don't exist (realpathSync would throw)
 *   - reject paths outside the allowlist roots
 *   - reject symlink escapes (a symlink inside an allowed root that points
 *     outside it must NOT be accepted)
 *   - accept paths inside an allowed root
 *
 * Runs with plain `node --test` — no Electron app context needed because the
 * pure helper takes the allowed roots as an argument.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isPathInAllowlist } from '../app/path-allowlist.js';

let tmp;            // an "allowed root"
let outsideTmp;     // outside the root
let insideFile;     // a real file inside the root
let escapeSymlink;  // symlink inside the root pointing outside it

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hydra-allowlist-'));
  outsideTmp = mkdtempSync(join(tmpdir(), 'hydra-outside-'));

  insideFile = join(tmp, 'inside.txt');
  writeFileSync(insideFile, 'ok');

  // Symlink trap: <tmp>/escape -> <outsideTmp>
  escapeSymlink = join(tmp, 'escape');
  symlinkSync(outsideTmp, escapeSymlink, 'dir');

  // Sub-dir inside the allowed root (legitimate)
  mkdirSync(join(tmp, 'sub'));
  writeFileSync(join(tmp, 'sub', 'ok.txt'), 'ok');
});

after(() => {
  for (const dir of [tmp, outsideTmp]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[path-allowlist-test] failed to remove temp dir ${dir}: ${err.message}`);
    }
  }
});

describe('isPathInAllowlist', () => {
  it('rejects non-string input', () => {
    assert.strictEqual(isPathInAllowlist(null, [tmp]), false);
    assert.strictEqual(isPathInAllowlist(undefined, [tmp]), false);
    assert.strictEqual(isPathInAllowlist(123, [tmp]), false);
    assert.strictEqual(isPathInAllowlist({ path: tmp }, [tmp]), false);
  });

  it('rejects empty string', () => {
    assert.strictEqual(isPathInAllowlist('', [tmp]), false);
  });

  it('rejects when allowlist is missing or empty', () => {
    assert.strictEqual(isPathInAllowlist(insideFile, []), false);
    assert.strictEqual(isPathInAllowlist(insideFile, null), false);
    assert.strictEqual(isPathInAllowlist(insideFile, undefined), false);
  });

  it('rejects paths that do not exist (realpathSync throws)', () => {
    assert.strictEqual(isPathInAllowlist(join(tmp, 'does-not-exist'), [tmp]), false);
  });

  it('rejects paths outside the allowlist', () => {
    assert.strictEqual(isPathInAllowlist(outsideTmp, [tmp]), false);
    assert.strictEqual(isPathInAllowlist('/etc', [tmp]), false);
  });

  it('rejects symlink escapes (a link inside the root that points outside)', () => {
    // <tmp>/escape -> <outsideTmp>. realpathSync resolves to <outsideTmp>,
    // which is NOT in the allowlist. Bypass attempt → reject.
    assert.strictEqual(isPathInAllowlist(escapeSymlink, [tmp]), false);
  });

  it('accepts the allowed root itself', () => {
    assert.strictEqual(isPathInAllowlist(tmp, [tmp]), true);
  });

  it('accepts a real file inside the allowed root', () => {
    assert.strictEqual(isPathInAllowlist(insideFile, [tmp]), true);
  });

  it('accepts a nested file inside the allowed root', () => {
    assert.strictEqual(isPathInAllowlist(join(tmp, 'sub', 'ok.txt'), [tmp]), true);
  });

  it('accepts when target is in the second of multiple roots', () => {
    assert.strictEqual(isPathInAllowlist(insideFile, ['/etc', tmp]), true);
  });
});
