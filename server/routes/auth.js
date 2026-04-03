import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import AuthController from '../controllers/AuthController.js';

const router = Router();

// Status: tells frontend whether to show setup or login screen
router.get('/status', AuthController.getStatus.bind(AuthController));

// First-time setup: create password
router.post('/setup', AuthController.setup.bind(AuthController));

// Login
router.post('/login', AuthController.login.bind(AuthController));

// Nuclear Reset (Wipe Database)
router.post('/nuke', AuthController.nuke.bind(AuthController));

// Logout (Stateless JWTs mean frontend just deletes token)
router.post('/logout', requireUnlocked, AuthController.logout.bind(AuthController));

// Change password (requires current session)
router.post('/change-password', requireUnlocked, AuthController.changePassword.bind(AuthController));

export default router;
