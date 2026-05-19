#!/usr/bin/env node
/**
 * Cross-platform dev launcher for the Electron shell.
 *
 * Keeps Vite's actual port and Electron's `VITE_DEV_SERVER_URL` in sync.
 * Shell-style env assignment is intentionally avoided so this works from
 * macOS/Linux shells and Windows cmd/PowerShell.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

const vitePort = Number(process.env.HYDRA_VITE_PORT) || 5173;
const devServerUrl = process.env.VITE_DEV_SERVER_URL || `http://localhost:${vitePort}`;
const binExt = process.platform === 'win32' ? '.cmd' : '';
const concurrentlyBin = join(process.cwd(), 'node_modules', '.bin', `concurrently${binExt}`);

const env = {
  ...process.env,
  HYDRA_VITE_PORT: String(vitePort),
  VITE_DEV_SERVER_URL: devServerUrl,
};

console.log(`[dev:electron] Vite renderer: ${devServerUrl}`);

const child = spawn(concurrentlyBin, [
  '-k',
  '-n', 'vite,electron',
  '-c', 'green,magenta',
  'vite --host',
  'electron .',
], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  shell: false,
});

child.on('error', (err) => {
  console.error(`[dev:electron] failed to launch concurrently: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
