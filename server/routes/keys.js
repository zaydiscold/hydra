import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import KeyController from '../controllers/KeyController.js';

const router = Router();

// List keys for an account
router.get('/:accountId/keys', requireUnlocked, KeyController.listKeys.bind(KeyController));

// Create a new key
router.post('/:accountId/keys', requireUnlocked, KeyController.createKey.bind(KeyController));

// Update a key
router.patch('/:accountId/keys/:hash', requireUnlocked, KeyController.updateKey.bind(KeyController));

// Delete a key
router.delete('/:accountId/keys/:hash', requireUnlocked, KeyController.deleteKey.bind(KeyController));

export default router;
