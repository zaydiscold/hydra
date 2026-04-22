import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import KeyController from '../controllers/KeyController.js';
import BaseController from '../controllers/BaseController.js';
import { AccountController } from '../controllers/AccountController.js';

const router = Router();
const accountController = new AccountController();

// List keys for an account
router.get('/:accountId/keys', requireUnlocked, BaseController.catchAsync(KeyController.listKeys.bind(KeyController)));

// Create a new key
router.post('/:accountId/keys', requireUnlocked, BaseController.catchAsync(KeyController.createKey.bind(KeyController)));

// Test a key against OpenRouter /auth/key
router.post('/:id/keys/:hash/test', requireUnlocked, BaseController.catchAsync(accountController.testKey.bind(accountController)));

// Update a key
router.patch('/:accountId/keys/:hash', requireUnlocked, BaseController.catchAsync(KeyController.updateKey.bind(KeyController)));

// Delete a key
router.delete('/:accountId/keys/:hash', requireUnlocked, BaseController.catchAsync(KeyController.deleteKey.bind(KeyController)));

export default router;
