import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import { highCostRouteLimiter } from '../middleware/rate-limiters.js';
import { AccountController } from '../controllers/AccountController.js';

const router = Router();
const controller = new AccountController();

// Use .bind(controller) to preserve 'this' context if needed, or stick to arrow functions
router.get('/', requireUnlocked, controller.catchAsync(controller.getAccounts));
router.post('/', requireUnlocked, controller.catchAsync(controller.addAccount));
router.post('/with-credentials', requireUnlocked, controller.catchAsync(controller.addAccountWithCredentials));
router.post('/bulk', requireUnlocked, highCostRouteLimiter, controller.catchAsync(controller.bulkAdd));
router.post('/bulk-otp-stubs', requireUnlocked, highCostRouteLimiter, controller.catchAsync(controller.bulkOtpStubs));

router.post('/:id/detect-auth', requireUnlocked, highCostRouteLimiter, controller.catchAsync(controller.detectAuth));
router.post('/:id/login', requireUnlocked, highCostRouteLimiter, controller.catchAsync(controller.login));
router.post('/:id/otp/start', requireUnlocked, highCostRouteLimiter, controller.catchAsync(controller.startOTP));
router.post('/:id/otp/verify', requireUnlocked, highCostRouteLimiter, controller.catchAsync(controller.verifyOTP));

router.post('/:id/provision', requireUnlocked, highCostRouteLimiter, controller.catchAsync(controller.provision));
router.post('/provision-all', requireUnlocked, highCostRouteLimiter, controller.catchAsync(controller.provisionAll));

router.post('/:id/refresh', requireUnlocked, controller.catchAsync(controller.refresh));
router.post('/:id/refresh-login', requireUnlocked, highCostRouteLimiter, controller.catchAsync(controller.refreshAccountLogin));
router.get('/:id/session-status', requireUnlocked, controller.catchAsync(controller.getSessionStatus));
router.get('/:id/session-check', requireUnlocked, controller.catchAsync(controller.checkSession));
router.post('/:id/silent-refresh', requireUnlocked, highCostRouteLimiter, controller.catchAsync(controller.silentRefreshOnly));

router.patch('/:id', requireUnlocked, controller.catchAsync(controller.updateAccount));
router.delete('/:id', requireUnlocked, controller.catchAsync(controller.deleteAccount));
router.get('/:id/snapshot', requireUnlocked, controller.catchAsync(controller.getSnapshot));
router.get('/:id/management-key', requireUnlocked, controller.catchAsync(controller.getManagementKey));

// New management key storage endpoints
router.get('/:id/management-keys', requireUnlocked, controller.catchAsync(controller.listManagementKeys));
router.post('/:id/management-keys/store', requireUnlocked, controller.catchAsync(controller.storeProvisionedKey));
router.get('/:id/management-keys/best', requireUnlocked, controller.catchAsync(controller.getBestManagementKey));
router.delete('/:id/management-keys/:keyId', requireUnlocked, controller.catchAsync(controller.deleteManagementKey));

router.get('/:id/balance', requireUnlocked, controller.catchAsync(controller.getBalance));

// P6 — Magic link (email_link strategy)
router.post('/:id/magic-link/send', requireUnlocked, highCostRouteLimiter, controller.catchAsync(controller.sendMagicLink));
router.get('/:id/magic-link/status/:signInId', requireUnlocked, controller.catchAsync(controller.magicLinkStatus));

export default router;
