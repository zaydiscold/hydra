import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import PoolController from '../controllers/PoolController.js';

const router = Router();

// Proxy status check stays public so the Pool Manager can treat it as a simple liveness probe.
router.get('/status', PoolController.getStatus.bind(PoolController));

// Read pool data (all accounts + key statuses)
router.get('/', requireUnlocked, PoolController.getPoolData.bind(PoolController));

// Get the derived master proxy key + endpoint URL
router.get('/master-key', requireUnlocked, PoolController.getMasterKey.bind(PoolController));
router.get('/network', requireUnlocked, PoolController.getNetworkInfo.bind(PoolController));

// Toggle a single key's pooled status
router.patch('/key/:hash', requireUnlocked, PoolController.toggleKey.bind(PoolController));

// Bulk-toggle all eligible keys in an account
router.post('/account/:accountId/toggle', requireUnlocked, PoolController.toggleAccount.bind(PoolController));

// Register (save encrypted) raw key string for an existing key
router.post('/key/:hash/register', requireUnlocked, PoolController.registerKeyString.bind(PoolController));

// Auto-provision a new key for an account (creates + registers + pools in one shot)
router.post('/auto-provision/:accountId', requireUnlocked, PoolController.autoProvision.bind(PoolController));

// Sync key plaintexts from OpenRouter website (session-auth fast path, Playwright fallback)
router.post('/sync-keys/:accountId', requireUnlocked, PoolController.syncKeys.bind(PoolController));

// Key actions (disable/enable, delete) — moved from AccountDetail to Pool Manager
router.patch('/key/:hash/disable', requireUnlocked, PoolController.toggleKeyEnabled.bind(PoolController));
router.delete('/key/:hash', requireUnlocked, PoolController.deleteKey.bind(PoolController));

// Manual proxy reload
router.post('/reload', requireUnlocked, PoolController.reloadPool.bind(PoolController));

// Refresh curated models list from OpenRouter
router.post('/models/refresh', requireUnlocked, PoolController.refreshModels.bind(PoolController));

// Get traffic metrics
router.get('/traffic', requireUnlocked, PoolController.getTraffic.bind(PoolController));

// Cached model list (for client-side model picker)
router.get('/models', requireUnlocked, PoolController.getModels.bind(PoolController));

// Last sync timestamp + active key count
router.get('/sync-status', requireUnlocked, PoolController.getSyncStatus.bind(PoolController));

export default router;
