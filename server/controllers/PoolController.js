import BaseController from './BaseController.js';
import { networkInterfaces } from 'node:os';
import * as store from '../services/store.js';
import * as modelCatalog from '../services/model-cache.js';
import * as openrouter from '../services/openrouter.js';
import { syncApiKeys } from '../services/dashboard-api.js';
import { rotationManager } from '../services/rotation-manager.js';
import { assertManagementKey, assertStandardKey } from '../services/key-utils.js';
import { rotateProxySecret } from '../services/local-secrets.js';
import { logger } from '../services/logger.js';

// Cache OpenRouter listKeys results per account — 2 min TTL.
// Pool Manager hits this on every page load; no need to hammer OR on every visit.
const _liveKeysCache = new Map(); // accountId → { keys, expiresAt }
const LIVE_KEYS_TTL_MS = 2 * 60 * 1000;

function getCachedLiveKeys(accountId) {
  const entry = _liveKeysCache.get(accountId);
  if (!entry || Date.now() > entry.expiresAt) { _liveKeysCache.delete(accountId); return null; }
  return entry.keys;
}

function setCachedLiveKeys(accountId, keys) {
  _liveKeysCache.set(accountId, { keys, expiresAt: Date.now() + LIVE_KEYS_TTL_MS });
}

function getRequestPort(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const match = host.match(/:(\d+)$/);
  return match?.[1] || process.env.PORT || 3001;
}

class PoolController extends BaseController {
  extractValidatedKeyHash(payload) {
    return payload?.data?.hash
      ?? payload?.data?.key?.hash
      ?? payload?.key?.hash
      ?? payload?.hash
      ?? null;
  }

  /**
   * GET /api/pool
   * Returns all accounts with their keys merged with local DB pool status.
   * Also syncs key metadata from OpenRouter to local DB so new keys show up.
   */
  async getPoolData(req, res) {
    try {
      const allAccounts = await store.getAllAccountsWithKeys(req.user.id);

      const accountResults = await Promise.allSettled(
        allAccounts.map(async (account) => {
          if (!account.managementKey) {
            return {
              id: account.id,
              alias: account.alias,
              email: account.email,
              keys: [],
              error: 'No management key — provision one first',
            };
          }
          try {
            assertManagementKey(account.managementKey, 'pool sync');
          } catch (err) {
            return {
              id: account.id,
              alias: account.alias,
              email: account.email,
              keys: [],
              error: err.message,
            };
          }

          // Fetch live key list from OpenRouter — cached 2 min to avoid hammering OR on every page load.
          let liveKeys = getCachedLiveKeys(account.id);
          if (!liveKeys) {
            const liveKeysRaw = await openrouter.listKeys(account.managementKey);
            liveKeys = Array.isArray(liveKeysRaw) ? liveKeysRaw : [];
            setCachedLiveKeys(account.id, liveKeys);
            // Sync metadata to DB only on cache miss (live fetch)
            await store.syncKeysFromOpenRouter(req.user.id, account.id, liveKeys);
          }

          // Get local DB records to merge isPooled + hasKeyString
          const localKeys = await store.getLocalKeys(req.user.id, account.id);
          const localMap = new Map(localKeys.map((k) => [k.hash, k]));

          const enrichedKeys = liveKeys.map((k) => {
            const local = localMap.get(k.hash);
            return {
              hash: k.hash,
              name: k.name || k.label || 'Unnamed',
              enabled: !k.disabled,
              usage: k.usage_including_upstream ?? 0,
              limit: k.limit ?? null,
              limitRemaining: k.limit_remaining ?? null,
              isProvisioningKey: k.is_provisioning_key ?? false,
              isPooled: local?.isPooled ?? false,
              hasKeyString: !!local?.key,  // true only if we have the raw encrypted key
              plaintextKey: typeof local?.key === 'string' && local.key.length > 0 ? local.key : null, // local-mode explicit reveal
            };
          });

          return {
            id: account.id,
            alias: account.alias,
            email: account.email ?? null,
            keys: enrichedKeys,
            error: null,
          };
        })
      );

      const accounts = accountResults.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return {
          id: allAccounts[i].id,
          alias: allAccounts[i].alias,
          email: allAccounts[i].email ?? null,
          keys: [],
          error: r.reason?.message ?? 'Unknown error',
        };
      });

      const allKeys = accounts.flatMap(a => a.keys);
      const poolStats = {
        totalKeys: allKeys.length,
        pooledCount: allKeys.filter(k => k.isPooled).length,
        poolReadyCount: allKeys.filter(k => k.isPooled && k.hasKeyString).length,
        missingStringCount: allKeys.filter(k => k.isPooled && !k.hasKeyString).length,
        ...rotationManager.getStatus(),
      };

      const modelCacheMeta = await modelCatalog.getModelCacheSummary();

      return this.success(res, { accounts, poolStats, modelCache: modelCacheMeta });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  /**
   * GET /api/pool/master-key
   * Returns the derived master key and endpoint URL for use in external apps.
   */
  async getMasterKey(req, res) {
    try {
      const masterKey = store.getMasterProxyKey();
      const port = getRequestPort(req);
      return this.success(res, {
        masterKey,
        endpoint: `http://localhost:${port}/v1`,
        baseUrl: `http://localhost:${port}`,
      });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  async getNetworkInfo(req, res) {
    try {
      const nets = networkInterfaces();
      const ips = new Set();
      const port = getRequestPort(req);

      for (const iface of Object.values(nets)) {
        for (const net of iface || []) {
          if (!net) continue;
          if (net.family !== 'IPv4' || net.internal) continue;
          if (net.address.startsWith('169.254.')) continue;
          ips.add(net.address);
        }
      }

      const lanIps = [...ips];
      const lanUrls = lanIps.map((ip) => `http://${ip}:${port}/v1`);

      return this.success(res, {
        lanIps,
        lanUrls,
        fallbackUrl: `http://localhost:${port}/v1`,
      });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  /**
   * PATCH /api/pool/key/:hash
   * Toggle isPooled on a single key.
   */
  async toggleKey(req, res) {
    try {
      const { hash } = req.params;
      const { isPooled } = req.body;
      if (typeof isPooled !== 'boolean') {
        return this.error(res, 'isPooled must be a boolean', 400);
      }
      const updated = await store.updateKeyPooledStatus(req.user.id, hash, isPooled);
      await rotationManager.reload();
      return this.success(res, { hash: updated.hash, isPooled: updated.isPooled });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  /**
   * POST /api/pool/account/:accountId/toggle
   * Bulk toggle all keys with a stored key string in an account.
   */
  async toggleAccount(req, res) {
    try {
      const { accountId } = req.params;
      const { isPooled } = req.body;
      if (typeof isPooled !== 'boolean') {
        return this.error(res, 'isPooled must be a boolean', 400);
      }
      const count = await store.bulkUpdateAccountPooled(req.user.id, accountId, isPooled);
      await rotationManager.reload();
      return this.success(res, { updated: count, isPooled });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  /**
   * POST /api/pool/key/:hash/register
   * Save (encrypt) a raw API key string provided by the user.
   */
  async registerKeyString(req, res) {
    try {
      const { hash } = req.params;
      const keyString = req.body?.keyString?.trim();
      if (!keyString) return this.error(res, 'keyString is required', 400);
      try {
        assertStandardKey(keyString, 'key registration');
      } catch (err) {
        return this.error(res, err.message, 400);
      }

      // Validate the pasted key and make sure it matches the target record.
      const orTest = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { 'Authorization': `Bearer ${keyString}` }
      });
      if (!orTest.ok) {
        return this.error(res, 'Invalid OpenRouter key. Connection refused or key revoked.', 400);
      }

      let validatedKey;
      try {
        validatedKey = await orTest.json();
      } catch (err) {
        logger.warn(`[POOL] OpenRouter key validation returned invalid JSON for hash=${hash}: ${err?.message || err}`);
        return this.error(res, 'OpenRouter key validation returned an invalid response. Try again before pooling this key.', 502);
      }
      const validatedHash = this.extractValidatedKeyHash(validatedKey);
      if (validatedHash && validatedHash !== hash) {
        return this.error(res, 'Pasted key does not match the selected key hash.', 400);
      }
      if (!validatedHash) {
        logger.warn(`[POOL] OpenRouter key validation response did not include a hash for selected hash=${hash}`);
      }

      await store.registerKeyString(req.user.id, hash, keyString);
      await rotationManager.reload();
      return this.success(res, { registered: true, hash });
    } catch (err) {
      return this.error(res, err.message, err.message.includes('Invalid key') ? 400 : 500);
    }
  }

  // --- NEW-2: Proxy Status Check ---
  async getStatus(req, res) {
    let pooled = 0, available = 0, cooldowns = 0;
    try {
      const status = await rotationManager.getStatusAsync();
      pooled = status.totalPooled;
      available = status.available;
      cooldowns = status.activeCooldowns;
    } catch (err) {
      // Pool not loaded yet or DB hiccup — still return online so UI buttons don't lock
      logger.warn(`[POOL] Status fallback used because rotation manager status failed: ${err.message}`);
    }
    return this.success(res, {
      proxy: 'online',
      pooled,
      available,
      cooldowns,
      uptime: Math.floor(process.uptime()),
    });
  }

  /**
   * POST /api/pool/auto-provision/:accountId
   * Creates a new sk-or-v1-* key using the account's management key,
   * stores it encrypted locally, and marks it as pooled immediately.
   */
  async autoProvision(req, res) {
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.accountId);
      try {
        assertManagementKey(account.managementKey, 'auto-provision pool key');
      } catch (err) {
        return this.error(res, err.message, 400);
      }

      const keyName = `Hydra Pool ${new Date().toISOString().slice(0, 10)}`;
      const result = await openrouter.createKey(account.managementKey, { name: keyName });

      // Save key string encrypted in DB (same as KeyController.createKey)
      await store.saveKey(req.user.id, account.id, {
        hash: result.data.hash,
        name: result.data.name,
        key: result.key,
        limit: result.data.limit,
        isProvisioningKey: result.data.is_provisioning_key,
      });

      // Auto-mark as pooled
      await store.updateKeyPooledStatus(req.user.id, result.data.hash, true);
      await rotationManager.reload();

      return this.success(res, { hash: result.data.hash, name: result.data.name, pooled: true });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  /**
   * POST /api/pool/sync-keys/:accountId
   * Tries session-auth tRPC routes for key plaintexts, falls back to Playwright scraping.
   * Stores any revealed sk-or-v1-* strings encrypted in DB.
   */
  async syncKeys(req, res) {
    try {
      const { accountId } = req.params;
      const revealed = await syncApiKeys(req.user.id, accountId);
      let synced = 0;
      for (const item of revealed) {
        if (!item.plaintextKey) continue;
        try {
          // Try to match by hash — or register by key string directly
          const hash = item.hash || item.plaintextKey;
          await store.registerKeyString(req.user.id, hash, item.plaintextKey);
          synced++;
        } catch (err) {
          logger.warn(`[POOL] Failed to register synced key material for account=${accountId}: ${err.message}`);
        }
      }
      await rotationManager.reload();
      return this.success(res, { synced, total: revealed.length, source: revealed[0]?.source ?? 'none' });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  /**
   * PATCH /api/pool/key/:hash/disable
   * Toggle the enabled/disabled state of a key on OpenRouter.
   */
  async toggleKeyEnabled(req, res) {
    try {
      const { hash } = req.params;
      const { disabled } = req.body; // boolean
      if (typeof disabled !== 'boolean') return this.error(res, 'disabled must be a boolean', 400);

      // Find the account that owns this key to get the management key
      const account = await store.getAccountOwnerOfKey(req.user.id, hash);
      if (!account) return this.error(res, 'Key not found or access denied', 404);
      assertManagementKey(account.managementKey, 'toggle key enabled');

      await openrouter.updateKey(account.managementKey, hash, { disabled });
      return this.success(res, { hash, disabled });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  /**
   * DELETE /api/pool/key/:hash
   * Delete a key from OpenRouter and remove from local DB.
   */
  async deleteKey(req, res) {
    try {
      const { hash } = req.params;
      const account = await store.getAccountOwnerOfKey(req.user.id, hash);
      if (!account) return this.error(res, 'Key not found or access denied', 404);
      assertManagementKey(account.managementKey, 'delete key');

      await openrouter.deleteKey(account.managementKey, hash);
      await store.deleteKey(req.user.id, hash);
      await rotationManager.reload();
      return this.success(res, { deleted: true, hash });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  async reloadPool(req, res) {
    try {
      await rotationManager.reload();
      const status = rotationManager.getStatus();
      return this.success(res, { reloaded: true, pooled: status.totalPooled });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  // --- NEW-3: Curated Model List Sync ---
  async refreshModels(req, res) {
    try {
      const keyEntry = await rotationManager.getNextKey();
      let apiKey = keyEntry?.keyString ?? null;
      if (!apiKey) {
        apiKey = await store.getFirstStoredApiKeyString(req.user.id);
      }
      if (!apiKey) {
        return this.error(
          res,
          'No API key available. Paste at least one OpenRouter key string, or add keys to the pool.',
          400
        );
      }

      const result = await modelCatalog.fetchOpenRouterModelsList(apiKey);
      if (!result.ok) {
        return this.error(res, 'Failed to fetch from OpenRouter', 502);
      }

      const count = await modelCatalog.upsertModelsFromUpstream(result.data);
      return this.success(res, { count });
    } catch (err) {
      return this.error(res, err.message);
    }
  }
  // --- NEW-4: Traffic Dashboard ---
  async getTraffic(req, res) {
    try {
      const { prisma } = await import('../services/db.js');
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Fetch latest 100 requests for the log table
      const [logs, metrics] = await Promise.all([
        prisma.requestLog.findMany({
          take: 100,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            keyHash: true,
            model: true,
            status: true,
            latencyMs: true,
            promptTokens: true,
            completionTokens: true,
            clientHint: true,
            createdAt: true,
            key: { select: { name: true, account: { select: { alias: true } } } },
          },
        }),
        // Calculate basic stats for the last 24h.
        prisma.requestLog.groupBy({
          by: ['status'],
          where: { createdAt: { gte: oneDayAgo } },
          _count: { id: true },
        }),
      ]);

      return this.success(res, { logs, metrics });
    } catch (err) {
      const { classifyPrismaError, formatPrismaError } = await import('../lib/prisma-error.js');
      const { logger } = await import('../services/logger.js');
      const c = classifyPrismaError(err);
      logger.error(formatPrismaError(err, 'getTraffic'));
      return this.error(res, c.summary, 500, c.code || 'DB_ERROR', {
        tag: c.tag,
        fix: c.fix,
        column: c.columnHint,
      });
    }
  }

  /** GET /pool/models — returns cached model list (id + name + ctx) */
  async getModels(req, res) {
    try {
      const { prisma } = await import('../services/db.js');
      const models = await prisma.cachedModel.findMany({
        select: { id: true, name: true, ctx: true },
        orderBy: { name: 'asc' },
      });
      return this.success(res, { models, count: models.length });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  /** GET /pool/sync-status — last pool sync timestamp and key count */
  async getSyncStatus(req, res) {
    try {
      const stats = rotationManager.getStatus();
      return this.success(res, {
        lastSync: stats.lastSyncAt ?? null,
        activeKeys: stats.totalPooled ?? 0,
        cooldownMap: stats.cooldownMap ?? {},
      });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  /**
   * POST /api/pool/rotate-master-key
   * Regenerate the proxySecret that drives sk-hydra-* and sk-proj-* keys.
   * Takes effect immediately — no restart required.
   */
  async rotateMasterKey(req, res) {
    try {
      rotateProxySecret();
      const newMasterKey = store.getMasterProxyKey();
      const port = getRequestPort(req);
      return this.success(res, {
        masterKey: newMasterKey,
        endpoint: `http://localhost:${port}/v1`,
      });
    } catch (err) {
      return this.error(res, err.message);
    }
  }
}

export default new PoolController();
