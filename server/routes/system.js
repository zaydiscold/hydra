import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import SystemController from '../controllers/SystemController.js';
import BaseController from '../controllers/BaseController.js';

const router = Router();

router.get('/tasks', requireUnlocked, BaseController.catchAsync(SystemController.getTasks.bind(SystemController)));
router.post('/tasks/:taskId/cancel', requireUnlocked, BaseController.catchAsync(SystemController.cancelTask.bind(SystemController)));
router.get('/health', requireUnlocked, BaseController.catchAsync(SystemController.getHealth.bind(SystemController)));

// Proxy kill switch
router.get('/proxy-status', requireUnlocked, BaseController.catchAsync(SystemController.getProxyStatus.bind(SystemController)));
router.post('/proxy-toggle', requireUnlocked, BaseController.catchAsync(SystemController.toggleProxy.bind(SystemController)));
router.get('/account-proxies', requireUnlocked, BaseController.catchAsync(SystemController.getAccountProxies.bind(SystemController)));
router.post('/account-proxies', requireUnlocked, BaseController.catchAsync(SystemController.setAccountProxies.bind(SystemController)));

export default router;
