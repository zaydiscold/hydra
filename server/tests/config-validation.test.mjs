// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

function importConfig(extraEnv = {}) {
  return execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      const mod = await import('./server/config.js');
      const validated = mod.validateConfig();
      console.log(JSON.stringify({
        jwtSecret: mod.config.JWT_SECRET,
        validatedJwtSecret: validated.JWT_SECRET,
      }));
    `,
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./prisma/dev.db',
      ...extraEnv,
    },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('config dev JWT fallback satisfies the minimum secret length', () => {
  const output = importConfig({ JWT_SECRET: undefined });
  const parsed = JSON.parse(output);
  assert.equal(parsed.jwtSecret, parsed.validatedJwtSecret);
  assert.ok(parsed.jwtSecret.length >= 32);
});

test('config rejects whitespace-only JWT_SECRET', () => {
  assert.throws(
    () => importConfig({ JWT_SECRET: '   ' }),
    /JWT_SECRET must be at least 32 characters after trimming/,
  );
});

test('validateConfig returns the parsed config object', () => {
  const output = importConfig({ JWT_SECRET: 'test-config-secret-32-chars-long' });
  const parsed = JSON.parse(output);
  assert.equal(parsed.jwtSecret, 'test-config-secret-32-chars-long');
  assert.equal(parsed.validatedJwtSecret, parsed.jwtSecret);
});
