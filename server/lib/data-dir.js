import path from 'node:path';
import { chmodSync, mkdirSync } from 'node:fs';
import { logger } from '../services/logger.js';

/**
 * Resolve the Hydra data directory.
 * Prefers HYDRA_DATA_DIR env var (set by Electron), falls back to process.cwd()/data.
 */
export function getDataDir() {
  return process.env.HYDRA_DATA_DIR || path.join(process.cwd(), 'data');
}

/**
 * Join path segments under the data directory.
 * @param  {...string} segments
 * @returns {string}
 */
export function getDataPath(...segments) {
  return path.join(getDataDir(), ...segments);
}

/**
 * Ensure the runtime data directory exists and is owner-only.
 *
 * The directory holds local secrets, encrypted session blobs, proxy state,
 * redemption history, and SQLite files. Node's default recursive mkdir uses
 * 0o777 masked by umask, which can become world-readable on permissive systems.
 */
export function ensureDataDirSync() {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    try {
      chmodSync(dir, 0o700);
    } catch (err) {
      logger.warn(`[data-dir] chmod 0700 failed for ${dir}: ${err.message}`);
    }
  }
  return dir;
}
