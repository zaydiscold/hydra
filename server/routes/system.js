import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import SystemController from '../controllers/SystemController.js';

const router = Router();

router.get('/tasks', requireUnlocked, SystemController.getTasks.bind(SystemController));
router.post('/tasks/:taskId/cancel', requireUnlocked, SystemController.cancelTask.bind(SystemController));
router.get('/health', requireUnlocked, SystemController.getHealth.bind(SystemController));

export default router;
