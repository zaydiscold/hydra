// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

const warnings = [];

mock.module(new URL('../services/logger.js', import.meta.url).href, {
  namedExports: {
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
  },
  defaultExport: {
    warn(message) {
      warnings.push(message);
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
