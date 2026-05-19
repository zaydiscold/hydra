/**
 * Proxy kill switch state.
 * Shared between server/index.js (middleware) and SystemController (toggle endpoint).
 * Lives here to avoid circular imports.
 *
 * State is persisted to data/proxy-gate.json so it survives restarts.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

import { logger } from './logger.js';
import { ensureDataDirSync, getDataDir } from '../lib/data-dir.js';

const DATA_DIR = getDataDir();
const STATE_FILE = join(DATA_DIR, 'proxy-gate.json');

function loadPersistedState() {
  try {
    const raw = readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.enabled === 'boolean') return parsed.enabled;
    logger.warn(`[proxy-gate] Ignoring invalid persisted state shape at ${STATE_FILE}; defaulting enabled=true`);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      logger.warn(`[proxy-gate] Could not read persisted state at ${STATE_FILE}; defaulting enabled=true: ${err.message}`);
    }
  }
  return true; // default: enabled
}

function persistState(enabled) {
  // Swarm #25: write errors used to be silently swallowed at logger.warn level,
  // which meant a disabled proxy could silently revert to enabled on restart
  // (because loadPersistedState falls back to true on read failure).
  // We retain in-memory state regardless, but escalate persistence failures so
  // an operator notices that their "off" intent will not survive a restart.
  try {
    ensureDataDirSync();
    writeFileSync(STATE_FILE, JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2));
    return true;
  } catch (err) {
    // First attempt failed — try once more before escalating.
    try {
      ensureDataDirSync();
      writeFileSync(STATE_FILE, JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2));
      logger.warn(`[proxy-gate] Persisted state on retry after initial failure: ${err.message}`);
      return true;
    } catch (retryErr) {
      logger.error(
        `[proxy-gate] CRITICAL: Failed to persist proxy gate state (enabled=${enabled}) after retry. ` +
        `In-memory state is correct, but the operator's intent will NOT survive a restart. ` +
        `STATE_FILE=${STATE_FILE} initialError=${err.message} retryError=${retryErr.message}`
      );
      return false;
    }
  }
}

let _enabled = loadPersistedState();
const events = new EventEmitter();

function setEnabled(val) {
  const next = !!val;
  const changed = next !== _enabled;
  _enabled = next;
  persistState(_enabled);
  if (changed) {
    events.emit('change', { enabled: _enabled });
  }
}

export const proxyGate = {
  get enabled() { return _enabled; },
  enable()  { setEnabled(true); },
  disable() { setEnabled(false); },
  set(val)  { setEnabled(val); },
  onChange(listener) {
    events.on('change', listener);
    return () => events.off('change', listener);
  },
};
