import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import GeneratorController from '../controllers/GeneratorController.js';

const router = Router();

router.post('/start', requireUnlocked, GeneratorController.startSignup.bind(GeneratorController));
router.get('/status/:taskId', requireUnlocked, GeneratorController.getStatus.bind(GeneratorController));
router.post('/:taskId/heartbeat', requireUnlocked, GeneratorController.heartbeat.bind(GeneratorController));
router.post('/verify/:taskId', requireUnlocked, GeneratorController.verifyOtp.bind(GeneratorController));
router.delete('/:taskId', requireUnlocked, GeneratorController.cleanupJob.bind(GeneratorController));

export default router;
