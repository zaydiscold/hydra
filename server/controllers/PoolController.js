import BaseController from './BaseController.js';
import { networkInterfaces } from 'node:os';
import * as store from '../services/store.js';
import * as modelCatalog from '../services/model-cache.js';
import * as openrouter from '../services/openrouter.js';
import { rotationManager } from '../services/rotation-manager.js';
import { assertManagementKey, assertStandardKey } from '../services/key-utils.js';

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

          // Fetch live key list from OpenRouter (always array from openrouter.listKeys; guard for safety)
          const liveKeysRaw = await openrouter.listKeys(account.managementKey);
          const liveKeys = Array.isArray(liveKeysRaw) ? liveKeysRaw : [];

          // Sync metadata to local DB (upsert without overwriting key strings)
          await store.syncKeysFromOpenRouter(req.user.id, account.id, liveKeys);

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
      const port = process.env.PORT || 3001;
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
      const port = process.env.PORT || 3001;

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

      const validatedKey = await orTest.json().catch(() => null);
      const validatedHash = this.extractValidatedKeyHash(validatedKey);
      if (validatedHash && validatedHash !== hash) {
        return this.error(res, 'Pasted key does not match the selected key hash.', 400);
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
    const status = await rotationManager.getStatusAsync();
    return res.json({
      proxy: 'online',
      pooled: status.totalPooled,
      available: status.available,
      cooldowns: status.activeCooldowns,
      uptime: Math.floor(process.uptime()),
    });
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
      // Fetch latest 100 requests for the log table
      const logs = await prisma.requestLog.findMany({
        take: 100,
        orderBy: { createdAt: 'desc' },
        include: {
          key: { select: { name: true, account: { select: { alias: true } } } }
        }
      });
      
      // Calculate basic stats for the last 24h
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const metrics = await prisma.requestLog.groupBy({
        by: ['status'],
        where: { createdAt: { gte: oneDayAgo } },
        _count: { id: true }
      });

      return this.success(res, { logs, metrics });
    } catch (err) {
      return this.error(res, err.message);
    }
  }
}

export default new PoolController();
