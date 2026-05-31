/**
 * Persist a small, owner-only updater handoff record so the newly installed
 * build can run upgrade maintenance before it starts the embedded server.
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const PENDING_FILE = 'pending-update-handoff.json';
const LAST_COMPLETED_FILE = 'last-update-handoff.json';

function handoffPath(name) {
  return path.join(app.getPath('userData'), name);
}

function writeOwnerOnlyJson(targetPath, payload) {
  const tmpPath = `${targetPath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(tmpPath, 0o600);
  fs.renameSync(tmpPath, targetPath);
  if (process.platform !== 'win32') fs.chmodSync(targetPath, 0o600);
}

export function recordPendingUpdate(targetVersion) {
  const payload = {
    fromVersion: app.getVersion(),
    targetVersion: String(targetVersion || 'unknown'),
    recordedAt: new Date().toISOString(),
  };
  writeOwnerOnlyJson(handoffPath(PENDING_FILE), payload);
  return payload;
}

export function readPendingUpdate() {
  const targetPath = handoffPath(PENDING_FILE);
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    console.warn(`[electron-updater] pending update handoff unreadable: ${err?.message || err}`);
    return null;
  }
}

export function completePendingUpdate(payload) {
  const completed = {
    ...payload,
    completedAt: new Date().toISOString(),
  };
  writeOwnerOnlyJson(handoffPath(LAST_COMPLETED_FILE), completed);
  try {
    fs.unlinkSync(handoffPath(PENDING_FILE));
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  return completed;
}
