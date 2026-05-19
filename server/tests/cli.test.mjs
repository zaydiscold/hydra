import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname;
const CLI = join(ROOT, 'bin/hydra.mjs');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

function runHydra(args, env = {}) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
}

function runHydraRaw(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
}

function runHydraAsync(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });
    child.once('exit', (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function listenOnFreePort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function listenOnFreeHttpServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function waitForOutput(getOutput, pattern, label, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label}; output=${getOutput()}`)), timeoutMs);
    const check = () => {
      if (pattern.test(getOutput())) {
        clearTimeout(timeout);
        resolve();
      } else {
        setTimeout(check, 25);
      }
    };
    check();
  });
}

function prepareAuthDb(password) {
  const dataDir = mkdtempSync(join(tmpdir(), 'hydra-cli-unlock-'));
  const env = {
    ...process.env,
    DATABASE_URL: `file:${join(dataDir, 'hydra.db')}`,
    HYDRA_DATA_DIR: dataDir,
    JWT_SECRET: 'test-cli-unlock-secret-32-chars-long',
  };

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  });
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      import { PrismaClient } from '@prisma/client';
      import bcrypt from 'bcryptjs';
      const prisma = new PrismaClient();
      const passwordHash = await bcrypt.hash(process.env.TEST_HYDRA_PASSWORD, 12);
      await prisma.user.create({ data: { username: 'admin', passwordHash, tokenVersion: 0 } });
      await prisma.$disconnect();
    `,
  ], {
    cwd: ROOT,
    env: { ...env, TEST_HYDRA_PASSWORD: password },
    stdio: 'ignore',
  });
  return env;
}

function prepareSessionDb() {
  const dataDir = mkdtempSync(join(tmpdir(), 'hydra-cli-session-'));
  const env = {
    ...process.env,
    DATABASE_URL: `file:${join(dataDir, 'hydra.db')}`,
    HYDRA_DATA_DIR: dataDir,
    JWT_SECRET: 'test-cli-session-secret-32-chars-long',
  };

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  });
  const accountId = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      import { PrismaClient } from '@prisma/client';
      import bcrypt from 'bcryptjs';
      const prisma = new PrismaClient();
      const user = await prisma.user.create({
        data: {
          username: 'admin',
          passwordHash: await bcrypt.hash('session-test-pass', 12),
          tokenVersion: 0,
        },
      });
      await prisma.$disconnect();
      const store = await import('./server/services/store.js');
      const account = await store.addAccountWithCredentials(user.id, 'cli-session', 'cli-session@example.test', '', 'otp');
      await (await import('./server/services/db.js')).disconnectPrisma();
      process.stdout.write(account.id);
    `,
  ], {
    cwd: ROOT,
    env,
    encoding: 'utf-8',
  }).trim();
  return { env, accountId };
}

function prepareModelsDb() {
  const dataDir = mkdtempSync(join(tmpdir(), 'hydra-cli-models-'));
  const env = {
    ...process.env,
    DATABASE_URL: `file:${join(dataDir, 'hydra.db')}`,
    HYDRA_DATA_DIR: dataDir,
    JWT_SECRET: 'test-cli-models-secret-32-chars-long',
  };

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  });
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      import { PrismaClient } from '@prisma/client';
      const prisma = new PrismaClient();
      await prisma.cachedModel.createMany({
        data: [
          { id: 'anthropic/claude-test', name: 'Claude Test', ctx: 200000, category: 'chat', ownedBy: 'anthropic' },
          { id: 'openai/gpt-test', name: 'GPT Test', ctx: 128000, category: 'chat', ownedBy: 'openai' },
          { id: 'meta/test-free', name: 'Meta Free', ctx: 8192, category: 'free', ownedBy: 'meta' },
        ],
      });
      await prisma.$disconnect();
    `,
  ], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  });
  return env;
}

function prepareImportDb() {
  const dataDir = mkdtempSync(join(tmpdir(), 'hydra-cli-import-write-'));
  const env = {
    ...process.env,
    DATABASE_URL: `file:${join(dataDir, 'hydra.db')}`,
    HYDRA_DATA_DIR: dataDir,
    JWT_SECRET: 'test-cli-import-secret-32-chars-long',
  };

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  });
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      import { PrismaClient } from '@prisma/client';
      import bcrypt from 'bcryptjs';
      const prisma = new PrismaClient();
      await prisma.user.create({
        data: {
          username: 'admin',
          passwordHash: await bcrypt.hash('import-test-pass', 12),
          tokenVersion: 0,
        },
      });
      await prisma.$disconnect();
    `,
  ], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  });
  return env;
}

function prepareAccountsPurgeDb() {
  const dataDir = mkdtempSync(join(tmpdir(), 'hydra-cli-accounts-purge-'));
  const env = {
    ...process.env,
    DATABASE_URL: `file:${join(dataDir, 'hydra.db')}`,
    HYDRA_DATA_DIR: dataDir,
    JWT_SECRET: 'test-cli-accounts-purge-secret-32-chars-long',
  };

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  });
  const ids = JSON.parse(execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      import { PrismaClient } from '@prisma/client';
      import bcrypt from 'bcryptjs';
      const prisma = new PrismaClient();
      const user = await prisma.user.create({
        data: {
          username: 'admin',
          passwordHash: await bcrypt.hash('accounts-purge-pass', 12),
          tokenVersion: 0,
        },
      });
      await prisma.$disconnect();
      const store = await import('./server/services/store.js');
      const dead = await store.addAccount(user.id, 'dead-placeholder');
      const otp = await store.addAccountWithCredentials(user.id, 'otp-keep', 'otp-keep@example.test', '', 'otp');
      await (await import('./server/services/db.js')).disconnectPrisma();
      process.stdout.write(JSON.stringify({ dead: dead.id, otp: otp.id }));
    `,
  ], {
    cwd: ROOT,
    env,
    encoding: 'utf-8',
  }));
  return { env, ids };
}

function prepareKeysProvisionDb() {
  const dataDir = mkdtempSync(join(tmpdir(), 'hydra-cli-keys-provision-'));
  const env = {
    ...process.env,
    DATABASE_URL: `file:${join(dataDir, 'hydra.db')}`,
    HYDRA_DATA_DIR: dataDir,
    JWT_SECRET: 'test-cli-keys-provision-secret-32-chars-long',
  };

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  });
  const ids = JSON.parse(execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      import { PrismaClient } from '@prisma/client';
      import bcrypt from 'bcryptjs';
      const prisma = new PrismaClient();
      const user = await prisma.user.create({
        data: {
          username: 'admin',
          passwordHash: await bcrypt.hash('keys-provision-pass', 12),
          tokenVersion: 0,
        },
      });
      await prisma.$disconnect();
      const store = await import('./server/services/store.js');
      const password = await store.addAccountWithCredentials(user.id, 'password-ready', 'password-ready@example.test', 'stored-pass', 'password');
      const otp = await store.addAccountWithCredentials(user.id, 'otp-blocked', 'otp-blocked@example.test', '', 'otp');
      const keyed = await store.addAccountWithCredentials(user.id, 'keyed-account', 'keyed@example.test', 'stored-pass', 'password', 'sk-or-v1-testmanagementkey1234567890');
      await (await import('./server/services/db.js')).disconnectPrisma();
      process.stdout.write(JSON.stringify({ password: password.id, otp: otp.id, keyed: keyed.id }));
    `,
  ], {
    cwd: ROOT,
    env,
    encoding: 'utf-8',
  }));
  return { env, ids };
}

test('hydra help and version are side-effect-light system commands', () => {
  assert.match(runHydra(['help']), /Hydra CLI/);
  assert.match(runHydra(['help']), /hydra api-map/);
  assert.match(runHydra(['help']), /hydra account/);
  assert.match(runHydra(['help']), /hydra codes/);
  assert.match(runHydra(['help']), /hydra keys/);
  assert.match(runHydra(['help']), /hydra session/);
  assert.match(runHydra(['help']), /hydra proxy/);
  assert.match(runHydra(['help']), /hydra scan/);
  assert.match(runHydra(['help']), /hydra export/);
  assert.match(runHydra(['help']), /hydra import/);
  assert.match(runHydra(['help']), /hydra serve/);
  assert.match(runHydra(['help']), /hydra stop/);
  assert.match(runHydra(['help']), /hydra unlock/);
  assert.match(runHydra(['help']), /hydra ai models/);
  assert.match(runHydra(['help']), /hydra openrouter/);
  assert.match(runHydra(['help']), /hydra audit/);
  assert.equal(runHydra(['version']).trim(), pkg.version);
});

test('hydra audit reports release evidence and deferred manual items without launching the app', () => {
  const help = runHydra(['audit', 'help']);
  assert.match(help, /Hydra audit/);
  assert.match(help, /without launching Electron or Docker/);

  const pretty = runHydra(['audit']);
  assert.match(pretty, /Hydra release audit/);
  assert.match(pretty, /Goal sheet exists/);
  assert.match(pretty, /All audited release evidence is present/);

  const out = runHydra(['audit', '--json']);
  const report = JSON.parse(out);
  assert.equal(report.complete, true);
  assert.equal(report.summary.checked, report.items.length);
  assert.equal(report.summary.missing, 0);
  assert.equal(report.summary.blockers, 0);
  assert.ok(report.summary.deferred >= 4);
  assert.ok(report.items.some((item) => item.id === 'mac-arm-artifact' && item.state === 'ok'));
  assert.ok(report.items.some((item) => item.id === 'packaged-dogfood-runbook' && item.state === 'ok' && /Electron-only final dogfood/.test(item.evidence)));
  assert.ok(report.items.some((item) => item.id === 'mac-intel-artifact' && item.state === 'ok'));
  assert.ok(report.items.some((item) => item.id === 'mac-intel-current' && item.state === 'ok'));
  assert.ok(report.items.some((item) => item.id === 'windows-installer-artifact' && item.state === 'ok' && /win-x64\.exe/.test(item.evidence)));
  assert.ok(report.items.some((item) => item.id === 'dependency-audit' && item.state === 'ok' && /brace-expansion/.test(item.evidence) && /5\.0\.6/.test(item.evidence)));
  assert.ok(report.items.some((item) => item.id === 'packaged-gui-dogfood' && item.state === 'deferred'));
  assert.ok(report.items.some((item) => item.id === 'live-mvp-dogfood' && item.state === 'deferred'));
  assert.ok(report.items.some((item) => item.id === 'packaged-screenshot-audit' && item.state === 'deferred'));
  assert.ok(report.items.some((item) => item.id === 'docker-runtime' && item.state === 'deferred'));
  assert.ok(report.items.some((item) => item.id === 'workflow-contract' && item.state === 'ok' && /publish-after-smoke/.test(item.evidence) && /LaunchServices/.test(item.evidence) && /bundle preflight/.test(item.evidence) && /package diagnostics/.test(item.evidence) && /target-specific resource selection/.test(item.evidence) && /target-specific Chromium/.test(item.evidence) && /native-titlebar/.test(item.evidence) && /app-shell/.test(item.evidence) && /distributable artifact/.test(item.evidence) && /target-specific Prisma engine/.test(item.evidence) && /Windows installer blockmap/.test(item.evidence) && /target-cache miss guidance/.test(item.evidence) && /Intel remote target smoke/.test(item.evidence)));
  assert.ok(report.items.some((item) => item.id === 'cli-runtime-diagnostics' && item.state === 'ok'));
  assert.ok(report.items.some((item) => item.id === 'ui-contract' && /first-run setup/.test(item.evidence)));
  assert.ok(report.items.some((item) => item.id === 'startup-fallback' && item.state === 'ok'));
  assert.ok(report.items.some((item) => item.id === 'settings-prefs' && item.state === 'ok'));
  assert.ok(report.items.some((item) => item.id === 'native-menu-feedback' && item.state === 'ok'));
  assert.ok(report.items.some((item) => item.id === 'fallback-visibility' && item.state === 'ok'));
  assert.ok(report.items.some((item) => item.id === 'redacted-import' && item.state === 'ok'));
  assert.ok(report.items.some((item) => item.id === 'reversible-db-reset' && item.state === 'ok'));
  assert.ok(report.items.some((item) => item.id === 'windows-aux-cleanup' && item.state === 'ok'));
  assert.ok(report.items.some((item) => item.id === 'filesystem-locks' && item.state === 'ok'));
  assert.ok(report.items.some((item) => item.id === 'biometric-fail-closed' && item.state === 'ok'));
  assert.deepEqual(report.blockers, []);
  assert.doesNotMatch(out, /sk-[A-Za-z0-9_-]{8,}/);
});

test('hydra accounts help documents conservative purge behavior', () => {
  const out = runHydra(['accounts', 'help']);
  assert.match(out, /Hydra accounts/);
  assert.match(out, /accounts purge --dead --dry-run/);
  assert.match(out, /no email, no auth method, no stored password/);
});

test('hydra serve and stop help are side-effect-light lifecycle commands', () => {
  const serveHelp = runHydra(['serve', 'help']);
  assert.match(serveHelp, /Hydra serve/);
  assert.match(serveHelp, /server\/standalone\.js/);
  assert.match(serveHelp, /does not open Chrome, Vite, or Electron/);

  const stopHelp = runHydra(['stop', 'help']);
  assert.match(stopHelp, /Hydra stop/);
  assert.match(stopHelp, /POST \/api\/shutdown/);
  assert.match(stopHelp, /HYDRA_TOKEN/);
});

test('hydra unlock help and missing-password path are side-effect-light', () => {
  const help = runHydra(['unlock', 'help']);
  assert.match(help, /Hydra unlock/);
  assert.match(help, /HYDRA_PASSWORD/);
  assert.match(help, /--token-only/);

  const missing = runHydraRaw(['unlock', '--json'], { HYDRA_PASSWORD: '' });
  assert.equal(missing.status, 2);
  const report = JSON.parse(missing.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.error, 'PASSWORD_REQUIRED');
});

test('hydra unlock verifies local password and emits a bearer token for scripts', () => {
  const password = 'cli-unlock-pass';
  const env = prepareAuthDb(password);

  const out = runHydra(['unlock', '--password', password, '--json'], env);
  const report = JSON.parse(out);
  assert.equal(report.ok, true);
  assert.equal(report.tokenType, 'Bearer');
  assert.match(report.token, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.match(report.env, /^HYDRA_TOKEN=/);

  const tokenOnly = runHydra(['unlock', '--password', password, '--token-only'], env).trim();
  assert.match(tokenOnly, /^[^.]+\.[^.]+\.[^.]+$/);
  const payload = JSON.parse(Buffer.from(tokenOnly.split('.')[1], 'base64url').toString('utf-8'));
  assert.equal(payload.username, 'admin');
  assert.equal(payload.tokenVersion, 0);

  const bad = runHydraRaw(['unlock', '--password', 'wrong', '--json'], env);
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout).ok, false);
});

test('hydra stop reports closed ports without requiring auth', async () => {
  const { server, port } = await listenOnFreePort();
  await closeServer(server);

  const out = runHydra(['stop', '--port', String(port), '--json']);
  const report = JSON.parse(out);
  assert.equal(report.running, false);
  assert.equal(report.stopped, false);
  assert.equal(report.port, port);
  assert.equal(report.error, null);
});

test('hydra stop refuses to stop a listener without an unlocked-session token', async () => {
  const { server, port } = await listenOnFreePort();
  try {
    const result = runHydraRaw(['stop', '--port', String(port), '--json'], { HYDRA_TOKEN: '' });
    assert.equal(result.status, 2);
    const report = JSON.parse(result.stdout);
    assert.equal(report.running, true);
    assert.equal(report.stopped, false);
    assert.equal(report.port, port);
    assert.equal(report.error, 'AUTH_TOKEN_REQUIRED');
    assert.match(report.hint, /HYDRA_TOKEN/);
  } finally {
    await closeServer(server);
  }
});

test('hydra stop preserves non-json and timeout shutdown details in source contract', () => {
  const source = readFileSync(join(ROOT, 'bin/commands/stop.js'), 'utf-8');

  assert.match(source, /const SHUTDOWN_TIMEOUT_MS = 5000/);
  assert.match(source, /signal: AbortSignal\.timeout\(SHUTDOWN_TIMEOUT_MS\)/);
  assert.match(source, /const raw = await res\.text\(\)/);
  assert.match(source, /error: 'NON_JSON_RESPONSE'/);
  assert.match(source, /raw: raw\.slice\(0, 500\)/);
  assert.match(source, /err\?\.name === 'TimeoutError' \? 'SHUTDOWN_TIMEOUT' : 'SHUTDOWN_REQUEST_FAILED'/);
  assert.doesNotMatch(source, /await res\.json\(\)/);
});

test('hydra doctor --json reports concrete checks', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hydra-cli-doctor-'));
  const out = runHydra(['doctor', '--json'], { HYDRA_DATA_DIR: dataDir });
  const report = JSON.parse(out);

  assert.equal(report.version, pkg.version);
  assert.equal(report.dataDir, dataDir);
  assert.equal(typeof report.diskFree, 'string');
  assert.equal(report.checks.db.path, join(dataDir, 'hydra.db'));
  assert.equal(report.checks.secrets.path, join(dataDir, 'local-secrets.json'));
  assert.equal(typeof report.checks.chromium.ok, 'boolean');
  assert.equal(typeof report.checks.port.ok, 'boolean');
});

test('hydra top-level system commands default to the same repo data dir as service commands', () => {
  const doctor = JSON.parse(runHydra(['doctor', '--json'], { HYDRA_DATA_DIR: undefined }));
  const dataDir = runHydra(['data-dir'], { HYDRA_DATA_DIR: undefined }).trim();

  assert.equal(doctor.dataDir, join(ROOT, 'data'));
  assert.equal(dataDir, join(ROOT, 'data'));
});

test('hydra doctor recognizes packaged Chromium zip resources', () => {
  const source = readFileSync(join(ROOT, 'bin/hydra.mjs'), 'utf-8');

  assert.match(source, /build\/electron\/chromium\.zip/);
  assert.match(source, /Contents\/Resources\/chromium\.zip/);
  assert.match(source, /release\/win-unpacked\/resources\/chromium\.zip/);
});

test('hydra status --json includes explicit warning channel for degraded proxy metadata', () => {
  const env = prepareAuthDb('status-pass');
  const out = runHydra(['status', '--json'], env);
  const report = JSON.parse(out);

  assert.equal(typeof report.accounts, 'number');
  assert.equal(typeof report.healthy, 'number');
  assert.equal(typeof report.proxy.running, 'boolean');
  assert.equal(Array.isArray(report.warnings), true);

  const source = readFileSync(join(ROOT, 'bin/commands/status.js'), 'utf-8');
  assert.match(source, /proxy key derivation failed:/);
  assert.match(source, /proxy gate status failed:/);
  assert.doesNotMatch(source, /catch \{ \/\* keys not derivable yet \*\/ \}/);
  assert.doesNotMatch(source, /catch \{ \/\* gate not loaded \*\/ \}/);
});

test('hydra logs --json tails without returning the entire file', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hydra-cli-logs-'));
  const lines = Array.from({ length: 120 }, (_, i) => `line-${i + 1}`);
  writeFileSync(join(dataDir, 'hydra.log'), lines.join('\n'), 'utf-8');

  const out = runHydra(['logs', '--json'], { HYDRA_DATA_DIR: dataDir });
  const report = JSON.parse(out);

  assert.equal(report.exists, true);
  assert.equal(report.lines.length, 50);
  assert.equal(report.lines[0], 'line-71');
  assert.equal(report.lines.at(-1), 'line-120');
});

test('hydra logs supports --lines and refuses streaming JSON', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hydra-cli-logs-lines-'));
  const lines = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`);
  writeFileSync(join(dataDir, 'hydra.log'), lines.join('\n'), 'utf-8');

  const out = runHydra(['logs', '--json', '--lines', '3'], { HYDRA_DATA_DIR: dataDir });
  const report = JSON.parse(out);
  assert.deepEqual(report.lines, ['line-8', 'line-9', 'line-10']);

  const failed = runHydraRaw(['logs', '--json', '--tail'], { HYDRA_DATA_DIR: dataDir });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /--json cannot be combined with --tail/);
});

test('hydra logs --tail follows appended log lines', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hydra-cli-logs-tail-'));
  const logPath = join(dataDir, 'hydra.log');
  writeFileSync(logPath, 'boot-1\n', 'utf-8');

  const child = spawn(process.execPath, [CLI, 'logs', '--tail', '--lines', '1', '--quiet'], {
    cwd: ROOT,
    env: { ...process.env, HYDRA_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf-8');
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf-8');
  });

  try {
    await waitForOutput(() => `${stdout}\n${stderr}`, /boot-1/, 'tail did not print initial log');
    appendFileSync(logPath, 'follow-2\n', 'utf-8');
    await waitForOutput(() => `${stdout}\n${stderr}`, /follow-2/, 'tail did not follow appended log');
    assert.equal(stderr, '');
  } finally {
    if (child.exitCode == null) {
      child.kill('SIGINT');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  }
});

test('hydra api-map reads the generated OpenAPI map while Hydra is closed', () => {
  const text = runHydra(['api-map', '--tag', 'accounts']);
  assert.match(text, /Hydra API Map tag=accounts/);
  assert.match(text, /GET \/api\/accounts/);
  assert.match(text, /POST \/api\/accounts\/\{id\}\/refresh/);
  assert.doesNotMatch(text, /GET \/api\/system\/health/);

  const out = runHydra(['api-map', '--json', '--tag', 'system']);
  const report = JSON.parse(out);
  assert.equal(report.total > 0, true);
  assert.equal(report.routes.every((route) => route.tag === 'system'), true);
  assert.equal(report.routes.some((route) => route.path === '/api/system/health'), true);
});

test('hydra ai models reads cached model catalog while Hydra is closed', () => {
  const env = prepareModelsDb();
  const out = runHydra(['ai', 'models', '--filter', 'claude', '--json'], env);
  const report = JSON.parse(out);

  assert.equal(report.source, 'cached-models');
  assert.equal(report.totalCached, 3);
  assert.equal(report.totalMatched, 1);
  assert.equal(report.returned, 1);
  assert.equal(report.models[0].id, 'anthropic/claude-test');
  assert.equal(report.models[0].context, 200000);
});

test('hydra ai chat fails clearly when the local proxy is unavailable', () => {
  const result = runHydraRaw(['ai', 'chat', 'hello', '--route', 'proxy', '--base-url', 'http://127.0.0.1:9/v1', '--key', 'sk-hydra-test', '--json']);
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.error, 'SERVER_UNAVAILABLE');
  assert.match(report.hint, /hydra serve/);
});

test('hydra ai chat calls a running OpenAI-compatible Hydra proxy', async () => {
  let captured = null;
  const { server, port } = await listenOnFreeHttpServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf-8');
    });
    req.on('end', () => {
      captured = {
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: JSON.parse(body),
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        id: 'chatcmpl-test',
        model: captured.body.model,
        choices: [{ message: { role: 'assistant', content: 'hydra proxy ok' } }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }));
    });
  });

  try {
    const result = await runHydraAsync([
      'ai',
      'chat',
      'say hi',
      '--base-url',
      `http://127.0.0.1:${port}/v1`,
      '--key',
      'sk-hydra-test',
      '--model',
      'test/model',
      '--max-tokens',
      '32',
      '--temperature',
      '0',
      '--timeout-ms',
      '2000',
      '--json',
    ]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.text, 'hydra proxy ok');
    assert.equal(report.model, 'test/model');
    assert.equal(report.keySource, 'flag');
    assert.equal(report.usage.total_tokens, 5);

    assert.equal(captured.method, 'POST');
    assert.equal(captured.url, '/v1/chat/completions');
    assert.equal(captured.authorization, 'Bearer sk-hydra-test');
    assert.equal(captured.body.model, 'test/model');
    assert.equal(captured.body.messages[0].content, 'say hi');
    assert.equal(captured.body.max_tokens, 32);
    assert.equal(captured.body.temperature, 0);
    assert.equal(captured.body.stream, false);
  } finally {
    await closeServer(server);
  }
});

test('hydra ai chat can route directly to OpenRouter-compatible API', async () => {
  let captured = null;
  const { server, port } = await listenOnFreeHttpServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf-8');
    });
    req.on('end', () => {
      captured = {
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: JSON.parse(body),
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        id: 'chatcmpl-openrouter-test',
        model: captured.body.model,
        choices: [{ message: { role: 'assistant', content: 'direct openrouter ok' } }],
        usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
      }));
    });
  });

  try {
    const result = await runHydraAsync([
      'ai',
      'chat',
      'direct hello',
      '--route',
      'direct',
      '--openrouter-base-url',
      `http://127.0.0.1:${port}/api/v1`,
      '--openrouter-key',
      'sk-or-v1-test',
      '--model',
      'openrouter/test',
      '--json',
    ]);
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.source, 'openrouter-direct');
    assert.equal(report.text, 'direct openrouter ok');
    assert.equal(report.fallbackCount, 0);
    assert.equal(captured.url, '/api/v1/chat/completions');
    assert.equal(captured.authorization, 'Bearer sk-or-v1-test');
    assert.equal(captured.body.model, 'openrouter/test');
    assert.equal(captured.body.messages[0].content, 'direct hello');
  } finally {
    await closeServer(server);
  }
});

test('hydra openrouter exposes direct models, key, credits, and chat commands', async () => {
  const requests = [];
  const { server, port } = await listenOnFreeHttpServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && req.url.startsWith('/api/v1/models')) {
      res.end(JSON.stringify({
        data: [
          {
            id: 'anthropic/claude-test',
            name: 'Claude Test',
            context_length: 200000,
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
          },
          {
            id: 'openai/gpt-test',
            name: 'GPT Test',
            context_length: 128000,
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
          },
        ],
      }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/v1/key') {
      res.end(JSON.stringify({
        data: {
          label: 'sk-or-v1-secret-secret-1234',
          is_management_key: false,
          is_free_tier: false,
          limit: 100,
          limit_remaining: 74.5,
          usage: 25.5,
          usage_monthly: 25.5,
        },
      }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/v1/credits') {
      res.end(JSON.stringify({ data: { total_credits: 100.5, total_usage: 25.75 } }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });

  try {
    const baseArgs = ['--base-url', `http://127.0.0.1:${port}/api/v1`, '--key', 'sk-or-v1-test', '--json', '--timeout-ms', '2000'];
    const modelsResult = await runHydraAsync(['openrouter', 'models', '--filter', 'claude', ...baseArgs]);
    assert.equal(modelsResult.status, 0, modelsResult.stderr || modelsResult.stdout);
    const models = JSON.parse(modelsResult.stdout);
    assert.equal(models.ok, true);
    assert.equal(models.source, 'openrouter-live');
    assert.equal(models.total, 2);
    assert.equal(models.returned, 1);
    assert.equal(models.models[0].id, 'anthropic/claude-test');

    const keyResult = await runHydraAsync(['openrouter', 'key', ...baseArgs]);
    assert.equal(keyResult.status, 0, keyResult.stderr || keyResult.stdout);
    const key = JSON.parse(keyResult.stdout);
    assert.equal(key.ok, true);
    assert.equal(key.label, 'sk-or-v1-s...1234');
    assert.equal(key.limitRemaining, 74.5);

    const creditsResult = await runHydraAsync(['openrouter', 'credits', ...baseArgs]);
    assert.equal(creditsResult.status, 0, creditsResult.stderr || creditsResult.stdout);
    const credits = JSON.parse(creditsResult.stdout);
    assert.equal(credits.ok, true);
    assert.equal(credits.remaining, 74.75);

    assert.equal(requests.some((request) => request.url.startsWith('/api/v1/models')), true);
    assert.equal(requests.some((request) => request.url === '/api/v1/key'), true);
    assert.equal(requests.some((request) => request.url === '/api/v1/credits'), true);
    assert.equal(requests.every((request) => request.authorization === 'Bearer sk-or-v1-test'), true);
  } finally {
    await closeServer(server);
  }
});

test('hydra codes help is side-effect-light', () => {
  const out = runHydra(['codes', 'help']);
  assert.match(out, /Hydra codes/);
  assert.match(out, /codes preflight/);
  assert.match(out, /codes redeem/);
  assert.match(out, /--yes/);
});

test('hydra codes bulk is confirmation-gated and handles per-account redemption failures', () => {
  const source = readFileSync(join(ROOT, 'bin/commands/codes.js'), 'utf-8');

  assert.match(source, /async function runBulk\(argv, user\)/);
  assert.match(source, /bulk requires <file> and at least one --account <id>/);
  assert.match(source, /bulk is a live OpenRouter action; rerun with --yes after preflight/);
  assert.match(source, /readFileSync\(file, 'utf-8'\)/);
  assert.match(source, /\.split\(\/\\r\?\\n\/\)/);
  assert.match(source, /\.filter\(\(line\) => line && !line\.startsWith\('#'\)\)/);
  assert.match(source, /codes\.flatMap\(\(code\) => accountIds\.map\(\(accountId\) => \(\{ code, accountId \}\)\)\)/);
  assert.match(source, /const \{ redeemCode, classifyRedeemFailure \} = await import\('\.\.\/\.\.\/server\/services\/dashboard-api\.js'\)/);
  assert.match(source, /for \(const assignment of assignments\)/);
  assert.match(source, /await redeemCode\(user\.id, assignment\.accountId, assignment\.code\)/);
  assert.match(source, /classifyRedeemFailure\?\.\(err\.message, err\)/);
  assert.match(source, /results\.push\(\{ \.\.\.assignment, ok: false, error: err\.message, errorCode: classified\.errorCode \}\)/);
  assert.match(source, /json\(\{ file, accountIds, codes, results \}\)/);
});

test('hydra account help is side-effect-light and explicit about redaction', () => {
  const out = runHydra(['account', 'help']);
  assert.match(out, /Hydra account/);
  assert.match(out, /redacted local account details/);
  assert.match(out, /Secrets are never printed/);
});

test('hydra account <id> --json returns redacted detail without secret fields', () => {
  const { env } = prepareKeysProvisionDb();
  const accounts = JSON.parse(runHydra(['accounts', '--json'], env)).accounts;
  assert.ok(accounts.length > 0);

  const report = JSON.parse(runHydra(['account', accounts[0].id.slice(0, 8), '--json'], env));
  assert.equal(report.id, accounts[0].id);
  assert.equal(typeof report.clientCookieCount, 'number');
  assert.equal(typeof report.managementKeyRecords, 'number');
  assert.equal(typeof report.apiKeyRecords, 'number');
  assert.equal(Object.hasOwn(report, 'sessionCookie'), false);
  assert.equal(Object.hasOwn(report, 'clientCookie'), false);
  assert.equal(Object.hasOwn(report, 'clientCookies'), false);
  assert.equal(Object.hasOwn(report, 'password'), false);
  assert.equal(Object.hasOwn(report, 'managementKey'), false);
});

test('hydra accounts purge --dead is dry-run first and deletes only inert placeholder rows', () => {
  const { env, ids } = prepareAccountsPurgeDb();

  const rejected = runHydraRaw(['accounts', 'purge', '--dead', '--json'], env);
  assert.equal(rejected.status, 2);
  assert.equal(JSON.parse(rejected.stdout).error, 'CONFIRMATION_REQUIRED');

  const dryRun = JSON.parse(runHydra(['accounts', 'purge', '--dead', '--dry-run', '--json'], env));
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.scanned, 2);
  assert.equal(dryRun.candidates, 1);
  assert.equal(dryRun.deleted, 0);
  assert.equal(dryRun.accounts[0].id, ids.dead);

  const afterDryRun = JSON.parse(runHydra(['accounts', '--json'], env)).accounts;
  assert.equal(afterDryRun.some((account) => account.id === ids.dead), true);
  assert.equal(afterDryRun.some((account) => account.id === ids.otp), true);

  const deleted = JSON.parse(runHydra(['accounts', 'purge', '--dead', '--yes', '--json'], env));
  assert.equal(deleted.ok, true);
  assert.equal(deleted.dryRun, false);
  assert.equal(deleted.candidates, 1);
  assert.equal(deleted.deleted, 1);

  const remaining = JSON.parse(runHydra(['accounts', '--json'], env)).accounts;
  assert.equal(remaining.some((account) => account.id === ids.dead), false);
  assert.equal(remaining.some((account) => account.id === ids.otp), true);
});

test('hydra accounts sync preflights before live OpenRouter metadata sync', () => {
  const { env, ids } = prepareKeysProvisionDb();

  const rejected = runHydraRaw(['accounts', 'sync', '--json'], env);
  assert.equal(rejected.status, 2);
  assert.equal(JSON.parse(rejected.stdout).error, 'CONFIRMATION_REQUIRED');

  const all = JSON.parse(runHydra(['accounts', 'sync', '--dry-run', '--json'], env));
  assert.equal(all.scanned, 3);
  assert.equal(all.ready, 1);
  assert.equal(all.blocked, 2);
  assert.equal(all.accounts.find((account) => account.accountId === ids.keyed).detail, 'management_key_available');
  assert.equal(all.accounts.find((account) => account.accountId === ids.password).detail, 'missing_management_key');
  assert.equal(all.accounts.find((account) => account.accountId === ids.otp).detail, 'missing_management_key');

  const one = JSON.parse(runHydra(['accounts', 'sync', '--account', ids.keyed.slice(0, 8), '--dry-run', '--json'], env));
  assert.equal(one.scanned, 1);
  assert.equal(one.ready, 1);
  assert.equal(one.accounts[0].accountId, ids.keyed);
});

test('hydra keys help is side-effect-light and does not expose secrets', () => {
  const out = runHydra(['keys', 'help']);
  assert.match(out, /Hydra keys/);
  assert.match(out, /management keys/);
  assert.match(out, /keys provision/);
  assert.match(out, /never printed/);
});

test('hydra keys provision preflights before live management-key creation', () => {
  const { env, ids } = prepareKeysProvisionDb();

  const rejected = runHydraRaw(['keys', 'provision', ids.password.slice(0, 8), '--json'], env);
  assert.equal(rejected.status, 2);
  assert.equal(JSON.parse(rejected.stdout).error, 'CONFIRMATION_REQUIRED');

  const ready = JSON.parse(runHydra(['keys', 'provision', ids.password.slice(0, 8), '--dry-run', '--json'], env));
  assert.equal(ready.ok, true);
  assert.equal(ready.ready, true);
  assert.equal(ready.detail, 'password_reauth');
  assert.equal(ready.existingManagementKey, false);
  assert.equal(ready.session.clientCookieCount, 0);

  const blocked = JSON.parse(runHydra(['keys', 'provision', ids.otp.slice(0, 8), '--dry-run', '--json'], env));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ready, false);
  assert.equal(blocked.detail, 'blocked');

  const existing = JSON.parse(runHydra(['keys', 'provision', ids.keyed.slice(0, 8), '--dry-run', '--json'], env));
  assert.equal(existing.ok, false);
  assert.equal(existing.detail, 'already_has_management_key');
  assert.equal(existing.existingManagementKey, true);
});

test('hydra keys rotate preflights before live management-key replacement', () => {
  const { env, ids } = prepareKeysProvisionDb();

  const rejected = runHydraRaw(['keys', 'rotate', ids.keyed.slice(0, 8), '--json'], env);
  assert.equal(rejected.status, 2);
  assert.equal(JSON.parse(rejected.stdout).error, 'CONFIRMATION_REQUIRED');

  const ready = JSON.parse(runHydra(['keys', 'rotate', ids.keyed.slice(0, 8), '--dry-run', '--json'], env));
  assert.equal(ready.ok, true);
  assert.equal(ready.ready, true);
  assert.equal(ready.detail, 'password_reauth');
  assert.equal(ready.accountId, ids.keyed);
  assert.equal(typeof ready.currentKeyId, 'string');
  assert.equal(ready.session.clientCookieCount, 0);

  const missing = JSON.parse(runHydra(['keys', 'rotate', ids.password.slice(0, 8), '--dry-run', '--json'], env));
  assert.equal(missing.ok, false);
  assert.equal(missing.ready, false);
  assert.equal(missing.detail, 'missing_management_key');
  assert.equal(missing.currentKeyId, null);
});

test('hydra session help is side-effect-light and does not expose secrets', () => {
  const out = runHydra(['session', 'help']);
  assert.match(out, /Hydra session/);
  assert.match(out, /cookie-stack count/);
  assert.match(out, /--refresh/);
  assert.match(out, /never printed/);
});

test('hydra session --refresh exercises live probe path without printing secrets', () => {
  const { env, accountId } = prepareSessionDb();
  const out = runHydra(['session', accountId.slice(0, 8), '--refresh', '--json'], env);
  const report = JSON.parse(out);

  assert.equal(report.id, accountId);
  assert.equal(report.live, true);
  assert.equal(report.sessionStatus, 'none');
  assert.equal(report.canOtpReauth, true);
  assert.equal(report.redeemReadiness, 'reauth_otp');
  assert.equal(Object.hasOwn(report, 'sessionCookie'), false);
  assert.equal(Object.hasOwn(report, 'clientCookie'), false);
  assert.equal(Object.hasOwn(report, 'clientCookies'), false);
});

test('hydra proxy help is side-effect-light', () => {
  const out = runHydra(['proxy', 'help']);
  assert.match(out, /Hydra proxy/);
  assert.match(out, /proxy status/);
  assert.match(out, /proxy keys new/);
  assert.match(out, /masked Hydra proxy keys/);
});

test('hydra proxy status --json returns masked proxy keys', () => {
  const out = runHydra(['proxy', 'status', '--json']);
  const report = JSON.parse(out);

  assert.equal(typeof report.running, 'boolean');
  assert.equal(typeof report.gateEnabled, 'boolean');
  assert.equal(typeof report.port, 'number');
  assert.match(report.hydraKey, /^sk-hydra\.\.\.[a-f0-9]{4}$/i);
  assert.match(report.genericKey, /^sk-proj-\.\.\.[a-f0-9]{4}$/i);
  assert.doesNotMatch(report.hydraKey, /^sk-hydra-[a-f0-9]{32}$/i);
  assert.doesNotMatch(report.genericKey, /^sk-proj-[a-f0-9]{48}$/i);
});

test('hydra proxy keys new is confirmation-gated and rotates isolated proxy keys', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hydra-cli-proxy-keys-'));
  const env = {
    HYDRA_DATA_DIR: dataDir,
    DATABASE_URL: `file:${join(dataDir, 'hydra.db')}`,
  };

  const rejected = runHydraRaw(['proxy', 'keys', 'new', '--json'], env);
  assert.equal(rejected.status, 2);
  const rejectedReport = JSON.parse(rejected.stdout);
  assert.equal(rejectedReport.ok, false);
  assert.equal(rejectedReport.error, 'CONFIRMATION_REQUIRED');

  const before = JSON.parse(runHydra(['proxy', 'status', '--json'], env));
  const rotated = JSON.parse(runHydra(['proxy', 'keys', 'new', '--yes', '--json'], env));
  const after = JSON.parse(runHydra(['proxy', 'status', '--json'], env));

  assert.equal(rotated.ok, true);
  assert.equal(rotated.rotated, true);
  assert.match(rotated.hydraKey, /^sk-hydra-[a-f0-9]{32}$/i);
  assert.match(rotated.genericKey, /^sk-proj-[a-f0-9]{48}$/i);
  assert.notEqual(after.hydraKey, before.hydraKey);
  assert.notEqual(after.genericKey, before.genericKey);
  assert.equal(rotated.previous.hydraKey, before.hydraKey);
  assert.equal(rotated.previous.genericKey, before.genericKey);
});

test('hydra scan help is side-effect-light', () => {
  const out = runHydra(['scan', 'help']);
  assert.match(out, /Hydra scan/);
  assert.match(out, /scan --quick/);
  assert.match(out, /local account\/session\/key metadata/);
});

test('hydra scan --quick --json returns a local fleet summary without secret fields', () => {
  const { env } = prepareKeysProvisionDb();
  const out = runHydra(['scan', '--quick', '--json'], env);
  const report = JSON.parse(out);

  assert.equal(typeof report.summary.accounts, 'number');
  assert.equal(Array.isArray(report.accounts), true);
  assert.equal(report.summary.accounts, report.accounts.length);
  for (const account of report.accounts) {
    assert.equal(typeof account.id, 'string');
    assert.equal(typeof account.sessionStatus, 'string');
    assert.equal(typeof account.clientCookieCount, 'number');
    assert.equal(Object.hasOwn(account, 'sessionCookie'), false);
    assert.equal(Object.hasOwn(account, 'clientCookie'), false);
    assert.equal(Object.hasOwn(account, 'clientCookies'), false);
    assert.equal(Object.hasOwn(account, 'password'), false);
  }
});

test('hydra export help is side-effect-light and explicit about redaction', () => {
  const out = runHydra(['export', 'help']);
  assert.match(out, /Hydra export/);
  assert.match(out, /redacted/);
  assert.match(out, /Secrets are intentionally excluded/);
});

test('hydra export writes a redacted owner-only metadata file', () => {
  const { env } = prepareKeysProvisionDb();
  const dir = mkdtempSync(join(tmpdir(), 'hydra-cli-export-'));
  const outPath = join(dir, 'fleet.json');
  const out = runHydra(['export', '--out', outPath, '--json'], env);
  const summary = JSON.parse(out);
  const raw = readFileSync(outPath, 'utf-8');
  const exported = JSON.parse(raw);
  const mode = statSync(outPath).mode & 0o777;

  assert.equal(summary.path, outPath);
  assert.equal(mode, 0o600);
  assert.equal(exported.schema, 'hydra.redacted-export.v1');
  assert.ok(Array.isArray(exported.accounts));
  assert.ok(Array.isArray(exported.managementKeys));
  assert.ok(Array.isArray(exported.apiKeys));
  assert.doesNotMatch(raw, /sk-(?:or-v1|hydra|proj)-/i);
  assert.doesNotMatch(raw, /__session=/i);
  assert.doesNotMatch(raw, /__client=/i);
  assert.doesNotMatch(raw, /"encryptedKey"\s*:/);
  assert.doesNotMatch(raw, /"sessionToken"\s*:/);
  assert.doesNotMatch(raw, /"clientCookie"\s*:/);
  assert.doesNotMatch(raw, /"clientCookies"\s*:/);
});

test('hydra import --dry-run validates a redacted export without writes', () => {
  const { env } = prepareKeysProvisionDb();
  const dir = mkdtempSync(join(tmpdir(), 'hydra-cli-import-'));
  const outPath = join(dir, 'fleet.json');
  runHydra(['export', '--out', outPath, '--json'], env);

  const out = runHydra(['import', outPath, '--dry-run', '--json'], env);
  const report = JSON.parse(out);

  assert.equal(report.path, outPath);
  assert.equal(report.schema, 'hydra.redacted-export.v1');
  assert.equal(report.redacted, true);
  assert.equal(typeof report.accounts, 'number');
  assert.equal(typeof report.managementKeys, 'number');
  assert.equal(typeof report.apiKeyRecords, 'number');
});

test('hydra import writes redacted metadata only after confirmation', () => {
  const env = prepareImportDb();
  const dir = mkdtempSync(join(tmpdir(), 'hydra-cli-import-write-file-'));
  const importPath = join(dir, 'fleet.json');
  const payload = {
    schema: 'hydra.redacted-export.v1',
    generatedAt: '2026-05-16T18:00:00.000Z',
    summary: {
      accounts: 1,
      activeSessions: 1,
      managementKeys: 1,
      apiKeyRecords: 1,
      pooledKeys: 1,
    },
    accounts: [{
      id: 'acct-imported-redacted',
      alias: 'imported-redacted',
      email: 'imported@example.test',
      authMethod: 'otp',
      sessionStatus: 'active',
      sessionExpiry: '2026-05-22T00:00:00.000Z',
      passwordOnFile: true,
      createdAt: '2026-05-01T00:00:00.000Z',
    }],
    managementKeys: [{
      id: 'mgmt-redacted',
      accountId: 'acct-imported-redacted',
      name: 'redacted management key',
      status: 'active',
      metadata: { source: 'fixture' },
      createdAt: '2026-05-01T00:00:00.000Z',
    }],
    apiKeys: [{
      hash: 'hash-imported-redacted',
      accountId: 'acct-imported-redacted',
      label: 'Imported API Key',
      name: 'Imported API Key',
      disabled: false,
      isPooled: true,
      limit: 10,
      limitRemaining: 5,
      limitReset: 'month',
      usage: 1,
      usageMonthly: 2,
      createdAt: '2026-05-01T00:00:00.000Z',
    }],
  };
  writeFileSync(importPath, `${JSON.stringify(payload, null, 2)}\n`);

  const unconfirmed = runHydraRaw(['import', importPath, '--json'], env);
  assert.equal(unconfirmed.status, 1);
  assert.equal(JSON.parse(unconfirmed.stdout).code, 'CONFIRMATION_REQUIRED');

  const out = runHydra(['import', importPath, '--yes', '--json'], env);
  const report = JSON.parse(out);

  assert.equal(report.imported, true);
  assert.equal(report.accountsCreated, 1);
  assert.equal(report.apiKeysCreated, 1);
  assert.equal(report.accountsSkipped, 0);
  assert.equal(report.apiKeysSkipped, 0);
  assert.equal(report.managementKeysSkipped, 1);
  assert.equal(report.secretsRestored, 0);

  const stored = JSON.parse(execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      import { PrismaClient } from '@prisma/client';
      import { decrypt, decryptConfig } from './server/services/storage-codec.js';
      const prisma = new PrismaClient();
      const account = await prisma.account.findUnique({
        where: { id: 'acct-imported-redacted' },
        include: { keys: true, managementKeys: true },
      });
      const key = account.keys[0];
      process.stdout.write(JSON.stringify({
        account: {
          id: account.id,
          alias: account.alias,
          sessionToken: decrypt(account.sessionToken),
          config: decryptConfig(account.config),
        },
        key: {
          hash: key.hash,
          key: key.key,
          disabled: key.disabled,
          isPooled: key.isPooled,
          label: key.label,
        },
        managementKeys: account.managementKeys.length,
      }));
      await prisma.$disconnect();
    `,
  ], {
    cwd: ROOT,
    env,
    encoding: 'utf-8',
  }));

  assert.equal(stored.account.alias, 'imported-redacted');
  assert.equal(stored.account.sessionToken, '');
  assert.equal(stored.account.config.email, 'imported@example.test');
  assert.equal(stored.account.config.password, null);
  assert.equal(stored.account.config.importedRedacted, true);
  assert.equal(stored.account.config.originalSessionStatus, 'active');
  assert.equal(stored.key.hash, 'hash-imported-redacted');
  assert.equal(stored.key.key, null);
  assert.equal(stored.key.disabled, true);
  assert.equal(stored.key.isPooled, false);
  assert.equal(stored.managementKeys, 0);
});

test('hydra db reset is confirmation-gated and moves database files to a backup', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hydra-cli-db-reset-'));
  const env = {
    ...process.env,
    HYDRA_DATA_DIR: dataDir,
    DATABASE_URL: `file:${join(dataDir, 'hydra.db')}`,
  };
  const dbPath = join(dataDir, 'hydra.db');
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  writeFileSync(dbPath, 'db');
  writeFileSync(walPath, 'wal');
  writeFileSync(shmPath, 'shm');

  const preview = JSON.parse(runHydra(['db', 'reset', '--dry-run', '--json'], env));
  assert.equal(preview.dryRun, true);
  assert.equal(preview.wouldMove, 3);
  assert.equal(existsSync(dbPath), true);

  const unconfirmed = runHydraRaw(['db', 'reset', '--json'], env);
  assert.equal(unconfirmed.status, 1);
  assert.equal(JSON.parse(unconfirmed.stdout).code, 'CONFIRMATION_REQUIRED');
  assert.equal(existsSync(dbPath), true);

  const reset = JSON.parse(runHydra(['db', 'reset', '--yes', '--json'], env));
  assert.equal(reset.reset, true);
  assert.equal(reset.deleted, 0);
  assert.equal(reset.moved.length, 3);
  assert.equal(existsSync(dbPath), false);
  assert.equal(existsSync(walPath), false);
  assert.equal(existsSync(shmPath), false);
  for (const item of reset.moved) {
    assert.equal(existsSync(item.to), true);
    assert.match(item.to, /reset-backups/);
  }
});
