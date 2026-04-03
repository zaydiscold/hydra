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

// Manual proxy reload
router.post('/reload', requireUnlocked, PoolController.reloadPool.bind(PoolController));

// Refresh curated models list from OpenRouter
router.post('/models/refresh', requireUnlocked, PoolController.refreshModels.bind(PoolController));

// Get traffic metrics
router.get('/traffic', requireUnlocked, PoolController.getTraffic.bind(PoolController));

export default router;
