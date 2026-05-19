import { rotationManager } from './rotation-manager.js';
import { logger } from './logger.js';
import { config, OR_BASE } from '../config.js';
import { recordUpstreamFailure, recordUpstreamHttpResult } from './upstream-health.js';

// How often to test a random key in the background (default 5 mins)
const PING_INTERVAL = 5 * 60 * 1000;
// Validate key metadata without spending completion tokens.
const PING_PATH = '/api/v1/auth/key';
const PING_TIMEOUT_MS = 10 * 1000;
const NETWORK_ERROR_LOG_WINDOW_MS = 60 * 1000;
let timer = null;
let pingInFlight = false;
let lastNetworkErrorAt = 0;

async function pingRandomKey() {
  if (pingInFlight) return;
  pingInFlight = true;

  let timeoutId;

  try {
    await rotationManager.ensureLoaded();
    if (rotationManager.pool.length === 0) return;

    const keyEntry = await rotationManager.getNextKey();
    if (!keyEntry) return;

    const ctrl = new AbortController();
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
    pingInFlight = false;
  }
}

export function startPinger() {
  if (timer) return;
  timer = setInterval(pingRandomKey, PING_INTERVAL);
  logger.info('[PINGER] Background health pinger initialized');
}

export function stopPinger() {
  if (timer) clearInterval(timer);
  timer = null;
}
