import { rotationManager } from './rotation-manager.js';
import { logger } from './logger.js';
import { OR_BASE } from '../config.js';

// How often to test a random key in the background (default 5 mins)
const PING_INTERVAL = 5 * 60 * 1000;
// Free model used for cheap health pings — update when OR deprecates it
const PING_MODEL = 'google/gemini-2.0-flash-lite:free';
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

    // Pick a random key from the active pool
    const randomIndex = Math.floor(Math.random() * rotationManager.pool.length);
    const keyEntry = rotationManager.pool[randomIndex];
    const ctrl = new AbortController();
    timeoutId = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);

    const res = await fetch(`${OR_BASE}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keyEntry.keyString}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3001',
      },
      // 1-token cheap payload
      body: JSON.stringify({
        model: PING_MODEL,
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 1
      }),
      signal: ctrl.signal
    });

    if (res.status === 401) {
      logger.warn(`[PINGER] Background health check discovered dead key: ${keyEntry.hash.slice(0, 8)}`);
      await rotationManager.evict(keyEntry.hash);
    } else if (res.status === 429) {
      rotationManager.applyCooldown(keyEntry.hash, 429);
    } else if (res.status === 402) {
      rotationManager.applyCooldown(keyEntry.hash, 402);
    } else {
      // Key is healthy
      // logger.debug(`[PINGER] Key ${keyEntry.hash.slice(0,8)} is healthy`);
    }
  } catch (err) {
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
