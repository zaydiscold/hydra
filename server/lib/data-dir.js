import path from 'node:path';

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
