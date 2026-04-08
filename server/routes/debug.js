import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import DebugController from '../controllers/DebugController.js';

const router = Router();

// All debug routes require auth — never expose unauthenticated
router.post('/trpc-probe', requireUnlocked, DebugController.trpcProbe.bind(DebugController));
router.post('/vampire-mode', requireUnlocked, DebugController.vampireMode.bind(DebugController));
router.post('/cookie-ttl', requireUnlocked, DebugController.cookieTtl.bind(DebugController));

export default router;
