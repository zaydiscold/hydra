import { rotationManager } from './rotation-manager.js';
import { logger } from './logger.js';
import { config, OR_BASE } from '../config.js';
import { recordUpstreamFailure, recordUpstreamHttpResult } from './upstream-health.js';

// How often to test a random key in the background (default 5 mins).
const DEFAULT_PING_INTERVAL_MS = 5 * 60 * 1000;
const PING_INTERVAL_MS = readNonNegativeMs('HYDRA_HEALTH_PING_INTERVAL_MS', DEFAULT_PING_INTERVAL_MS);
const PING_STARTUP_DELAY_MS = readNonNegativeMs('HYDRA_HEALTH_PING_STARTUP_DELAY_MS', PING_INTERVAL_MS);
// Validate key metadata without spending completion tokens.
const PING_PATH = '/api/v1/auth/key';
const PING_TIMEOUT_MS = 10 * 1000;
const NETWORK_ERROR_LOG_WINDOW_MS = 60 * 1000;
let timer = null;
let pingInFlight = false;
let pingPromise = null;
let activeController = null;
let stopping = false;
let lastNetworkErrorAt = 0;

function readNonNegativeMs(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function pingRandomKey() {
  if (pingInFlight) return;
  pingInFlight = true;

  let timeoutId;
  let ctrl = null;

  try {
    await rotationManager.ensureLoaded();
    if (rotationManager.pool.length === 0) return;

    const keyEntry = await rotationManager.getNextKey();
    if (!keyEntry) return;

    ctrl = new AbortController();
    activeController = ctrl;
    timeoutId = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);

    const res = await fetch(`${OR_BASE}${PING_PATH}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${keyEntry.keyString}`,
        'HTTP-Referer': `http://localhost:${config.PORT}`,
      },
      signal: ctrl.signal
    });

    // Non-5xx HTTP responses mean the machine can reach OpenRouter. Key-specific
    // statuses are handled below; upstream/server failures are tracked as offline.
    const reachable = recordUpstreamHttpResult({
      statusCode: res.status,
      source: 'OpenRouter key health check',
    });
    if (!reachable) {
      logger.warn(`[PINGER] Health check returned upstream HTTP ${res.status}; leaving key state unchanged`);
      return;
    }

    if (res.status === 401) {
      logger.warn(`[PINGER] Background health check discovered dead key: ${keyEntry.hash.slice(0, 8)}`);
      await rotationManager.evict(keyEntry.hash);
    } else if (res.status === 429) {
      rotationManager.applyCooldown(keyEntry.hash, 429);
    } else if (res.status === 402) {
      rotationManager.applyCooldown(keyEntry.hash, 402);
    } else {
      rotationManager.recordSuccess(keyEntry.hash);
    }
  } catch (err) {
    if (stopping && err?.name === 'AbortError') return;
    recordUpstreamFailure(err);
    const now = Date.now();
    if (now - lastNetworkErrorAt >= NETWORK_ERROR_LOG_WINDOW_MS) {
      if (err?.name === 'AbortError') {
        logger.warn(`[PINGER] Health check timed out after ${PING_TIMEOUT_MS}ms`);
      } else {
        logger.warn(`[PINGER] Health check network failure: ${err.message}`);
      }
      lastNetworkErrorAt = now;
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (activeController === ctrl) activeController = null;
    pingInFlight = false;
  }
}

function scheduleNextPing(delayMs = PING_INTERVAL_MS) {
  if (stopping || timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (stopping) return;
    pingPromise = pingRandomKey().finally(() => {
      pingPromise = null;
      scheduleNextPing(PING_INTERVAL_MS);
    });
  }, delayMs);
  timer.unref?.();
}

export function startPinger() {
  if (timer || pingPromise) return;
  stopping = false;
  scheduleNextPing(PING_STARTUP_DELAY_MS);
  logger.info(`[PINGER] Background health pinger initialized (startupDelayMs=${PING_STARTUP_DELAY_MS}, intervalMs=${PING_INTERVAL_MS})`);
}

export async function stopPinger() {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  activeController?.abort();
  activeController = null;
  if (pingPromise) {
    await pingPromise.catch((err) => {
      logger.warn(`[PINGER] Stop waited on failed health ping: ${err.message}`);
    });
    pingPromise = null;
  }
}
