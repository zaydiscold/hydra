#!/usr/bin/env node
/**
 * Kills processes listening on Hydra dev ports so `npm run dev` always binds to
 * the same addresses (server: PORT / 3001, Vite: 5173, preview: 4173).
 * Run automatically before dev.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const SERVER_PORT = Number(process.env.PORT ?? process.env.HYDRA_SERVER_PORT ?? 3001);
const VITE_PORT = Number(process.env.HYDRA_VITE_PORT ?? 5173);
const PREVIEW_PORT = Number(process.env.HYDRA_PREVIEW_PORT ?? 4173);
const EXTRA_PORTS = String(process.env.HYDRA_EXTRA_DEV_PORTS ?? '')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((port) => Number.isFinite(port) && port > 0);
const ports = [...new Set([SERVER_PORT, VITE_PORT, PREVIEW_PORT, ...EXTRA_PORTS])]
  .filter((p) => Number.isFinite(p) && p > 0);

function warnPortCleanup(message, details = {}) {
  const suffix = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  console.warn(`[hydra] dev-port cleanup: ${message}${suffix ? ` (${suffix})` : ''}`);
}

function pidsListeningUnix(port) {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return [...new Set(out.trim().split(/\n/).filter(Boolean).map(Number))].filter(Number.isFinite);
  } catch (err) {
    const code = err?.status ?? err?.code;
    if (code === 1) return [];
    warnPortCleanup('failed to inspect listening Unix port', {
      port,
      error: err?.message,
      code,
    });
    return [];
  }
}

function killListenersUnix(port) {
  const pids = pidsListeningUnix(port);
  const killed = [];
  const failed = [];
  for (const pid of pids) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, 'SIGKILL');
      killed.push(pid);
    } catch (err) {
      failed.push(pid);
      warnPortCleanup('failed to kill Unix listener', {
        port,
        pid,
        error: err?.message,
        code: err?.code,
      });
    }
  }
  if (killed.length) {
    console.log(`[hydra] freed port ${port} (PIDs: ${killed.join(', ')})`);
  }
  if (failed.length) {
    warnPortCleanup('port may still be occupied after cleanup attempt', {
      port,
      pids: failed.join(','),
    });
  }
}

function killListenersWindows(port) {
  let out = '';
  try {
    out = execFileSync('cmd', ['/c', `netstat -ano | findstr :${port}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (err?.status === 1) return;
    warnPortCleanup('failed to inspect listening Windows port', {
      port,
      error: err?.message,
      code: err?.status ?? err?.code,
    });
    return;
  }

  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 5) continue;
    const local = parts[1];
    const state = parts[3];
    const pid = Number(parts[4]);
    if (state === 'LISTENING' && local?.endsWith(`:${port}`) && Number.isFinite(pid)) {
      pids.add(pid);
    }
  }

  const failed = [];
  for (const pid of pids) {
    if (pid === process.pid) continue;
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
      console.log(`[hydra] freed port ${port} (PID ${pid})`);
    } catch (err) {
      failed.push(pid);
      warnPortCleanup('failed to kill Windows listener', {
        port,
        pid,
        error: err?.message,
        code: err?.status ?? err?.code,
      });
    }
  }
  if (failed.length) {
    warnPortCleanup('port may still be occupied after cleanup attempt', {
      port,
      pids: failed.join(','),
    });
  }
}

try {
  for (const port of ports) {
    if (process.platform === 'win32') killListenersWindows(port);
    else killListenersUnix(port);
  }
} catch (err) {
  console.warn('[hydra] could not free dev ports (install lsof on Unix, or free ports manually):', err.message);
}

await new Promise((r) => setTimeout(r, 200));
