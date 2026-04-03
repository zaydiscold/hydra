#!/usr/bin/env node
/**
 * Hydra CLI — global `hydra` after `npm link` in this repo.
 *   hydra       → production-style launch (launch.js)
 *   hydra dev   → Vite + Express (npm run dev)
 *   hydra help  → usage
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const [, , sub] = process.argv;
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function runNodeLaunch() {
  const child = spawn(process.execPath, ['launch.js'], { cwd: root, stdio: 'inherit' });
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

if (sub === 'help' || sub === '-h' || sub === '--help') {
  console.log(`Hydra CLI

  hydra              Start production-style server (launch.js) — API + static UI on PORT
  hydra dev          Start Vite + Express for development
  hydra help         Show this help

Install once from the repo root:
  npm link
Then run \`hydra\` from any directory (links to this clone).`);
  process.exit(0);
}

if (sub === 'dev') {
  runNpmDev();
} else if (sub) {
  console.error(`Unknown command: ${sub}\nRun hydra help for usage.`);
  process.exit(1);
} else {
  runNodeLaunch();
}
