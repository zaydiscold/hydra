#!/usr/bin/env node
/**
 * Kills processes listening on Hydra dev ports so `npm run dev` always binds to
 * the same addresses (server: PORT / 3001, Vite: 5173). Run automatically before dev.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const SERVER_PORT = Number(process.env.PORT ?? process.env.HYDRA_SERVER_PORT ?? 3001);
const VITE_PORT = Number(process.env.HYDRA_VITE_PORT ?? 5173);
const ports = [...new Set([SERVER_PORT, VITE_PORT])].filter((p) => Number.isFinite(p) && p > 0);

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
    throw err;
  }
}

function killListenersUnix(port) {
  const pids = pidsListeningUnix(port);
  for (const pid of pids) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
  if (pids.length) {
    console.log(`[hydra] freed port ${port} (PIDs: ${pids.join(', ')})`);
  }
}

function killListenersWindows(port) {
  try {
    const out = execFileSync('cmd', ['/c', `netstat -ano | findstr :${port}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
    for (const pid of pids) {
      if (pid === process.pid) continue;
      try {
        execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
        console.log(`[hydra] freed port ${port} (PID ${pid})`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* findstr exit 1 = no matches */
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
