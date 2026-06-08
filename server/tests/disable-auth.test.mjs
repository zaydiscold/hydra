// @platform all
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

function run(script, extraEnv = {}) {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
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
  // The last line is our JSON; earlier lines may be dotenv/security-warning noise.
  const lines = out.trim().split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

const CONFIG_SCRIPT = `
  const mod = await import('./server/config.js');
  console.log(JSON.stringify({ disableAuth: mod.config.HYDRA_DISABLE_AUTH }));
`;

const MIDDLEWARE_SCRIPT = `
  const { requireUnlocked } = await import('./server/middleware/auth.js');
  const req = { headers: {} };               // no Authorization header, no cookie
  let status = null, nexted = false;
  const res = { status(c){ status = c; return this; }, json(){ return this; } };
  await requireUnlocked(req, res, () => { nexted = true; });
  console.log(JSON.stringify({ nexted, status, user: req.user ? req.user.username : null }));
`;

test('config: HYDRA_DISABLE_AUTH defaults to false when unset', () => {
  const { disableAuth } = run(CONFIG_SCRIPT, { HYDRA_DISABLE_AUTH: '' });
  assert.equal(disableAuth, false);
});

test('config: HYDRA_DISABLE_AUTH=1 parses to true', () => {
  const { disableAuth } = run(CONFIG_SCRIPT, { HYDRA_DISABLE_AUTH: '1' });
  assert.equal(disableAuth, true);
});

test('middleware: unauthenticated request is REJECTED (401) when auth enabled', () => {
  const r = run(MIDDLEWARE_SCRIPT, { HYDRA_DISABLE_AUTH: '' });
  assert.equal(r.nexted, false);
  assert.equal(r.status, 401);
});

test('middleware: unauthenticated request is ALLOWED with bypass identity when HYDRA_DISABLE_AUTH=1', () => {
  const r = run(MIDDLEWARE_SCRIPT, { HYDRA_DISABLE_AUTH: '1' });
  assert.equal(r.nexted, true);
  assert.equal(r.status, null);
  assert.equal(r.user, 'admin'); // real admin user, or synthetic 'admin' fallback
});

// ── Behavior tests for the interactive disable/enable flow ──────────────────
// In-process with a mocked prisma (real bcrypt). These exercise the actual
// auth-service logic; the spawn-based tests above cover the env-var path.
const DB_SPEC = new URL('../services/db.js', import.meta.url).href;

let userRow = null;
function resetUser(row) {
  userRow = row ? { id: 'u1', username: 'admin', tokenVersion: 0, authDisabled: false, ...row } : null;
}

mock.module(DB_SPEC, {
  exports: {
    prisma: {
      user: {
        findUnique: async ({ where = {}, select } = {}) => {
          if (!userRow) return null;
          if (where.username && where.username !== userRow.username) return null;
          if (where.id && where.id !== userRow.id) return null;
          if (select) {
            const out = {};
            for (const k of Object.keys(select)) out[k] = userRow[k];
            return out;
          }
          return { ...userRow };
        },
        update: async ({ data = {} }) => {
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && 'increment' in v) userRow[k] = (userRow[k] || 0) + v.increment;
            else userRow[k] = v;
          }
          return { ...userRow };
        },
        count: async () => (userRow ? 1 : 0),
      },
      account: { count: async () => 0 },
    },
  },
});

const { getSetupStatus, disableAuth, enableAuth, login } = await import('../services/auth.js');
const { requireUnlocked } = await import('../middleware/auth.js');

test('getSetupStatus reflects the persisted authDisabled flag', async () => {
  resetUser({ authDisabled: true, passwordHash: 'x' });
  assert.equal((await getSetupStatus()).authDisabled, true);
  resetUser({ authDisabled: false, passwordHash: 'x' });
  assert.equal((await getSetupStatus()).authDisabled, false);
});

test('disableAuth rejects a wrong current password and leaves protection ON', async () => {
  resetUser({ passwordHash: await bcrypt.hash('right-pass', 12), authDisabled: false });
  await assert.rejects(() => disableAuth('wrong-pass'), /Current password is incorrect/);
  assert.equal(userRow.authDisabled, false);
});

test('disableAuth with the correct password turns protection OFF and blanks the password', async () => {
  resetUser({ passwordHash: await bcrypt.hash('right-pass', 12), authDisabled: false, tokenVersion: 0 });
  await disableAuth('right-pass');
  assert.equal(userRow.authDisabled, true);
  assert.equal(userRow.tokenVersion, 1); // live sessions invalidated
  // The old password no longer works — the hash was blanked to an unusable sentinel.
  await assert.rejects(() => login('right-pass'), /Invalid credentials/);
});

test('enableAuth requires a new password', async () => {
  resetUser({ passwordHash: 'sentinel', authDisabled: true });
  await assert.rejects(() => enableAuth(''), /New password must be at least 1 character/);
});

test('re-enabling uses a brand-new password — the disabled one can never lock you out', async () => {
  resetUser({ passwordHash: await bcrypt.hash('old-pass', 12), authDisabled: false });
  await disableAuth('old-pass'); // protection off, old hash blanked
  await enableAuth('new-pass');  // back on with a fresh password
  assert.equal(userRow.authDisabled, false);
  assert.ok(await login('new-pass')); // new password works
  await assert.rejects(() => login('old-pass'), /Invalid credentials/); // old password is dead
});

test('middleware bypasses with the admin identity when the DB authDisabled flag is set', async () => {
  resetUser({ passwordHash: 'sentinel', authDisabled: true });
  const req = { headers: {} };
  let status = null, nexted = false;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  await requireUnlocked(req, res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(status, null);
  assert.equal(req.user.username, 'admin');
});
