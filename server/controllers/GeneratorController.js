import BaseController from './BaseController.js';
import * as generator from '../services/account-generator.js';
import { z } from 'zod';
import { logger } from '../services/logger.js';

const startSignupSchema = z.object({
  emailTemplate: z.string().min(1, 'emailTemplate is required'),
  password: z.string().optional(),
  count: z.number().int().positive().max(1).optional(),
});

const verifyOtpSchema = z.object({
  otp: z.string().min(1, 'otp is required'),
});

class GeneratorController extends BaseController {
  async startSignup(req, res) {
    try {
      const { emailTemplate, password } = this.validate(req.body, startSignupSchema);
      const job = await generator.startSignupJob(req.user.id, emailTemplate, emailTemplate, password || 'HydraGen2026!');
      return this.success(res, job);
    } catch (err) {
      const status = err.status || (err.code === 'TASK_BUSY' ? 409 : 500);
      return this.error(res, err.message, status, err.code || 'GENERATOR_START_FAILED');
    }
  }

  async getStatus(req, res) {
    try {
      const job = generator.getSignupJob(req.params.taskId, req.user.id);
      if (!job) return this.error(res, 'Job not found', 404, 'TASK_NOT_FOUND');
      return this.success(res, job);
    } catch (err) {
      return this.error(res, err.message, err.status || 500, err.code || 'GENERATOR_STATUS_FAILED');
    }
  }

  async heartbeat(req, res) {
    try {
      const job = generator.heartbeatJob(req.params.taskId, req.user.id);
      return this.success(res, job);
    } catch (err) {
      return this.error(res, err.message, err.status || 500, err.code || 'GENERATOR_HEARTBEAT_FAILED');
    }
  }

  async verifyOtp(req, res) {
    try {
      const { otp } = this.validate(req.body, verifyOtpSchema);
      const result = await generator.submitOtpForJob(req.params.taskId, req.user.id, otp);
      return this.success(res, result);
    } catch (err) {
      return this.error(res, err.message, err.status || 400, err.code || 'GENERATOR_VERIFY_FAILED');
    }
  }

  async cleanupJob(req, res) {
    try {
      const reason = req.body?.reason || 'cancelled';
      const result = await generator.cleanupJob(req.params.taskId, req.user.id, reason);
      return this.success(res, result);
    } catch (err) {
      logger.warn(`[GENERATOR] Cleanup failed for ${req.params.taskId}: ${err.message}`);
      return this.error(res, err.message, err.status || 500, err.code || 'GENERATOR_CLEANUP_FAILED');
    }
  }
}

export default new GeneratorController();
