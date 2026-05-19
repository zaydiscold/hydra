import { prisma } from './db.js';
import { logger } from './logger.js';

const FLUSH_INTERVAL_MS = Number(process.env.HYDRA_REQUEST_LOG_FLUSH_MS || 1000);
const MAX_QUEUE = Number(process.env.HYDRA_REQUEST_LOG_QUEUE_MAX || 2000);
const MAX_FLUSH_BATCH = Number(process.env.HYDRA_REQUEST_LOG_FLUSH_BATCH || 100);
const MAX_SHUTDOWN_DRAIN_MS = Number(process.env.HYDRA_REQUEST_LOG_SHUTDOWN_DRAIN_MS || 5000);
const ERROR_LOG_WINDOW_MS = 60 * 1000;

let queue = [];
let timer = null;
let flushing = false;
let dropped = 0;
let lastErrorAt = 0;
let lastDropWarnAt = 0;

function normalizeTokens(tokens = {}) {
  return {
    promptTokens: tokens.prompt_tokens || null,
    completionTokens: tokens.completion_tokens || null,
  };
}

function warnDropped() {
  const now = Date.now();
  if (now - lastDropWarnAt < ERROR_LOG_WINDOW_MS) return;
  logger.warn(`[REQUEST_LOG] Queue full; dropped ${dropped} request log row(s) so proxy traffic can keep flowing`);
  lastDropWarnAt = now;
}

function ensureTimer() {
  if (timer) return;
  timer = setInterval(() => {
    void flushRequestLogBuffer();
  }, FLUSH_INTERVAL_MS);
  timer.unref?.();
}

export function enqueueRequestLog({ keyHash, model, status, latencyMs, tokens = {}, clientHint = null }) {
  if (queue.length >= MAX_QUEUE) {
    dropped += 1;
    warnDropped();
    return false;
  }

  queue.push({
    keyHash: keyHash ?? null,
    model,
    status,
    latencyMs,
    clientHint,
    ...normalizeTokens(tokens),
  });
  ensureTimer();
  return true;
}

async function writeRequestLog(row) {
  try {
    await prisma.requestLog.create({ data: row });
  } catch (err) {
    if (row.keyHash) {
      try {
        await prisma.requestLog.create({
          data: {
            ...row,
            keyHash: null,
          },
        });
        return;
      } catch (fallbackErr) {
        const { formatPrismaError } = await import('../lib/prisma-error.js');
        logger.error(`[REQUEST_LOG] ${formatPrismaError(fallbackErr, 'write buffered RequestLog without keyHash')}`);
      }
    }

    const now = Date.now();
    if (now - lastErrorAt >= ERROR_LOG_WINDOW_MS) {
      const { formatPrismaError } = await import('../lib/prisma-error.js');
      logger.error(`[REQUEST_LOG] ${formatPrismaError(err, 'write buffered RequestLog')}`);
      lastErrorAt = now;
    }
  }
}

export async function flushRequestLogBuffer() {
  if (flushing || queue.length === 0) return;
  flushing = true;

  try {
    while (queue.length > 0) {
      const batch = queue.splice(0, MAX_FLUSH_BATCH);
      for (const row of batch) {
        await writeRequestLog(row);
      }
    }
  } finally {
    flushing = false;
  }
}

export async function stopRequestLogBuffer() {
  if (timer) clearInterval(timer);
  timer = null;
  let drainTimeout = null;
  try {
    await Promise.race([
      flushRequestLogBuffer(),
      new Promise(resolve => {
        drainTimeout = setTimeout(resolve, MAX_SHUTDOWN_DRAIN_MS);
        drainTimeout.unref?.();
      }),
    ]);
  } finally {
    if (drainTimeout) clearTimeout(drainTimeout);
  }
}

export function getRequestLogBufferSnapshot() {
  return {
    queued: queue.length,
    dropped,
    flushing,
    maxQueue: MAX_QUEUE,
  };
}
