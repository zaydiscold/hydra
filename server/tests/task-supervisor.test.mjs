// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { readFileSync } from 'node:fs';

const warnings = [];

mock.module(new URL('../services/logger.js', import.meta.url).href, {
  exports: {
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
    default: {
      warn(message) {
        warnings.push(message);
      },
    },
  },
});

const { TaskSupervisor } = await import('../services/task-supervisor.js');

test.beforeEach(() => {
  warnings.length = 0;
});

test('task supervisor logs cleanup failures while still releasing resources', async () => {
  const supervisor = new TaskSupervisor();
  const task = supervisor.register({
    taskId: 'cleanup-failure-test',
    type: 'generator_job',
    status: 'running',
  });

  task.resources.page = {
    async close() {
      throw new Error('page already closed by browser');
    },
  };
  task.resources.context = {
    async close() {
      throw new Error('context close failed');
    },
  };
  task.resources.browser = {
    async close() {
      throw new Error('browser close failed');
    },
  };
  task.cleanup = async () => {
    throw new Error('custom cleanup failed');
  };

  const cancelled = await supervisor.cancel(task.taskId, 'test');
  const archived = supervisor.listRecent()[0];

  assert.equal(cancelled.status, 'cancelled');
  assert.equal(task.resources.page, null);
  assert.equal(task.resources.context, null);
  assert.equal(task.resources.browser, null);
  assert.equal(archived.error, 'custom cleanup failed');
  assert.match(warnings.join('\n'), /page cleanup for generator_job cleanup-failure-test failed: page already closed by browser/);
  assert.match(warnings.join('\n'), /context cleanup for generator_job cleanup-failure-test failed: context close failed/);
  assert.match(warnings.join('\n'), /browser cleanup for generator_job cleanup-failure-test failed: browser close failed/);
  assert.match(warnings.join('\n'), /cleanup for generator_job cleanup-failure-test failed: custom cleanup failed/);
});

test('task supervisor reports asynchronous background errors with context', () => {
  const supervisor = new TaskSupervisor();

  supervisor.reportBackgroundError('batch queue drain', new Error('drain exploded'));

  assert.deepEqual(warnings, ['[TASK] batch queue drain failed: drain exploded']);
});

test('task supervisor expiry scheduler arms only while active tasks exist', async () => {
  const supervisor = new TaskSupervisor();

  supervisor.start();
  assert.equal(supervisor.timer, null);

  const task = supervisor.register({
    taskId: 'demand-driven-scheduler-test',
    type: 'generator_job',
    status: 'running',
  });
  assert.ok(supervisor.timer);

  await supervisor.complete(task.taskId);
  assert.equal(supervisor.timer, null);

  supervisor.stop();
});

test('task supervisor expiry scheduler is one-shot and shutdown waits on active sweep', () => {
  const source = new URL('../services/task-supervisor.js', import.meta.url);
  const text = readFileSync(source, 'utf-8');

  assert.match(text, /scheduleNextSweep\(delayMs = TASK_SWEEP_INTERVAL_MS\)/);
  assert.match(text, /if \(!this\.started \|\| this\.stopping \|\| this\.timer \|\| this\.sweepPromise\) return/);
  assert.match(text, /if \(this\.listActive\(\)\.length === 0\) return/);
  assert.match(text, /this\.tasks\.set\(taskId, task\);\s*this\.scheduleNextSweep\(\)/);
  assert.match(text, /if \(this\.listActive\(\)\.length === 0 && this\.timer\) \{\s*clearTimeout\(this\.timer\);\s*this\.timer = null/);
  assert.match(text, /this\.timer = setTimeout\(\(\) => \{/);
  assert.match(text, /this\.sweepPromise = this\.expireTasks\(\)\.catch/);
  assert.match(text, /if \(!this\.stopping\) this\.scheduleNextSweep\(TASK_SWEEP_INTERVAL_MS\)/);
  assert.match(text, /if \(this\.sweepPromise\) \{[\s\S]*task expiry sweep stop wait/);
  assert.match(text, /async function withClearedTimeout\(promise, timeoutMs\)/);
  assert.match(text, /timeoutHandle = setTimeout\(resolve, timeoutMs\)/);
  assert.match(text, /timeoutHandle\.unref\?\.\(\)/);
  assert.match(text, /if \(timeoutHandle\) clearTimeout\(timeoutHandle\)/);
  assert.doesNotMatch(text, /setInterval/);
  assert.doesNotMatch(text, /clearInterval/);
});
