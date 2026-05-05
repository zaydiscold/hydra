#!/usr/bin/env node
/**
 * Hydra Smart Launcher
 * Cross-platform (Mac + Windows) launch orchestrator.
 * Handles: deps install, env setup, DB migrations, build, server start, browser open.
 */

import { execSync } from 'child_process';
import { existsSync, copyFileSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'net';
import { bootstrap, gracefulShutdown } from '../server/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
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
    cwd: PROJECT_ROOT, 
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
  const nodeModulesPath = join(PROJECT_ROOT, 'node_modules');
  const pkgLockPath = join(PROJECT_ROOT, 'package-lock.json');
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
  const envPath = join(PROJECT_ROOT, '.env');
  const envExamplePath = join(PROJECT_ROOT, '.env.example');
  
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
    const { runSelfHeal } = await import('../server/lib/db-self-heal.js');
    // Extract dbPath from DATABASE_URL or use the default Prisma dev.db
    const dbUrl = process.env.DATABASE_URL || `file:${join(PROJECT_ROOT, 'prisma', 'dev.db')}`;
    const dbPath = dbUrl.startsWith('file:') ? dbUrl.slice(5) : dbUrl;
    const migrationsDir = join(PROJECT_ROOT, 'prisma', 'migrations');

    const summary = await runSelfHeal({ dbPath, migrationsDir, log: (m) => info(m) });
    if (summary.errors > 0) {
      error(`Self-heal: ${summary.applied} applied, ${summary.skipped} skipped, ${summary.errors} errors`);
      error('Errors: ' + summary.errorDetails.join('; '));
      process.exit(1);
    }
    success(`Database ready (${summary.applied} migrations applied, ${summary.skipped} already current)`);
  } catch (err) {
    error('Database migration failed. Resolve migration errors before launching.');
    info(err.message?.slice(0, 200));
    process.exit(1);
  }
}

async function ensureBuild() {
  step('Checking production build...');
  const distPath = join(PROJECT_ROOT, 'dist');
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

  await bootstrap({ port });

  success(`Hydra is running at http://localhost:${port}`);
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
    await startServer(port);

    console.log(`\n
${c.green}${c.bold}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Hydra is live!
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${c.reset}
  ${c.cyan}Local:${c.reset}   http://localhost:${port}
  
  ${c.dim}Press Ctrl+C to stop the server${c.reset}
`);

    openBrowser(`http://localhost:${port}`);
    process.on('SIGINT', () => {
      log('⏹', 'Shutting down Hydra...', c.yellow);
      gracefulShutdown('SIGINT', { exit: true });
    });
    process.on('SIGTERM', () => {
      gracefulShutdown('SIGTERM', { exit: true });
    });

  } catch (err) {
    error(`Launch failed: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

main();
