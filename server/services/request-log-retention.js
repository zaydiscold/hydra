import { prisma } from './db.js';
import { logger } from './logger.js';

const RETENTION_INTERVAL_MS = Number(process.env.HYDRA_REQUEST_LOG_RETENTION_INTERVAL_MS || 15 * 60 * 1000);
const RETENTION_STARTUP_DELAY_MS = Number(process.env.HYDRA_REQUEST_LOG_RETENTION_STARTUP_DELAY_MS || 2 * 60 * 1000);
const KEEP_DAYS = Number(process.env.HYDRA_REQUEST_LOG_KEEP_DAYS || 30);
const KEEP_COUNT = Number(process.env.HYDRA_REQUEST_LOG_KEEP_COUNT || 50000);
const NETWORK_ERROR_LOG_WINDOW_MS = 60 * 1000;

let timer = null;
let pruneInFlight = false;
let prunePromise = null;
let stopping = false;
let started = false;
let lastErrorAt = 0;
let startupTimer = null;

export async function pruneRequestLogs() {
  if (stopping) return false;
  if (pruneInFlight) return true;
  pruneInFlight = true;

  try {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000);
    const oldest = await prisma.requestLog.findFirst({
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!oldest) return false;

    if (oldest.createdAt < cutoff) {
      const deleted = await prisma.requestLog.deleteMany({
        where: { createdAt: { lt: cutoff } }
      });
      if (deleted.count > 0) {
        const remaining = await prisma.requestLog.findFirst({
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
        if (!remaining) return false;
      }
    }

    const overflow = await prisma.requestLog.findFirst({
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      skip: KEEP_COUNT,
    });

    if (!overflow) return true;

    await prisma.$executeRawUnsafe(
      `DELETE FROM "RequestLog"
       WHERE "id" IN (
         SELECT "id"
         FROM "RequestLog"
         ORDER BY "createdAt" DESC
         LIMIT -1 OFFSET ${KEEP_COUNT}
       )`
    );
    return KEEP_COUNT > 0;
  } catch (err) {
    const now = Date.now();
    if (!stopping && now - lastErrorAt >= NETWORK_ERROR_LOG_WINDOW_MS) {
      logger.warn(`[RETENTION] RequestLog prune failed: ${err.message}`);
      lastErrorAt = now;
    }
    return true;
  } finally {
    pruneInFlight = false;
  }
}

function scheduleNextPrune(delayMs = RETENTION_INTERVAL_MS) {
  if (!started || stopping || timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (stopping) return;
    runPruneAndReschedule();
  }, delayMs);
  timer.unref?.();
}

function runPruneAndReschedule() {
  if (!started || stopping || prunePromise) return;
  let keepScheduled = true;
  prunePromise = pruneRequestLogs()
    .then((hasRows) => {
      keepScheduled = hasRows;
    })
    .finally(() => {
      prunePromise = null;
      if (!stopping && keepScheduled) scheduleNextPrune(RETENTION_INTERVAL_MS);
    });
}

export function noteRequestLogActivity() {
  if (!started || stopping) return;
  scheduleNextPrune(RETENTION_INTERVAL_MS);
}

export function startRequestLogRetention() {
  if (started) return;
  started = true;
  stopping = false;
  startupTimer = setTimeout(() => {
    startupTimer = null;
    runPruneAndReschedule();
  }, RETENTION_STARTUP_DELAY_MS);
  startupTimer.unref?.();
  logger.info('[RETENTION] RequestLog retention worker initialized');
}

export async function stopRequestLogRetention() {
  stopping = true;
  started = false;
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = null;
  if (timer) clearTimeout(timer);
  timer = null;
  if (prunePromise) {
    await prunePromise.catch((err) => {
      logger.warn(`[RETENTION] Stop waited on failed prune: ${err.message}`);
    });
    prunePromise = null;
  }
}

export function getRequestLogRetentionSnapshot() {
  return {
    started,
    stopping,
    startupScheduled: Boolean(startupTimer),
    pruneScheduled: Boolean(timer),
    pruneInFlight,
  };
}
