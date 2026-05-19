/**
 * Rotation Manager — In-memory API key pool with circuit-breaker logic.
 *
 * Strategy: Weighted random by remaining balance (with round-robin fallback).
 * Circuit breaker: 429 → 60s cooldown, 402 → 10min cooldown, 401 → permanent eviction.
 */

import { prisma } from './db.js';
import { logger } from './logger.js';

const COOLDOWN_429 = 60 * 1000;        // 1 min for rate-limits
const COOLDOWN_402 = 10 * 60 * 1000;   // 10 min for credit-depleted keys
const MAX_RETRIES = 4;                 // Drop key after 4 consecutive proxy failures
const MAX_LOGIN_ATTEMPTS = 4;          // Stop login attempts after 4 consecutive failures (prevents account lockout)
const SELECTION_FALLBACK_LOG_WINDOW_MS = 60 * 1000;

class RotationManager {
  constructor() {
    /** @type {Array<{hash: string, keyString: string, name: string, accountAlias: string, accountId: string}>} */
    this.pool = [];
    this.index = 0;
    /** @type {Map<string, number>} hash → expiry timestamp */
    this.cooldowns = new Map();
    /** @type {Map<string, number>} hash → consecutive failure count */
    this.failureCounts = new Map();
    /** @type {Map<string, {count: number, lastAttempt: number}>} accountId → login attempt tracking */
    this.loginAttempts = new Map();
    this.loaded = false;
    this.userId = null;
    /** @type {string|null} ISO timestamp of last pool reload */
    this.lastSyncAt = null;
    /** @type {AbortController|null} — cancels in-flight reload during shutdown */
    this._reloadController = null;
    this._lastSelectionFallbackWarningAt = 0;
  }

  /** Called lazily on first request if pool was never initialized */
  async ensureLoaded() {
    if (this.loaded) return;
    const user = await prisma.user.findFirst();
    if (!user) return;
    this.userId = user.id;
    await this.reload();
  }

  /** Reload the pool from DB. Call after any pool toggle. Cancellable via cancelReload(). */
  async reload() {
    // Cancel any previous in-flight reload
    if (this._reloadController) {
      this._reloadController.abort();
    }
    this._reloadController = new AbortController();
    const signal = this._reloadController.signal;

    if (!this.userId) {
      const user = await prisma.user.findFirst();
      if (!user) return;
      this.userId = user.id;
    }

    signal.throwIfAborted();

    // Lazy import to avoid circular require
    const { getPooledKeys } = await import('./store.js');
    const keys = await getPooledKeys(this.userId);

    signal.throwIfAborted();

    this.pool = keys;
    this.index = 0;
    this.loaded = true;
    this.lastSyncAt = new Date().toISOString();
    this._reloadController = null;
    logger.info(`[POOL] Rotation pool reloaded: ${keys.length} active key(s)`);
  }

  /**
   * Cancel any in-flight reload(). Safe to call during shutdown.
   * Resolves when the current reload is aborted.
   */
  cancelReload() {
    if (this._reloadController) {
      this._reloadController.abort();
    }
  }

  /**
   * Returns the next available key dynamically weighted by $ remaining.
   * Keys with higher balances are statistically more likely to be picked.
   * @returns {Promise<{hash: string, keyString: string, name: string, limitRemaining: number} | null>}
   */
  async getNextKey(excludedHashes = new Set()) {
    await this.ensureLoaded();

    if (this.pool.length === 0) return null;

    const now = Date.now();
    const available = this.pool.filter(k => {
      const exp = this.cooldowns.get(k.hash);
      const notExcluded = !excludedHashes.has(k.hash);
      return (!exp || exp <= now) && notExcluded;
    });

    if (available.length === 0) return null;

    // Default to strict round-robin if weighting logic fails or every key is broke
    const fallbackRobin = () => {
      const key = available[this.index % available.length];
      this.index = (this.index + 1) % available.length;
      return key;
    };

    const warnSelectionFallback = (err) => {
      const warningNow = Date.now();
      if (warningNow - this._lastSelectionFallbackWarningAt < SELECTION_FALLBACK_LOG_WINDOW_MS) return;
      logger.warn(`[POOL] Weighted key selection failed for ${available.length} available key(s); using round-robin fallback: ${err?.message || err}`);
      this._lastSelectionFallbackWarningAt = warningNow;
    };

    // ── Weighted Selection ──
    try {
      // Map each key to a weight (min weight of 0.1 to avoid $0 keys starving completely)
      let totalWeight = 0;
      const weights = available.map(k => {
        // If a key has no limit, treat it as very healthy (e.g. $50 default weight)
        let weight = k.limitRemaining === null ? 50.0 : Math.max(0.1, Number(k.limitRemaining));
        if (!Number.isFinite(weight)) {
          throw new Error(`invalid limitRemaining for key ${String(k.hash || '').slice(0, 8) || 'unknown'}`);
        }
        totalWeight += weight;
        return { key: k, weight };
      });

      if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
        throw new Error(`invalid total selection weight ${totalWeight}`);
      }

      let random = Math.random() * totalWeight;
      for (const item of weights) {
        if (random < item.weight) return item.key;
        random -= item.weight;
      }
    } catch (err) {
      warnSelectionFallback(err);
    }

    return fallbackRobin();
  }

  /** Apply a temporary cooldown to a key after a failed upstream request */
  applyCooldown(hash, httpStatus, durationMs) {
    const fallback = httpStatus === 402 ? COOLDOWN_402 : COOLDOWN_429;
    const duration = typeof durationMs === 'number' && durationMs > 0 ? durationMs : fallback;
    this.cooldowns.set(hash, Date.now() + duration);
    const label = httpStatus === 402 ? 'credit-depleted' : 'rate-limited';
    logger.warn(`[POOL] Key ${hash.slice(0, 8)}… ${label} → cooling for ${duration / 1000}s`);
  }

  /** Cool every key in the pool — used when OR signals an IP-level rate limit */
  coolAllKeys(durationMs = COOLDOWN_429) {
    const exp = Date.now() + durationMs;
    for (const k of this.pool) {
      this.cooldowns.set(k.hash, exp);
    }
    logger.warn(`[POOL] IP-level rate limit — cooling all ${this.pool.length} keys for ${durationMs / 1000}s`);
  }

  /**
   * Record a failure for a key. After MAX_RETRIES consecutive failures,
   * the key is dropped from the pool.
   * @returns {Promise<boolean>} true if key was dropped
   */
  async recordFailure(hash, httpStatus, cooldownDurationMs) {
    const current = (this.failureCounts.get(hash) || 0) + 1;
    this.failureCounts.set(hash, current);
    
    logger.warn(`[POOL] Key ${hash.slice(0, 8)}… failure #${current}/${MAX_RETRIES} (status ${httpStatus})`);
    
    // Apply cooldown for 429/402
    if (httpStatus === 429 || httpStatus === 402) {
      this.applyCooldown(hash, httpStatus, cooldownDurationMs);
    }
    
    // Drop key after max retries
    if (current >= MAX_RETRIES) {
      await this.dropFromPool(hash, `exceeded ${MAX_RETRIES} consecutive failures`);
      return true;
    }
    
    return false;
  }

  /**
   * Record a login attempt for an account. After MAX_LOGIN_ATTEMPTS,
   * further login attempts are blocked to prevent account lockout.
   * @param {string} accountId
   * @returns {{allowed: boolean, remaining: number, cooldown?: number}} 
   */
  recordLoginAttempt(accountId) {
    const now = Date.now();
    const record = this.loginAttempts.get(accountId) || { count: 0, lastAttempt: 0 };
    
    // Reset counter if last attempt was > 1 hour ago
    if (now - record.lastAttempt > 60 * 60 * 1000) {
      record.count = 0;
    }
    
    record.count += 1;
    record.lastAttempt = now;
    this.loginAttempts.set(accountId, record);
    
    const remaining = Math.max(0, MAX_LOGIN_ATTEMPTS - record.count);
    const allowed = record.count <= MAX_LOGIN_ATTEMPTS;
    
    if (!allowed) {
      logger.error(`[LOGIN] Account ${accountId.slice(0, 8)}… BLOCKED after ${MAX_LOGIN_ATTEMPTS} login attempts (preventing lockout)`);
    } else {
      logger.info(`[LOGIN] Account ${accountId.slice(0, 8)}… login attempt ${record.count}/${MAX_LOGIN_ATTEMPTS}`);
    }
    
    return {
      allowed,
      remaining,
      cooldown: !allowed ? 60 * 60 * 1000 : null // Suggest 1 hour cooldown
    };
  }

  /**
   * Reset login attempts for an account (called on successful login).
   * @param {string} accountId
   */
  resetLoginAttempts(accountId) {
    if (this.loginAttempts.has(accountId)) {
      this.loginAttempts.delete(accountId);
      logger.info(`[LOGIN] Account ${accountId.slice(0, 8)}… login attempts reset (successful login)`);
    }
  }

  /**
   * Get remaining login attempts for an account.
   * @param {string} accountId
   * @returns {number}
   */
  getRemainingLoginAttempts(accountId) {
    const record = this.loginAttempts.get(accountId);
    if (!record) return MAX_LOGIN_ATTEMPTS;
    
    // Reset if > 1 hour old
    if (Date.now() - record.lastAttempt > 60 * 60 * 1000) {
      return MAX_LOGIN_ATTEMPTS;
    }
    
    return Math.max(0, MAX_LOGIN_ATTEMPTS - record.count);
  }

  /**
   * Record a success for a key - resets failure count.
   */
  recordSuccess(hash) {
    if (this.failureCounts.has(hash)) {
      this.failureCounts.delete(hash);
    }
  }

  /**
   * Permanently drop a key from the pool (disable pooling).
   * Key stays in database but won't be used for rotation.
   */
  async dropFromPool(hash, reason) {
    try {
      // Update DB to disable pooling
      await prisma.key.update({
        where: { hash },
        data: { isPooled: false }
      });
      
      // Remove from in-memory pool
      this.pool = this.pool.filter(k => k.hash !== hash);
      this.failureCounts.delete(hash);
      this.cooldowns.delete(hash);
      
      logger.error(`[POOL] Key ${hash.slice(0, 8)}… DROPPED from pool: ${reason}`);
    } catch (e) {
      logger.error(`[POOL] Failed to drop ${hash.slice(0, 8)}: ${e.message}`);
    }
  }

  /** Permanently disable a revoked key (401) */
  async evict(hash) {
    try {
      await prisma.key.update({
        where: { hash },
        data: { disabled: true, isPooled: false }
      });
    } catch (e) {
      logger.error(`[POOL] Failed to evict ${hash.slice(0, 8)}: ${e.message}`);
    }
    this.pool = this.pool.filter(k => k.hash !== hash);
    logger.warn(`[POOL] Key ${hash.slice(0, 8)}… permanently evicted (401 revoked)`);
  }

  /** Returns live stats for the Pool Manager UI */
  getStatus() {
    const now = Date.now();
    const poolHashes = new Set(this.pool.map(k => k.hash));
    const cooledEntries = [...this.cooldowns.entries()]
      .filter(([hash, exp]) => poolHashes.has(hash) && exp > now);
    const cooledHashes = cooledEntries.map(([h]) => h);

    // Per-hash cooldown map: { [hash]: expiresAtMs }
    // Used by dashboard to render [LOCKED Xm] badges per account/key
    const cooldownMap = Object.fromEntries(cooledEntries);

    return {
      totalPooled: this.pool.length,
      activeCooldowns: cooledHashes.length,
      available: Math.max(0, this.pool.length - cooledHashes.length),
      lastSyncAt: this.lastSyncAt,
      cooldownMap,
    };
  }

  async getStatusAsync() {
    await this.ensureLoaded();
    return this.getStatus();
  }
}

export const rotationManager = new RotationManager();
