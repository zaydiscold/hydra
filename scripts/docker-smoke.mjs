#!/usr/bin/env node
import { spawn } from 'node:child_process';
import http from 'node:http';
import process from 'node:process';

const DEFAULT_TIMEOUTS = {
  config: 15_000,
  info: 20_000,
  build: 30 * 60_000,
  up: 120_000,
  health: 90_000,
  ps: 15_000,
  logs: 15_000,
  down: 30_000,
};

const args = new Set(process.argv.slice(2));
const startContainer = args.has('--start');
const keepRunning = args.has('--keep-running');
const skipBuild = args.has('--skip-build');

function timeoutFor(name) {
  const envName = `HYDRA_DOCKER_${name.toUpperCase()}_TIMEOUT_MS`;
  const raw = process.env[envName];
  const value = raw ? Number(raw) : DEFAULT_TIMEOUTS[name];
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUTS[name];
}

function printHelp() {
  console.log(`Hydra Docker smoke

Usage:
  npm run docker:smoke
  npm run docker:smoke -- --start
  npm run docker:smoke -- --start --keep-running

Default behavior validates compose syntax, Docker daemon availability, and the
image build with bounded per-step timeouts.

Options:
  --start         After build, start the compose service and poll /api/auth/status.
  --keep-running  Leave the service running after a successful --start smoke.
  --skip-build    Skip docker compose build. Useful after a known-good build.

Timeout overrides:
  HYDRA_DOCKER_CONFIG_TIMEOUT_MS
  HYDRA_DOCKER_INFO_TIMEOUT_MS
  HYDRA_DOCKER_BUILD_TIMEOUT_MS
  HYDRA_DOCKER_UP_TIMEOUT_MS
  HYDRA_DOCKER_HEALTH_TIMEOUT_MS
  HYDRA_DOCKER_PS_TIMEOUT_MS
  HYDRA_DOCKER_DOWN_TIMEOUT_MS
`);
}

if (args.has('--help') || args.has('-h')) {
  printHelp();
  process.exit(0);
}

function runStep(label, command, commandArgs, timeoutMs) {
  return new Promise((resolve, reject) => {
    console.log(`[docker:smoke] ${label}: ${command} ${commandArgs.join(' ')}`);
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        child.kill('SIGKILL');
      }, 2_000).unref();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
      process.stderr.write(chunk);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`${label} failed to start: ${err.message}`));
    });
    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit ${code}`;
      reject(new Error(`${label} failed with ${reason}`));
    });
  });
}

function httpGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => {
      req.destroy(new Error(`HTTP timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

async function waitForHealth(url, timeoutMs) {
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const status = await httpGet(url, 2_500);
      if (status && status >= 200 && status < 500) {
        console.log(`[docker:smoke] health endpoint responded with HTTP ${status}`);
        return;
      }
      lastError = new Error(`HTTP ${status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`health check timed out after ${timeoutMs}ms: ${lastError?.message || 'no response'}`);
}

async function collectLogs() {
  try {
    await runStep(
      'compose logs',
      'docker',
      ['compose', 'logs', '--tail', '100', 'hydra'],
      timeoutFor('logs'),
    );
  } catch (err) {
    console.error(`[docker:smoke] unable to collect compose logs: ${err.message}`);
  }
}

async function collectComposeState() {
  try {
    await runStep(
      'compose ps',
      'docker',
      ['compose', 'ps', '-a'],
      timeoutFor('ps'),
    );
  } catch (err) {
    console.error(`[docker:smoke] unable to collect compose state: ${err.message}`);
  }
}

async function cleanupContainer() {
  await runStep(
    'compose down',
    'docker',
    ['compose', 'down', '--remove-orphans'],
    timeoutFor('down'),
  );
}

async function main() {
  await runStep('compose config', 'docker', ['compose', 'config'], timeoutFor('config'));
  await runStep('docker daemon', 'docker', ['info'], timeoutFor('info'));

  if (!skipBuild) {
    await runStep('compose build', 'docker', ['compose', 'build'], timeoutFor('build'));
  }

  if (!startContainer) {
    console.log('[docker:smoke] PASS config, daemon, and image build completed');
    return;
  }

  let attemptedStart = false;
  try {
    attemptedStart = true;
    await runStep(
      'compose up',
      'docker',
      ['compose', 'up', '-d', ...(skipBuild ? ['--no-build'] : ['--build']), 'hydra'],
      timeoutFor('up'),
    );
    await waitForHealth('http://127.0.0.1:3001/api/auth/status', timeoutFor('health'));
    console.log('[docker:smoke] PASS container started and local health endpoint responded');
  } catch (err) {
    console.error(`[docker:smoke] FAIL ${err.message}`);
    if (attemptedStart) {
      await collectComposeState();
      await collectLogs();
    }
    throw err;
  } finally {
    if (attemptedStart && !keepRunning) {
      await cleanupContainer().catch((err) => {
        console.error(`[docker:smoke] compose down failed: ${err.message}`);
      });
    }
  }
}

main().catch((err) => {
  console.error(`[docker:smoke] ${err.message}`);
  process.exit(1);
});
