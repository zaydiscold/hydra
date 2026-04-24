#!/usr/bin/env node
/**
 * Hydra Smart Launcher
 * Cross-platform (Mac + Windows) launch orchestrator.
 * Handles: deps install, env setup, DB migrations, build, server start, browser open.
 */

import { execSync, spawn } from 'child_process';
import { existsSync, copyFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';

// ─── Colors ──────────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  dim:    '\x1b[2m',
};

function log(symbol, msg, color = c.cyan) {
  console.log(`${color}${symbol}${c.reset} ${msg}`);
}

function step(msg)    { log('▶', msg, c.cyan); }
function success(msg) { log('✓', msg, c.green); }
function warn(msg)    { log('⚠', msg, c.yellow); }
function error(msg)   { log('✗', msg, c.red); }
function info(msg)    { log('·', msg, c.dim); }

// ─── Banner ───────────────────────────────────────────────────────────────────
function printBanner() {
  console.log(`
${c.cyan}${c.bold}  ╔════════════════════════════════╗
  ║   H Y D R A  L A U N C H E R  ║
  ╚════════════════════════════════╝${c.reset}
${c.dim}  OpenRouter API & Account Manager${c.reset}
`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  return execSync(cmd, { 
    cwd: __dirname, 
    stdio: opts.silent ? 'pipe' : 'inherit',
    ...opts 
  });
}

function checkNodeVersion() {
  const version = process.versions.node;
  const major = parseInt(version.split('.')[0]);
  if (major < 18) {
    error(`Node.js v18+ required. You have v${version}.`);
    error('Download it from: https://nodejs.org');
    process.exit(1);
  }
  info(`Node.js v${version} detected`);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}

function waitForPort(port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const socket = createServer();
      socket.once('error', () => {
        // Port is in use = server is up!
        resolve();
      });
      socket.once('listening', () => {
        socket.close();
        if (Date.now() - start > timeoutMs) {
          reject(new Error('Server did not start within 30 seconds'));
        } else {
          setTimeout(check, 300);
        }
      });
      socket.listen(port, '127.0.0.1');
    };
    check();
  });
}

function openBrowser(url) {
  const cmd = isWindows ? `start "" "${url}"` : `open "${url}"`;
  try {
    execSync(cmd, { stdio: 'ignore' });
  } catch {
    warn(`Couldn't auto-open browser. Visit: ${url}`);
  }
}

// ─── Steps ────────────────────────────────────────────────────────────────────
async function checkDependencies() {
  step('Checking dependencies...');
  const nodeModulesPath = join(__dirname, 'node_modules');
  const pkgLockPath = join(__dirname, 'package-lock.json');
  const npmLockInModules = join(nodeModulesPath, '.package-lock.json');

  let needsInstall = !existsSync(nodeModulesPath);
  if (!needsInstall) {
    needsInstall = !existsSync(npmLockInModules);
  }
  if (!needsInstall && existsSync(pkgLockPath)) {
    // If project lockfile changed after last install, refresh dependencies.
    const lockMtime = statSync(pkgLockPath).mtimeMs;
    const nodeModulesLockMtime = statSync(npmLockInModules).mtimeMs;
    needsInstall = lockMtime > nodeModulesLockMtime;
  }

  if (needsInstall) {
    warn('Dependencies missing or stale — running npm install...');
    run('npm install');
    success('Dependencies installed');
  } else {
    success('Dependencies up to date');
  }
}

function checkEnv() {
  step('Checking environment...');
  const envPath = join(__dirname, '.env');
  const envExamplePath = join(__dirname, '.env.example');
  
  if (!existsSync(envPath)) {
    if (existsSync(envExamplePath)) {
      copyFileSync(envExamplePath, envPath);
      warn('.env not found — created from .env.example');
      warn('You may want to review .env before continuing.');
    } else {
      warn('.env file missing. Server may fail to start.');
    }
  } else {
    success('.env found');
  }
}

async function runMigrations() {
  step('Checking database...');
  try {
    run('npx prisma migrate deploy', { silent: true });
    success('Database ready');
  } catch (err) {
    error('Database migration failed. Resolve migration errors before launching.');
    info(err.message?.slice(0, 200));
    process.exit(1);
  }
}

async function ensureBuild() {
  step('Checking production build...');
  const distPath = join(__dirname, 'dist');
  const distIndexPath = join(distPath, 'index.html');

  if (!existsSync(distIndexPath)) {
    warn('No production build found — building now (this may take ~20 seconds)...');
    try {
      run('npm run build');
      success('Build complete');
    } catch {
      error('Build failed! Check vite.config.js and try again.');
      process.exit(1);
    }
  } else {
    success('Production build found');
  }
}

async function checkPort() {
  const PORT = parseInt(process.env.PORT || '3001');
  const free = await isPortFree(PORT);
  
  if (!free) {
    warn(`Port ${PORT} is already in use.`);
    info('Hydra may already be running — check http://localhost:3001');
    
    // Try to just open the browser since it might already be running
    info('Attempting to open existing instance...');
    openBrowser(`http://localhost:${PORT}`);
    process.exit(0);
  }
  return PORT;
}

async function startServer(port) {
  step('Starting Hydra server...');

  const cmd = isWindows ? 'node' : 'node';
  // ─── ELECTRON_MIGRATION ───
  // TODO: PAIN_POINTS.md #7 — After server/index.js auto-bootstrap is removed,
  // spawning 'node server/index.js' will exit immediately (nothing to run).
  // Fix: import bootstrap directly and call it, OR spawn server/standalone.js.
  // Also remove child-process stdout/stderr streaming since it'll run in-process.
  // ─── END ELECTRON_MIGRATION ───
  const serverProc = spawn(cmd, ['server/index.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, NODE_ENV: 'production' },
  });

  // Stream server output with pretty prefix
  serverProc.stdout.on('data', (data) => {
    data.toString().trim().split('\n').forEach(line => {
      if (line.trim()) process.stdout.write(`${c.dim}  [server] ${c.reset}${line}\n`);
    });
  });

  serverProc.stderr.on('data', (data) => {
    data.toString().trim().split('\n').forEach(line => {
      if (line.trim()) process.stdout.write(`${c.red}  [error]  ${c.reset}${line}\n`);
    });
  });

  serverProc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      error(`Server exited with code ${code}`);
      process.exit(code);
    }
  });

  // Wait for the server to be ready
  step('Waiting for server to be ready...');
  try {
    await waitForPort(port);
  } catch {
    error('Server did not start in time. Check the logs above.');
    process.exit(1);
  }

  success(`Hydra is running at http://localhost:${port}`);
  return serverProc;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  printBanner();
  
  try {
    checkNodeVersion();
    await checkDependencies();
    checkEnv();
    await runMigrations();
    await ensureBuild();
    
    const port = await checkPort();
    const serverProc = await startServer(port);
    
    console.log(`
${c.green}${c.bold}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Hydra is live!
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${c.reset}
  ${c.cyan}Local:${c.reset}   http://localhost:${port}
  
  ${c.dim}Press Ctrl+C to stop the server${c.reset}
`);

    // Open browser after a short delay to let the server settle
    setTimeout(() => openBrowser(`http://localhost:${port}`), 800);

    // Keep process alive — exit when server does
    // ─── ELECTRON_MIGRATION ───
    // TODO: PAIN_POINTS.md #2 / #7 — These signal handlers conflict with
    // Electron's lifecycle. After moving to in-process bootstrap(), remove
    // these and let the caller handle signals.
    // ─── END ELECTRON_MIGRATION ───
    process.on('SIGINT', () => {
      log('⏹', 'Shutting down Hydra...', c.yellow);
      serverProc.kill('SIGTERM');
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      serverProc.kill('SIGTERM');
      process.exit(0);
    });

  } catch (err) {
    error(`Launch failed: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

main();
