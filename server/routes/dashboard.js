import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import DashboardController from '../controllers/DashboardController.js';

const router = Router();

// Get full dashboard data — all accounts with live balance + key counts
router.get('/', requireUnlocked, DashboardController.getDashboard.bind(DashboardController));
router.post('/refresh', requireUnlocked, DashboardController.refreshDashboard.bind(DashboardController));

export default router;
