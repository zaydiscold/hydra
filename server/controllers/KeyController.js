import BaseController from './BaseController.js';
import * as store from '../services/store.js';
import * as openrouter from '../services/openrouter.js';
import { assertManagementKey } from '../services/key-utils.js';
import { z } from 'zod';

const createKeySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  limit: z.number().optional(),
  limitReset: z.string().optional(),
  includeByokInLimit: z.boolean().optional(),
  expiresAt: z.string().optional(),
});

const updateKeySchema = z.object({
  name: z.string().optional(),
  disabled: z.boolean().optional(),
  limit: z.number().optional(),
  limitReset: z.string().optional(),
  includeByokInLimit: z.boolean().optional(),
});

class KeyController extends BaseController {
  async listKeys(req, res) {
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.accountId);
      try {
        assertManagementKey(account.managementKey, 'list keys');
      } catch (err) {
        return this.error(res, err.message, 400);
      }
      const liveKeysRaw = await openrouter.listKeys(account.managementKey);
      const liveKeys = Array.isArray(liveKeysRaw) ? liveKeysRaw : [];
      const localKeys = await store.getLocalKeys(req.user.id, account.id);
      const localMap = new Map(localKeys.map((k) => [k.hash, k]));

      const merged = liveKeys.map((k) => {
        const local = localMap.get(k.hash);
        const plain = typeof local?.key === 'string' && local.key.length > 0 ? local.key : null;
        return {
          ...k,
          hasKeyString: !!plain,
          plaintextKey: plain,
        };
      });
      return this.success(res, merged);
    } catch (err) {
      const status = err.message === 'Account not found' ? 404 : 500;
      return this.error(res, err.message, status);
    }
  }

  async createKey(req, res) {
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.accountId);
      try {
        assertManagementKey(account.managementKey, 'create key');
      } catch (err) {
        return this.error(res, err.message, 400);
      }
      const data = this.validate(req.body, createKeySchema);
      const result = await openrouter.createKey(account.managementKey, data);
      
      // SAVE TO LOCAL VAULT (ENCRYPTED)
      await store.saveKey(req.user.id, account.id, {
        hash: result.data.hash,
        name: result.data.name,
        key: result.key, // The raw key string from OpenRouter
        limit: result.data.limit,
        isProvisioningKey: result.data.is_provisioning_key
      });

      return this.success(res, { data: result.data, key: result.key }, 201);
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  async updateKey(req, res) {
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.accountId);
      try {
        assertManagementKey(account.managementKey, 'update key');
      } catch (err) {
        return this.error(res, err.message, 400);
      }
      const data = this.validate(req.body, updateKeySchema);
      const result = await openrouter.updateKey(account.managementKey, req.params.hash, data);
      return this.success(res, result);
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  async deleteKey(req, res) {
    try {
      const account = await store.getAccountWithKey(req.user.id, req.params.accountId);
      try {
        assertManagementKey(account.managementKey, 'delete key');
      } catch (err) {
        return this.error(res, err.message, 400);
      }
      await openrouter.deleteKey(account.managementKey, req.params.hash);
      return this.success(res, { deleted: true });
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  // --- Pool Management ---

  async listPooledKeys(req, res) {
    try {
      const keys = await store.getPooledKeys(req.user.id);
      return this.success(res, keys);
    } catch (err) {
      return this.error(res, err.message);
    }
  }

  async togglePooledStatus(req, res) {
    try {
      const { hash } = req.params;
      const { isPooled } = req.body;
      const updated = await store.updateKeyPooledStatus(req.user.id, hash, isPooled);
      return this.success(res, updated);
    } catch (err) {
      return this.error(res, err.message);
    }
  }
}

export default new KeyController();
