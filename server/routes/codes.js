import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import { highCostRouteLimiter } from '../middleware/rate-limiters.js';
import CodeController from '../controllers/CodeController.js';

const router = Router();

// POST /api/codes/redeem — redeem on one account
router.post('/redeem', requireUnlocked, highCostRouteLimiter, CodeController.redeem.bind(CodeController));

// POST /api/codes/bulk — redeem one code across multiple accounts
router.post('/bulk', requireUnlocked, highCostRouteLimiter, CodeController.bulkRedeem.bind(CodeController));

// POST /api/codes/bulk-matrix — redeem multiple codes across multiple accounts
router.post('/bulk-matrix', requireUnlocked, highCostRouteLimiter, CodeController.bulkMatrix.bind(CodeController));

// POST /api/codes/preflight — check selected accounts can obtain a dashboard session for redeem
router.post('/preflight', requireUnlocked, highCostRouteLimiter, CodeController.preflight.bind(CodeController));

// GET /api/codes/history — P16 redemption history log
router.get('/history', requireUnlocked, CodeController.getHistory.bind(CodeController));

// GET /api/codes/endpoints — show what tRPC endpoints have been discovered
router.get('/endpoints', requireUnlocked, CodeController.getEndpoints.bind(CodeController));

export default router;
