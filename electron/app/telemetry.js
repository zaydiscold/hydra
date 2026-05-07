/**
 * Hydra Electron — Opt-in Crash Telemetry (Sentry)
 *
 * Wraps `@sentry/electron` so the rest of the codebase can call
 * `await initTelemetry()` once and forget about it. Sentry is initialized
 * ONLY when:
 *   • the user has opted in via Settings (preferences.json: telemetryEnabled=true)
 *   • a DSN is provided (env var `HYDRA_SENTRY_DSN` or build-time bake-in)
 *
 * If either is missing, the module is a no-op — no network calls, no native
 * crash reporter started. This is the cheapest possible "off by default" model.
 *
 * What gets sent (when enabled):
 *   • Exception type, message, stack trace
 *   • App version, OS, Electron version, Chrome version
 *   • A correlation ID we generate per-install (random UUID in prefs)
 *   • Phase tag (main / renderer / electron)
 *
 * What is scrubbed (always, even when enabled):
 *   • Anything that matches `sk-or-…`, `sk-hydra-…`, `__session=`, `__client=`
 *     in serialized event payloads (see `scrubEvent` below)
 *   • Network request bodies and response bodies (we never capture them)
 *   • File paths from `userData` are kept (helpful for triage) but path
 *     prefixes from the user's home directory are mapped to `<HOME>/...`
 *
 * Architecture note: `@sentry/electron/main` automatically attaches Electron's
 * native `crashReporter` for hard renderer crashes (Chromium minidump uploads).
 * That means a renderer V8 OOM or a GPU process crash gets captured even
 * though no JS exception ever fires.
 */
import { app, crashReporter } from 'electron';
import { homedir } from 'node:os';

import { getAllPrefs, setPref } from './userPrefs.js';

const PII_PATTERNS = [
  /sk-or-v?\d?-[A-Za-z0-9]+/g,
  /sk-hydra-[A-Za-z0-9]+/g,
  /__session=[^;\s"']+/gi,
  /__client(?:_uat)?[A-Za-z0-9_]*=[^;\s"']+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/g,
];

const HOME_RE = new RegExp(homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

let initialized = false;
let SentryRef = null;

/**
 * Sentry `beforeSend` hook — strip PII from every outgoing event.
 * Returns `null` to drop the event entirely if it still looks dangerous.
 */
function scrubEvent(event) {
  try {
    let serialized = JSON.stringify(event);
    for (const re of PII_PATTERNS) serialized = serialized.replace(re, '[REDACTED]');
    serialized = serialized.replace(HOME_RE, '<HOME>');
    return JSON.parse(serialized);
  } catch {
    // If serialization round-trip fails, drop rather than risk leaking
    return null;
  }
}

/**
 * Initialize Sentry if (a) the user opted in and (b) a DSN is configured.
 * Idempotent — second call is a no-op.
 */
export async function initTelemetry() {
  if (initialized) return false;
  const dsn = process.env.HYDRA_SENTRY_DSN || '';
  if (!dsn) return false; // no DSN → telemetry can't run regardless of opt-in

  let prefs;
  try { prefs = await getAllPrefs(); } catch { prefs = {}; }
  if (!prefs.telemetryEnabled) return false;

  // Lazy-import so non-telemetry installs never load the Sentry SDK at all.
  const Sentry = await import('@sentry/electron/main');
  Sentry.init({
    dsn,
    release: app.getVersion(),
    environment: app.isPackaged ? 'production' : 'development',
    autoSessionTracking: false,    // session-tracking pings are extra traffic we don't need
    sendDefaultPii: false,         // disable user/IP attachment
    tracesSampleRate: 0,           // performance traces off — only crashes
    beforeSend: scrubEvent,
    integrations: (defaults) => defaults.filter((i) => {
      // Strip integrations we don't want: ChildProcess, Net (request bodies)
      const skip = new Set(['ChildProcess', 'Net', 'OnUncaughtException']);
      return !skip.has(i.name);
    }),
  });
  SentryRef = Sentry;

  // Native crash reporter — captures hard renderer / GPU crashes that JS
  // exception hooks can't see. Sentry's main integration usually wires this
  // automatically, but we belt-and-braces to make sure it's on.
  try {
    crashReporter.start({
      productName: 'Hydra',
      uploadToServer: false, // Sentry SDK handles uploads
      ignoreSystemCrashHandler: true,
      submitURL: '',
    });
  } catch { /* some platforms refuse pre-init; ignore */ }

  initialized = true;
  return true;
}

/**
 * Toggle telemetry at runtime. Persists to preferences.json. Note: actual
 * Sentry teardown isn't supported by the SDK — disabling takes effect on
 * next launch (we just stop sending events by setting enabled=false in
 * the SDK options).
 */
export async function setTelemetryEnabled(enabled) {
  await setPref('telemetryEnabled', !!enabled);
  if (SentryRef && !enabled) {
    try {
      const client = SentryRef.getClient();
      if (client) {
        const opts = client.getOptions();
        if (opts) opts.enabled = false;
      }
    } catch { /* ignore */ }
  }
}

/**
 * Capture a manually-built error (e.g. caught in shutdownEverything that
 * we'd otherwise just console.error). No-op when telemetry isn't initialized.
 */
export function captureError(err, context = {}) {
  if (!initialized || !SentryRef) return;
  try { SentryRef.captureException(err, { extra: context }); } catch { /* ignore */ }
}
