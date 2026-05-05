#!/usr/bin/env node
/**
 * Hydra CLI — global `hydra` after `npm link` in this repo.
 *   hydra           → production-style launch (launch.js)
 *   hydra dev       → Vite + Express (npm run dev)
 *   hydra doctor    → run diagnostics
 *   hydra logs      → show log file paths
 *   hydra data-dir  → show data directory path
 *   hydra version   → show version
 *   hydra help      → usage
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const [, , sub] = process.argv;
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function runNodeLaunch() {
  const child = spawn(process.execPath, ['scripts/launch.js'], { cwd: root, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function runNpmDev() {
  const child = spawn(npmCmd, ['run', 'dev'], {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

/** Read package.json for version. */
function getVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Resolve the platform-native data directory. */
function getDataDir() {
  if (process.env.HYDRA_DATA_DIR) return process.env.HYDRA_DATA_DIR;
  if (isWin && process.env.APPDATA) return join(process.env.APPDATA, 'Hydra');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Hydra');
  if (process.env.XDG_DATA_HOME) return join(process.env.XDG_DATA_HOME, 'hydra');
  return join(homedir(), '.local', 'share', 'hydra');
}

/** Resolve log directory. */
function getLogDir() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Logs', 'Hydra');
  if (isWin && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'Hydra', 'logs');
  return join(getDataDir(), 'logs');
}

function showDoctor() {
  console.log('\n=== Hydra Doctor ===\n');

  // Node version
  const nodeMajor = parseInt(process.versions.node.split('.')[0]);
  console.log(`  Node.js:      ${process.versions.node} ${nodeMajor >= 18 ? '(✓ ≥ 18)' : '(✗ NEEDS 18+)'}`);

  // Platform
  console.log(`  Platform:     ${process.platform} ${process.arch}`);

  // Package version
  console.log(`  Version:      ${getVersion()}`);

  // Data dir
  const dataDir = getDataDir();
  console.log(`  Data dir:     ${dataDir} ${existsSync(dataDir) ? '✓' : '(not yet created)'}`);

  // Log dir
  const logDir = getLogDir();
  console.log(`  Log dir:      ${logDir} ${existsSync(logDir) ? '✓' : '(not yet created)'}`);

  // Dependencies
  const nmPath = join(root, 'node_modules');
  console.log(`  node_modules: ${nmPath} ${existsSync(nmPath) ? '✓' : '(✗ missing — run npm install)'}`);

  // .env file
  const envPath = join(root, '.env');
  console.log(`  .env:         ${envPath} ${existsSync(envPath) ? '✓' : '(✗ missing — copy from .env.example)'}`);

  // DB file from DATABASE_URL or default
  const dbUrl = process.env.DATABASE_URL || `file:${join(root, 'prisma', 'dev.db')}`;
  const dbPath = dbUrl.startsWith('file:') ? dbUrl.slice(5) : dbUrl;
  console.log(`  Database:     ${dbPath} ${existsSync(dbPath) ? '✓' : '(not yet created — will be created on first run)'}`);

  // Prisma schema
  const schemaPath = join(root, 'prisma', 'schema.prisma');
  console.log(`  Schema:       ${schemaPath} ${existsSync(schemaPath) ? '✓' : '(✗ missing)'}`);

  // Build
  const distPath = join(root, 'dist', 'index.html');
  console.log(`  Build:        ${distPath} ${existsSync(distPath) ? '✓' : '(missing — run npm run build)'}`);

  // Prisma generate
  try {
    const prismaClient = join(root, 'node_modules', '.prisma', 'client');
    const prismaGenerated = existsSync(prismaClient);
    console.log(`  Prisma gen:   ${prismaGenerated ? '✓' : '(✗ missing — run npx prisma generate)'}`);
  } catch {
    console.log(`  Prisma gen:   ?`);
  }

  console.log('');
}

function showLogs() {
  const logDir = getLogDir();
  console.log(`Hydra logs directory: ${logDir}`);
  if (!existsSync(logDir)) {
    console.log('(log file not yet created — logs appear after first launch)');
  }
  console.log('');
  console.log('Common locations:');
  console.log(`  ${logDir}`);
}

function showDataDir() {
  console.log(getDataDir());
}

function showVersion() {
  console.log(getVersion());
}

if (sub === 'help' || sub === '-h' || sub === '--help') {
  console.log(`Hydra CLI

  hydra              Start production-style server (launch.js) — API + static UI on PORT
  hydra dev          Start Vite + Express for development
  hydra doctor       Run system diagnostics
  hydra logs         Show log file paths
  hydra data-dir     Show data directory path
  hydra version      Show version number
  hydra help         Show this help

Install once from the repo root:
  npm link
Then run \`hydra\` from any directory (links to this clone).`);
  process.exit(0);
}

if (sub === 'dev') {
  runNpmDev();
} else if (sub === 'doctor') {
  showDoctor();
  process.exit(0);
} else if (sub === 'logs') {
  showLogs();
  process.exit(0);
} else if (sub === 'data-dir') {
  showDataDir();
  process.exit(0);
} else if (sub === 'version' || sub === '-v' || sub === '--version') {
  showVersion();
  process.exit(0);
} else if (sub) {
  console.error(`Unknown command: ${sub}\nRun hydra help for usage.`);
  process.exit(1);
} else {
  runNodeLaunch();
}
