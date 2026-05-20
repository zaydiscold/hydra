import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readJson(path) {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf-8'));
}

function listTestFiles(dir) {
  return readdirSync(join(ROOT, dir))
    .filter(name => name.endsWith('.test.mjs'))
    .map(name => `${dir}/${name}`)
    .sort();
}

function collectReachableScripts(scripts, rootScript) {
  const reachable = new Set();
  const queue = [rootScript];

  while (queue.length > 0) {
    const name = queue.shift();
    if (reachable.has(name)) continue;
    reachable.add(name);

    const command = scripts[name] || '';
    for (const match of command.matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
      queue.push(match[1]);
    }
  }

  return reachable;
}

test('npm test reaches every normal server and Electron test file', () => {
  const pkg = readJson('package.json');
  const scripts = pkg.scripts || {};
  const reachableScripts = collectReachableScripts(scripts, 'test');
  const reachableCommands = [...reachableScripts].map(name => scripts[name] || '').join('\n');

  const requiredFiles = [
    ...listTestFiles('server/tests'),
    ...listTestFiles('electron/tests'),
  ];

  const missing = requiredFiles.filter(file => !reachableCommands.includes(file));

  assert.deepEqual(missing, [], `test files not reachable from npm test: ${missing.join(', ')}`);
});
