import fs from 'node:fs';
import { promises as fsp } from 'node:fs';

const LOCK_TTL_MS = 60_000;

async function readLockPayload(lockPath) {
  try {
    const [pidStr, tsStr] = (await fsp.readFile(lockPath, 'utf-8')).trim().split(':');
    const pid = Number(pidStr);
    const ts = Number(tsStr);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(ts)) return null;
    return { pid, ts };
  } catch { return null; }
}

async function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      const { execFileSync } = await import('node:child_process');
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
        timeout: 3000,
        encoding: 'utf-8',
        windowsHide: true,
      });
      return out.includes(String(pid));
    }
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return process.platform === 'win32' && e.code === 'EPERM';
  }
}

export async function acquireMigrationLock(lockPath) {
  if (fs.existsSync(lockPath)) {
    const payload = await readLockPayload(lockPath);
    const stale = payload && (Date.now() - payload.ts > LOCK_TTL_MS || !(await isPidAlive(payload.pid)));
    if (stale) {
      console.warn(`[electron] migration lock at ${lockPath} is stale (pid=${payload.pid}, age=${Date.now() - payload.ts}ms) — breaking lock`);
      try {
        fs.unlinkSync(lockPath);
      } catch (err) {
        console.warn(`[electron] failed to remove stale migration lock at ${lockPath}: ${err.message}`);
      }
    }
  }

  try {
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeSync(fd, `${process.pid}:${Date.now()}`);
    return fd;
  } catch (e) {
    if (e.code === 'EEXIST') {
      console.warn(`[electron] migration lock held by another process at ${lockPath}; skipping db-self-heal`);
    }
    throw e;
  }
}
