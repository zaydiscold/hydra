import BaseController from "../controllers/BaseController.js";
import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import PoolController from '../controllers/PoolController.js';

const router = Router();


// Proxy status check stays public so the Pool Manager can treat it as a simple liveness probe.
router.get('/status', BaseController.catchAsync(PoolController.getStatus.bind(PoolController)));

// Read pool data (all accounts + key statuses)
router.get('/', requireUnlocked, BaseController.catchAsync(PoolController.getPoolData.bind(PoolController)));

// Get the derived master proxy key + endpoint URL
router.get('/master-key', requireUnlocked, BaseController.catchAsync(PoolController.getMasterKey.bind(PoolController)));
router.get('/network', requireUnlocked, BaseController.catchAsync(PoolController.getNetworkInfo.bind(PoolController)));

// Toggle a single key's pooled status
router.patch('/key/:hash', requireUnlocked, BaseController.catchAsync(PoolController.toggleKey.bind(PoolController)));

// Bulk-toggle all eligible keys in an account
router.post('/account/:accountId/toggle', requireUnlocked, BaseController.catchAsync(PoolController.toggleAccount.bind(PoolController)));

// Register (save encrypted) raw key string for an existing key
router.post('/key/:hash/register', requireUnlocked, BaseController.catchAsync(PoolController.registerKeyString.bind(PoolController)));

// Auto-provision a new key for an account (creates + registers + pools in one shot)
router.post('/auto-provision/:accountId', requireUnlocked, BaseController.catchAsync(PoolController.autoProvision.bind(PoolController)));

// Sync key plaintexts from OpenRouter website (session-auth fast path, Playwright fallback)
router.post('/sync-keys/:accountId', requireUnlocked, BaseController.catchAsync(PoolController.syncKeys.bind(PoolController)));

// Key actions (disable/enable, delete) — moved from AccountDetail to Pool Manager
router.patch('/key/:hash/disable', requireUnlocked, BaseController.catchAsync(PoolController.toggleKeyEnabled.bind(PoolController)));
router.delete('/key/:hash', requireUnlocked, BaseController.catchAsync(PoolController.deleteKey.bind(PoolController)));

// Manual proxy reload
router.post('/reload', requireUnlocked, BaseController.catchAsync(PoolController.reloadPool.bind(PoolController)));

// Refresh curated models list from OpenRouter
router.post('/models/refresh', requireUnlocked, BaseController.catchAsync(PoolController.refreshModels.bind(PoolController)));

// Get traffic metrics
router.get('/traffic', requireUnlocked, BaseController.catchAsync(PoolController.getTraffic.bind(PoolController)));

// Cached model list (for client-side model picker)
router.get('/models', requireUnlocked, BaseController.catchAsync(PoolController.getModels.bind(PoolController)));

// Last sync timestamp + active key count
router.get('/sync-status', requireUnlocked, BaseController.catchAsync(PoolController.getSyncStatus.bind(PoolController)));

// Rotate the master proxy key (regenerate proxySecret — takes effect immediately)
router.post('/rotate-master-key', requireUnlocked, BaseController.catchAsync(PoolController.rotateMasterKey.bind(PoolController)));

export default router;
