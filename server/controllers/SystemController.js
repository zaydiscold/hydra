import BaseController from './BaseController.js';
import { taskSupervisor } from '../services/task-supervisor.js';
import { rotationManager } from '../services/rotation-manager.js';
import { proxyGate } from '../services/proxy-gate.js';

class SystemController extends BaseController {
  async getTasks(req, res) {
    try {
      const active = taskSupervisor.listActive(req.user.id).map(task => taskSupervisor.serializeTask(task));
      const recent = taskSupervisor.listRecent(req.user.id);
      return this.success(res, { active, recent });
    } catch (err) {
      return this.error(res, err.message, err.status || 500, err.code || 'SYSTEM_TASKS_FAILED');
    }
  }

  async cancelTask(req, res) {
    try {
      const task = taskSupervisor.assertOwnership(req.params.taskId, req.user.id);
      await taskSupervisor.cancel(task.taskId, req.body?.reason || 'operator_cancelled');
      return this.success(res, { taskId: task.taskId, cancelled: true });
    } catch (err) {
      return this.error(res, err.message, err.status || 500, err.code || 'SYSTEM_TASK_CANCEL_FAILED');
    }
  }

  async getProxyStatus(req, res) {
    return this.success(res, { enabled: proxyGate.enabled });
  }



  async toggleProxy(req, res) {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return this.error(res, 'enabled must be a boolean', 400);
    }
    proxyGate.set(enabled);
    return this.success(res, { enabled: proxyGate.enabled });
  }

  async getHealth(req, res) {
    try {
      const pool = await rotationManager.getStatusAsync();
      return this.success(res, {
        uptime: process.uptime(),
        tasks: taskSupervisor.getHealthSnapshot(),
        pool: {
          pooled: pool.totalPooled,
          available: pool.available,
          cooldowns: pool.activeCooldowns,
        },
      });
    } catch (err) {
      return this.error(res, err.message, err.status || 500, err.code || 'SYSTEM_HEALTH_FAILED');
    }
  }
}

export default new SystemController();
