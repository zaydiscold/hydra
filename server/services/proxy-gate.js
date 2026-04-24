/**
 * Proxy kill switch state.
 * Shared between server/index.js (middleware) and SystemController (toggle endpoint).
 * Lives here to avoid circular imports.
 *
 * State is persisted to data/proxy-gate.json so it survives restarts.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ─── ELECTRON_MIGRATION ───
// TODO: PAIN_POINTS.md #5 — Replace process.cwd() with:
//   process.env.HYDRA_DATA_DIR || join(process.cwd(), 'data')
// Same pattern needed in: local-secrets.js, auth.js, redemption-log.js
// ─── END ELECTRON_MIGRATION ───
const DATA_DIR = join(process.cwd(), 'data');
const STATE_FILE = join(DATA_DIR, 'proxy-gate.json');

function loadPersistedState() {
  try {
    const raw = readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.enabled === 'boolean') return parsed.enabled;
  } catch { /* file missing or corrupt — use default */ }
  return true; // default: enabled
}

function persistState(enabled) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2));
  } catch (err) {
    // Non-fatal — log but don't crash
    console.warn(`[proxy-gate] Failed to persist state: ${err.message}`);
  }
}

let _enabled = loadPersistedState();

export const proxyGate = {
  get enabled() { return _enabled; },
  enable()  { _enabled = true;  persistState(true); },
  disable() { _enabled = false; persistState(false); },
  set(val)  { _enabled = !!val; persistState(_enabled); },
};
