/**
 * Hydra Electron — User Preferences Store
 *
 * Tiny JSON-backed key/value store for opt-in features that don't belong
 * in the encrypted vault (telemetry consent, biometric-unlock toggle, last
 * theme, etc.). Lives at `userData/preferences.json`, written with mode
 * 0o600 so other local users can't read it.
 *
 * Why not Prisma:
 *   • Telemetry init has to happen before the server module is imported,
 *     so we can't go through the Prisma client (Prisma owns its own bootstrap
 *     order via the Proxy in db.js).
 *   • These prefs are device-local UX choices. They aren't user data in the
 *     account-credentials sense; storing them outside SQLite keeps the DB
 *     migration story simple.
 *   • A JSON file is trivial for the user to inspect or wipe.
 *
 * Crash safety:
 *   • Reads are tolerant — malformed JSON returns the defaults map, never throws.
 *   • Writes go to a temp file then rename, so a power-loss can't truncate prefs.
 *   • We chmod 0600 after each write because some umasks would otherwise grant
 *     group-read.
 */
import { app } from 'electron';
import { chmod, readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const FILENAME = 'preferences.json';

/**
 * Default preference values. Add new keys here — call sites read via
 * `getPref(key)` which falls through to this map when the file lacks
 * the key, so backwards compat is automatic.
 */
const DEFAULTS = Object.freeze({
  telemetryEnabled: false,         // #9 — opt-in Sentry crash reporting
  biometricEnabled: false,         // #11 — Touch ID / Windows Hello unlock
  theme: 'auto',                   // 'auto' | 'light' | 'dark'
  proxyTrayBadge: true,            // show "RUNNING" indicator on tray menu
});

let cache = null;

function prefsPath() {
  return path.join(app.getPath('userData'), FILENAME);
}

async function ensureUserDataDir() {
  await mkdir(app.getPath('userData'), { recursive: true });
}

/**
 * Load the full preferences object (file → defaults merge). Returns a
 * fresh object each call; mutate freely without affecting the cache.
 */
export async function getAllPrefs() {
  if (cache) return { ...DEFAULTS, ...cache };
  try {
    const raw = await readFile(prefsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    cache = (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    if (e?.code !== 'ENOENT') {
      console.warn('[prefs] read failed:', e.message);
    }
    cache = {};
  }
  return { ...DEFAULTS, ...cache };
}

/**
 * Read a single preference. `key` must exist in `DEFAULTS` — unknown keys
 * return `undefined` rather than the file's value, so a typo can't silently
 * pull stale data.
 */
export async function getPref(key) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return undefined;
  const all = await getAllPrefs();
  return all[key];
}

/**
 * Write a single preference. Validates the key is known.
 */
export async function setPref(key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    throw new Error(`Unknown preference key: ${key}`);
  }
  await ensureUserDataDir();
  const next = { ...(cache || await getAllPrefs()), [key]: value };
  // remove default-equal entries so the file stays small
  for (const k of Object.keys(next)) {
    if (next[k] === DEFAULTS[k]) delete next[k];
  }
  const dest = prefsPath();
  const tmp = `${dest}.tmp`;
  // Atomic-write pattern: write to .tmp, fix mode, rename. If anything in
  // the rename step fails (EXDEV cross-device, EACCES) we MUST invalidate
  // the cache — otherwise the in-memory state diverges from disk and the
  // next read returns a value the user never persisted.
  try {
    await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await chmod(tmp, 0o600).catch(() => {});
    await rename(tmp, dest);
    cache = next;
  } catch (e) {
    cache = null; // force re-read from disk on next access
    throw e;
  }
}

/** Reset the in-memory cache (test helper). */
export function _resetPrefsCache() { cache = null; }

/**
 * Has the user ever explicitly stored a value for this key? (i.e. is the key
 * present in the on-disk file, regardless of value). Useful for first-run
 * defaulting — we only auto-set biometricEnabled once, never override an
 * explicit user opt-out.
 */
export async function isPrefExplicitlySet(key) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return false;
  // Hot path: if cache has been hydrated, check it
  if (cache) return Object.prototype.hasOwnProperty.call(cache, key);
  // Cold path: hydrate then check
  await getAllPrefs();
  return Object.prototype.hasOwnProperty.call(cache || {}, key);
}

export const PREF_DEFAULTS = DEFAULTS;
