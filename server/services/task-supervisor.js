import crypto from 'node:crypto';
import { logger } from './logger.js';

const TASK_HISTORY_LIMIT = 25;
const TASK_SWEEP_INTERVAL_MS = 5 * 1000;
const SHUTDOWN_TIMEOUT_MS = 5 * 1000;
const DEFAULT_GENERATOR_TTL_MS = 2 * 60 * 1000;
const DEFAULT_BATCH_TTL_MS = 30 * 60 * 1000;
const BATCH_CONCURRENCY = 2;

const TASK_CONFIG = {
  generator_job: {
    interactive: true,
    ttlMs: DEFAULT_GENERATOR_TTL_MS,
    maxConcurrent: 1,
    queue: false,
  },
  batch_account_work: {
    interactive: false,
    ttlMs: DEFAULT_BATCH_TTL_MS,
    maxConcurrent: BATCH_CONCURRENCY,
    queue: true,
  },
  batch_code_work: {
    interactive: false,
    ttlMs: DEFAULT_BATCH_TTL_MS,
    maxConcurrent: BATCH_CONCURRENCY,
    queue: true,
  },
  proxy_request: {
    interactive: false,
    ttlMs: 30 * 1000,
    maxConcurrent: Infinity,
    queue: false,
  },
};

function withErrorCode(message, code, status = 409) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

export class TaskSupervisor {
  constructor() {
    this.tasks = new Map();
    this.recentTasks = [];
    this.batchQueue = [];
    this.activeBatchCount = 0;
    this.draining = false;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.expireTasks().catch((err) => {
        this.reportBackgroundError('task expiry sweep', err);
      });
    }, TASK_SWEEP_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  ensureAcceptingWork() {
    if (this.draining) {
      throw withErrorCode('Hydra is shutting down and not accepting new work.', 'TASK_DRAINING', 503);
    }
  }

  getConfig(type) {
    return TASK_CONFIG[type] ?? {
      interactive: false,
      ttlMs: DEFAULT_BATCH_TTL_MS,
      maxConcurrent: Infinity,
      queue: false,
    };
  }

  register(taskSpec) {
    this.ensureAcceptingWork();

    const config = this.getConfig(taskSpec.type);
    const taskId = taskSpec.taskId ?? crypto.randomUUID();
    const now = Date.now();
    const task = {
      taskId,
      type: taskSpec.type,
      ownerUserId: taskSpec.ownerUserId ?? null,
      status: taskSpec.status ?? 'registered',
      metadata: taskSpec.metadata ?? {},
      startedAt: taskSpec.startedAt ?? new Date(now).toISOString(),
      endedAt: null,
      ttlMs: taskSpec.ttlMs ?? config.ttlMs,
      lastHeartbeatAt: taskSpec.lastHeartbeatAt ?? new Date(now).toISOString(),
      abortController: taskSpec.abortController ?? new AbortController(),
      resources: {
        browser: null,
        context: null,
        page: null,
        timers: new Set(),
        pending: new Set(),
      },
      cleanup: taskSpec.cleanup ?? null,
      error: null,
      result: null,
      cancelReason: null,
      interactive: taskSpec.interactive ?? config.interactive,
      queueType: taskSpec.queueType ?? null,
    };

    this.tasks.set(taskId, task);
    return task;
  }

  async startInteractive(taskSpec) {
    const config = this.getConfig(taskSpec.type);
    const activeOfType = this.listActive().filter(task => task.type === taskSpec.type).length;
    if (activeOfType >= config.maxConcurrent) {
      throw withErrorCode(
        'A generator job is already running. Wait for it to finish or cancel it before starting another.',
        'TASK_BUSY',
        409,
      );
    }

    return this.register({
      ...taskSpec,
      interactive: true,
      ttlMs: taskSpec.ttlMs ?? config.ttlMs,
      status: taskSpec.status ?? 'initializing',
    });
  }

  async enqueueBatch(type, ownerUserId, run, metadata = {}) {
    this.ensureAcceptingWork();
    const config = this.getConfig(type);

    return new Promise((resolve, reject) => {
      const queued = {
        type,
        ownerUserId,
        metadata,
        run,
        resolve,
        reject,
        config,
      };

      this.batchQueue.push(queued);
      this.drainBatchQueue().catch((err) => {
        this.reportBackgroundError('batch queue drain', err);
      });
    });
  }

  async drainBatchQueue() {
    if (this.draining) return;

    while (this.activeBatchCount < BATCH_CONCURRENCY && this.batchQueue.length > 0) {
      const queued = this.batchQueue.shift();
      this.activeBatchCount += 1;

      const task = this.register({
        type: queued.type,
        ownerUserId: queued.ownerUserId,
        metadata: queued.metadata,
        ttlMs: queued.config.ttlMs,
        status: 'running',
        queueType: 'batch',
      });

      Promise.resolve()
        .then(() => queued.run(task))
        .then(async result => {
          await this.complete(task.taskId, result);
          queued.resolve(result);
        })
        .catch(async err => {
          await this.fail(task.taskId, err);
          queued.reject(err);
        })
        .finally(() => {
          this.activeBatchCount = Math.max(0, this.activeBatchCount - 1);
          this.drainBatchQueue().catch((err) => {
            this.reportBackgroundError('batch queue drain', err);
          });
        });
    }
  }

  getTask(taskId) {
    return this.tasks.get(taskId) ?? null;
  }

  listActive(ownerUserId = null) {
    return [...this.tasks.values()].filter(task => {
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired') {
        return false;
      }
      return ownerUserId ? task.ownerUserId === ownerUserId : true;
    });
  }

  listRecent(ownerUserId = null) {
    return this.recentTasks.filter(task => (ownerUserId ? task.ownerUserId === ownerUserId : true));
  }

  touch(taskId) {
    const task = this.getTask(taskId);
    if (!task) return null;
    task.lastHeartbeatAt = new Date().toISOString();
    return task;
  }

  heartbeat(taskId, ownerUserId) {
    const task = this.assertOwnership(taskId, ownerUserId);
    if (!task.interactive) {
      throw withErrorCode('Heartbeat is only supported for interactive tasks.', 'TASK_NOT_INTERACTIVE', 400);
    }
    if (this.isTerminal(task.status)) {
      throw withErrorCode('Task is no longer active.', 'TASK_NOT_ACTIVE', 409);
    }
    this.touch(taskId);
    return task;
  }

  updateTask(taskId, patch = {}) {
    const task = this.getTask(taskId);
    if (!task) return null;

    if (patch.metadata) {
      task.metadata = { ...task.metadata, ...patch.metadata };
    }

    for (const [key, value] of Object.entries(patch)) {
      if (key === 'metadata') continue;
      if (value !== undefined) task[key] = value;
    }

    task.lastHeartbeatAt = new Date().toISOString();
    return task;
  }

  attachResources(taskId, resources = {}) {
    const task = this.getTask(taskId);
    if (!task) return null;

    for (const [key, value] of Object.entries(resources)) {
      if (value === undefined) continue;
      if (key === 'timer' && value) {
        task.resources.timers.add(value);
        continue;
      }
      if (key === 'pending' && value) {
        task.resources.pending.add(value);
        continue;
      }
      task.resources[key] = value;
    }

    return task;
  }

  detachPending(taskId, pending) {
    const task = this.getTask(taskId);
    if (!task || !pending) return;
    task.resources.pending.delete(pending);
  }

  assertOwnership(taskId, ownerUserId) {
    const task = this.getTask(taskId);
    if (!task) {
      throw withErrorCode('Task not found', 'TASK_NOT_FOUND', 404);
    }
    if (ownerUserId && task.ownerUserId && task.ownerUserId !== ownerUserId) {
      throw withErrorCode('Task not found', 'TASK_NOT_FOUND', 404);
    }
    return task;
  }

  isTerminal(status) {
    return ['completed', 'failed', 'cancelled', 'expired'].includes(status);
  }

  async complete(taskId, result = null) {
    const task = this.getTask(taskId);
    if (!task || this.isTerminal(task.status)) return task;

    task.status = 'completed';
    task.result = result;
    task.endedAt = new Date().toISOString();
    await this.runCleanupSafely(task);
    this.archiveTask(task);
    return task;
  }

  async fail(taskId, error) {
    const task = this.getTask(taskId);
    if (!task || this.isTerminal(task.status)) return task;

    task.status = 'failed';
    task.error = error?.message ?? String(error);
    task.endedAt = new Date().toISOString();
    await this.runCleanupSafely(task);
    this.archiveTask(task);
    return task;
  }

  async cancel(taskId, reason = 'cancelled') {
    const task = this.getTask(taskId);
    if (!task || this.isTerminal(task.status)) return task;

    task.cancelReason = reason;
    task.status = reason === 'expired' ? 'expired' : 'cancelled';
    task.endedAt = new Date().toISOString();
    task.abortController.abort(new Error(reason));
    await this.runCleanupSafely(task);
    this.archiveTask(task);
    return task;
  }

  async expireTasks() {
    const now = Date.now();
    const activeTasks = this.listActive();

    for (const task of activeTasks) {
      if (!task.ttlMs) continue;
      const heartbeatAt = Date.parse(task.lastHeartbeatAt || task.startedAt);
      if (!Number.isFinite(heartbeatAt)) continue;
      if (now - heartbeatAt > task.ttlMs) {
        await this.cancel(task.taskId, 'expired');
      }
    }
  }

  async shutdown() {
    this.draining = true;
    this.stop();

    const queued = this.batchQueue.splice(0, this.batchQueue.length);
    for (const item of queued) {
      item.reject(withErrorCode('Task queue rejected because Hydra is shutting down.', 'TASK_DRAINING', 503));
    }

    const activeTasks = this.listActive();
    await Promise.race([
      Promise.all(activeTasks.map(task => this.cancel(task.taskId, 'shutdown'))),
      new Promise(resolve => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
    ]);
  }

  getHealthSnapshot() {
    const activeTasks = this.listActive();
    return {
      activeTasks: activeTasks.length,
      queuedTasks: this.batchQueue.length,
      generatorTasks: activeTasks.filter(task => task.type === 'generator_job').length,
      batchTasks: activeTasks.filter(task => task.queueType === 'batch').length,
      recentTasks: this.recentTasks.length,
      draining: this.draining,
    };
  }

  serializeTask(task) {
    return {
      taskId: task.taskId,
      type: task.type,
      ownerUserId: task.ownerUserId,
      status: task.status,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
      lastHeartbeatAt: task.lastHeartbeatAt,
      ttlMs: task.ttlMs,
      error: task.error,
      cancelReason: task.cancelReason,
      metadata: task.metadata,
      result: task.result,
      interactive: task.interactive,
      queueType: task.queueType,
    };
  }

  archiveTask(task) {
    this.tasks.delete(task.taskId);
    this.recentTasks.unshift(this.serializeTask(task));
    if (this.recentTasks.length > TASK_HISTORY_LIMIT) {
      this.recentTasks.length = TASK_HISTORY_LIMIT;
    }
  }

  async runCleanupSafely(task) {
    try {
      await this.runCleanup(task);
    } catch (err) {
      task.error = task.error || err.message;
      this.reportBackgroundError(`cleanup for ${task.type} ${task.taskId}`, err);
    }
  }

  reportBackgroundError(context, err) {
    logger.warn(`[TASK] ${context} failed: ${err?.message || String(err)}`);
  }

  async runCleanup(task) {
    // Clear timers first
    if (task.resources.timers.size > 0) {
      for (const timer of task.resources.timers) clearTimeout(timer);
      task.resources.timers.clear();
    }

    // #22: Close Playwright resources to prevent browser/context/page leaks.
    // Order matters: page → context → browser (child before parent).
    if (task.resources.page) {
      try { await task.resources.page.close(); }
      catch (err) { this.reportBackgroundError(`page cleanup for ${task.type} ${task.taskId}`, err); }
      task.resources.page = null;
    }
    if (task.resources.context) {
      try { await task.resources.context.close(); }
      catch (err) { this.reportBackgroundError(`context cleanup for ${task.type} ${task.taskId}`, err); }
      task.resources.context = null;
    }
    if (task.resources.browser) {
      try { await task.resources.browser.close(); }
      catch (err) { this.reportBackgroundError(`browser cleanup for ${task.type} ${task.taskId}`, err); }
      task.resources.browser = null;
    }

    // Clear pending resources (abort signals, etc.)
    if (task.resources.pending.size > 0) {
      task.resources.pending.clear();
    }

    if (typeof task.cleanup === 'function') {
      await task.cleanup(task);
    }
  }
}

export const taskSupervisor = new TaskSupervisor();
export { withErrorCode };
