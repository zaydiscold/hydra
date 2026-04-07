import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import { AccountController } from '../controllers/AccountController.js';

const router = Router();
const controller = new AccountController();

// Use .bind(controller) to preserve 'this' context if needed, or stick to arrow functions
router.get('/', requireUnlocked, (req, res) => controller.getAccounts(req, res));
router.post('/', requireUnlocked, (req, res) => controller.addAccount(req, res));
router.post('/with-credentials', requireUnlocked, (req, res) => controller.addAccountWithCredentials(req, res));
router.post('/bulk', requireUnlocked, (req, res) => controller.bulkAdd(req, res));
router.post('/bulk-otp-stubs', requireUnlocked, (req, res) => controller.bulkOtpStubs(req, res));

router.post('/:id/detect-auth', requireUnlocked, (req, res) => controller.detectAuth(req, res));
router.post('/:id/login', requireUnlocked, (req, res) => controller.login(req, res));
router.post('/:id/otp/start', requireUnlocked, (req, res) => controller.startOTP(req, res));
router.post('/:id/otp/verify', requireUnlocked, (req, res) => controller.verifyOTP(req, res));

router.post('/:id/provision', requireUnlocked, (req, res) => controller.provision(req, res));
router.post('/provision-all', requireUnlocked, (req, res) => controller.provisionAll(req, res));

router.post('/:id/refresh', requireUnlocked, (req, res) => controller.refresh(req, res));
router.get('/:id/session-status', requireUnlocked, (req, res) => controller.getSessionStatus(req, res));

router.patch('/:id', requireUnlocked, (req, res) => controller.updateAccount(req, res));
router.delete('/:id', requireUnlocked, (req, res) => controller.deleteAccount(req, res));
router.get('/:id/snapshot', requireUnlocked, (req, res) => controller.getSnapshot(req, res));
router.get('/:id/management-key', requireUnlocked, (req, res) => controller.getManagementKey(req, res));

// New management key storage endpoints
router.get('/:id/management-keys', requireUnlocked, (req, res) => controller.listManagementKeys(req, res));
router.post('/:id/management-keys/store', requireUnlocked, (req, res) => controller.storeProvisionedKey(req, res));
router.get('/:id/management-keys/best', requireUnlocked, (req, res) => controller.getBestManagementKey(req, res));
router.delete('/:id/management-keys/:keyId', requireUnlocked, (req, res) => controller.deleteManagementKey(req, res));

router.get('/:id/balance', requireUnlocked, (req, res) => controller.getBalance(req, res));

export default router;
