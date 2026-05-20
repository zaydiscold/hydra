// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const abs = join(ROOT, dir, entry);
    const rel = join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) out.push(...walk(rel));
    else out.push(relative(ROOT, abs));
  }
  return out;
}

function linesWithNeedle(file, needle) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) hits.push({ lineNumber: i + 1, lines, index: i });
  }
  return hits;
}

test('POSIX mode-bit assertions are guarded away from Windows ACL runners', () => {
  const offenders = [];
  const testFiles = [...walk('server/tests'), ...walk('electron/tests')].filter(file => file.endsWith('.test.mjs'));
  for (const file of testFiles) {
    for (const hit of linesWithNeedle(file, 'mode & 0o')) {
      const nearby = hit.lines.slice(Math.max(0, hit.index - 4), Math.min(hit.lines.length, hit.index + 5)).join('\n');
      if (!nearby.includes("process.platform !== 'win32'") && !nearby.includes('process.platform !== "win32"')) {
        offenders.push(file + ':' + hit.lineNumber);
      }
    }
  }
  assert.deepEqual(offenders, [], 'unguarded POSIX mode assertions: ' + offenders.join(', '));
});

test('scripts never dynamic-import raw resolved OS paths', () => {
  const offenders = [];
  for (const file of walk('scripts').filter(file => file.endsWith('.mjs') || file.endsWith('.js'))) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    if (/import\(\s*resolve\(/.test(src)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'wrap resolved dynamic imports with pathToFileURL(...).href: ' + offenders.join(', '));
});

test('test files declare their platform contract up front', () => {
  const offenders = [];
  const testFiles = [...walk('server/tests'), ...walk('electron/tests')].filter(file => file.endsWith('.test.mjs'));
  for (const file of testFiles) {
    const first = readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/).slice(0, 3).join('\n');
    if (!/@platform (all|posix-only|win32-only)/.test(first)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'missing @platform comment: ' + offenders.join(', '));
});


test('test path comparisons normalize platform separators first', () => {
  const offenders = [];
  const testFiles = [...walk('server/tests'), ...walk('electron/tests')].filter(file => file.endsWith('.test.mjs'));
  for (const file of testFiles) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/\bfile\s*(?:={2,3}|!={1,2})\s*['"][^'"]*\//.test(line)) continue;
      const nearby = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 5)).join('\n');
      if (!nearby.includes('normalizePath') && !nearby.includes('replaceAll(\\\\') && !nearby.includes('path.sep')) {
        offenders.push(file + ':' + (i + 1));
      }
    }
  }
  assert.deepEqual(offenders, [], 'path comparisons with slash literals must normalize separators: ' + offenders.join(', '));
});
