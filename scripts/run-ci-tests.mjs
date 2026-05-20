#!/usr/bin/env node
/**
 * CI test runner: executes every script in the npm test chain and reports all
 * failures instead of stopping at the first broken test file.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};
const childEnv = {
  DATABASE_URL: 'file:./prisma/ci.db',
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true',
  HYDRA_DATA_DIR: '.hydra-ci-data',
  JWT_SECRET: 'ci-test-secret-32-characters-long',
  XDG_CACHE_HOME: '/private/tmp/hydra-xdg-cache',
  ...process.env,
};

function collectScripts(rootScript) {
  const command = scripts[rootScript] || '';
  const names = [];
  for (const match of command.matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
    const name = match[1];
    if (name !== 'test:ci') names.push(name);
  }
  return names;
}

function runScript(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('npm', ['run', name], {
      cwd: ROOT,
      env: childEnv,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('close', (code, signal) => {
      resolve({ name, ok: code === 0, code, signal, ms: Date.now() - started });
    });
    child.on('error', (err) => {
      resolve({ name, ok: false, code: null, signal: err.message, ms: Date.now() - started });
    });
  });
}

const testScripts = scripts.pretest ? ['pretest', ...collectScripts('test')] : collectScripts('test');
if (testScripts.length === 0) {
  console.error('No npm test scripts found in package.json');
  process.exit(1);
}

const results = [];
for (const name of testScripts) {
  console.log('\n=== npm run ' + name + ' ===');
  results.push(await runScript(name));
}

console.log('\n=== CI test summary ===');
console.log('| Script | Result | Duration | Exit |');
console.log('| --- | --- | ---: | --- |');
for (const result of results) {
  const status = result.ok ? 'PASS' : 'FAIL';
  const duration = (result.ms / 1000).toFixed(1) + 's';
  const exit = result.signal || String(result.code ?? 'unknown');
  console.log('| `' + result.name + '` | ' + status + ' | ' + duration + ' | ' + exit + ' |');
}

const failed = results.filter(result => !result.ok);
if (failed.length > 0) {
  console.error('\n' + failed.length + ' test script(s) failed: ' + failed.map(result => result.name).join(', '));
  process.exit(1);
}
