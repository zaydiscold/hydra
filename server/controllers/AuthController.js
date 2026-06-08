import { z } from 'zod';

import BaseController from './BaseController.js';
import * as auth from '../services/auth.js';
import { clearAuthTokenCookie, setAuthTokenCookie, validateRequestAuth } from '../middleware/auth.js';

const setupSchema = z.object({
  password: z.string().min(1, 'Password must be at least 1 character'),
});

const loginSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

const nukeSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  confirm: z.literal('NUKE_HYDRA'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(1, 'New password must be at least 1 character'),
});

const disableAuthSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
});

const enableAuthSchema = z.object({
  newPassword: z.string().min(1, 'New password must be at least 1 character'),
});

class AuthController extends BaseController {
  async getStatus(req, res) {
    const {
      setup,
      error,
      hasUser = false,
      hasAccounts = false,
      authDisabled = false,
      needsFirstAccount = false,
      bootstrapRequired = false,
    } = await auth.getSetupStatus();
    const authenticated = !!(await validateRequestAuth(req));
    const needsRestart = auth.isRestartRequired();

    return this.success(res, {
      setup,
      authenticated,
      error: error || null,
      needsRestart,
      hasUser,
      hasAccounts,
      authDisabled,
      needsFirstAccount,
      bootstrapRequired,
    });
  }

  async nuke(req, res) {
    try {
      const { password } = this.validate(req.body, nukeSchema);
      await auth.login(password);
      const result = await auth.nukeSystem();
      clearAuthTokenCookie(res);
      return this.success(res, {
        success: true,
        message: 'System wiped successfully. Restart Hydra once to regenerate local secrets before creating new data.',
        ...result,
      });
    } catch (err) {
      const status = err.name === 'ZodError' ? 400 : 401;
      return this.error(res, err.message, status);
    }
  }

  async setup(req, res) {
    try {
      const { password } = this.validate(req.body, setupSchema);
      const token = await auth.signup(password);
      setAuthTokenCookie(res, token);
      return this.success(res, { token });
    } catch (err) {
      return this.error(res, err.message, 400);
    }
  }

  async login(req, res) {
    const { rotationManager } = await import('../services/rotation-manager.js');
    
    // Use IP-based tracking for admin login attempts
    const clientId = req.socket?.remoteAddress || req.connection?.remoteAddress || 'admin';
    const loginCheck = rotationManager.recordLoginAttempt(`admin:${clientId}`);
    
    if (!loginCheck.allowed) {
      return this.error(
        res,
        `Too many failed login attempts. Please wait ${Math.ceil(loginCheck.cooldown / 60000)} minutes.`,
        429,
        'LOGIN_RATE_LIMITED'
      );
    }
    
    try {
      const { password } = this.validate(req.body, loginSchema);
      const token = await auth.login(password);
      setAuthTokenCookie(res, token);
      
      // Success - reset login attempts
      rotationManager.resetLoginAttempts(`admin:${clientId}`);
      
      return this.success(res, { token });
    } catch (err) {
      return this.error(res, err.message, 401);
    }
  }

  async logout(req, res) {
    clearAuthTokenCookie(res);
    return this.success(res, { success: true });
  }

  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = this.validate(req.body, changePasswordSchema);
      await auth.changePassword(req.user.id, currentPassword, newPassword);
      clearAuthTokenCookie(res);
      return this.success(res, { success: true, message: 'Password changed. Please log in again.' });
    } catch (err) {
      return this.error(res, err.message, 400);
    }
  }

  // Turn OFF password protection. Requires the current password; afterwards the
  // dashboard opens without a login (the /v1 proxy sk- key still applies).
  async disableProtection(req, res) {
    try {
      const { currentPassword } = this.validate(req.body, disableAuthSchema);
      await auth.disableAuth(currentPassword);
      clearAuthTokenCookie(res);
      return this.success(res, { success: true, authDisabled: true, message: 'Password protection disabled.' });
    } catch (err) {
      return this.error(res, err.message, 400);
    }
  }

  // Turn password protection back ON by creating a brand-new password (no reuse
  // of the disabled one — prevents lockout). Reachable while disabled via the
  // bypass identity, or while logged in.
  async enableProtection(req, res) {
    try {
      const { newPassword } = this.validate(req.body, enableAuthSchema);
      await auth.enableAuth(newPassword);
      clearAuthTokenCookie(res);
      return this.success(res, { success: true, authDisabled: false, message: 'Password protection enabled. Please log in.' });
    } catch (err) {
      return this.error(res, err.message, 400);
    }
  }
}

export default new AuthController();
