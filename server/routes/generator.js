import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import GeneratorController from '../controllers/GeneratorController.js';
import BaseController from '../controllers/BaseController.js';

const router = Router();

router.post('/start', requireUnlocked, BaseController.catchAsync(GeneratorController.startSignup.bind(GeneratorController)));
router.get('/status/:taskId', requireUnlocked, BaseController.catchAsync(GeneratorController.getStatus.bind(GeneratorController)));
router.post('/:taskId/heartbeat', requireUnlocked, BaseController.catchAsync(GeneratorController.heartbeat.bind(GeneratorController)));
router.post('/verify/:taskId', requireUnlocked, BaseController.catchAsync(GeneratorController.verifyOtp.bind(GeneratorController)));
router.delete('/:taskId', requireUnlocked, BaseController.catchAsync(GeneratorController.cleanupJob.bind(GeneratorController)));

export default router;
