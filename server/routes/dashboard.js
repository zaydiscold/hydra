import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import DashboardController from '../controllers/DashboardController.js';

const router = Router();

// Get full dashboard data — all accounts with live balance + key counts
router.get('/', requireUnlocked, DashboardController.catchAsync(DashboardController.getDashboard));
router.post('/refresh', requireUnlocked, DashboardController.catchAsync(DashboardController.refreshDashboard));

export default router;
