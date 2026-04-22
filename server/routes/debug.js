import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import DebugController from '../controllers/DebugController.js';

const router = Router();

// All debug routes require auth — never expose unauthenticated
router.post('/trpc-probe', requireUnlocked, DebugController.catchAsync(DebugController.trpcProbe));
router.post('/vampire-mode', requireUnlocked, DebugController.catchAsync(DebugController.vampireMode));
router.post('/cookie-ttl', requireUnlocked, DebugController.catchAsync(DebugController.cookieTtl));

export default router;
