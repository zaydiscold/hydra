import { prisma } from './db.js';
import { logger } from './logger.js';

const RETENTION_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const RETENTION_STARTUP_DELAY_MS = Number(process.env.HYDRA_REQUEST_LOG_RETENTION_STARTUP_DELAY_MS || 2 * 60 * 1000);
const KEEP_DAYS = Number(process.env.HYDRA_REQUEST_LOG_KEEP_DAYS || 30);
const KEEP_COUNT = Number(process.env.HYDRA_REQUEST_LOG_KEEP_COUNT || 50000);
const NETWORK_ERROR_LOG_WINDOW_MS = 60 * 1000;

let timer = null;
let pruneInFlight = false;
let prunePromise = null;
let stopping = false;
let lastErrorAt = 0;
let startupTimer = null;

async function pruneRequestLogs() {
  if (stopping) return;
  if (pruneInFlight) return;
  pruneInFlight = true;

  try {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000);

    await prisma.requestLog.deleteMany({
      where: { createdAt: { lt: cutoff } }
    });

    await prisma.$executeRawUnsafe(
      `DELETE FROM "RequestLog"
       WHERE "id" IN (
         SELECT "id"
         FROM "RequestLog"
         ORDER BY "createdAt" DESC
         LIMIT -1 OFFSET ${KEEP_COUNT}
       )`
    );
  } catch (err) {
    const now = Date.now();
    if (!stopping && now - lastErrorAt >= NETWORK_ERROR_LOG_WINDOW_MS) {
      logger.warn(`[RETENTION] RequestLog prune failed: ${err.message}`);
      lastErrorAt = now;
    }
  } finally {
    pruneInFlight = false;
  }
}

export function startRequestLogRetention() {
  if (timer) return;
  stopping = false;
  startupTimer = setTimeout(() => {
    startupTimer = null;
    prunePromise = pruneRequestLogs();
    prunePromise.catch((err) => {
      logger.error(`[RETENTION] Initial prune failed: ${err.message}`);
    });
  }, RETENTION_STARTUP_DELAY_MS);
  startupTimer.unref?.();
  timer = setInterval(() => {
    prunePromise = pruneRequestLogs();
  }, RETENTION_INTERVAL_MS);
  timer.unref?.();
  logger.info('[RETENTION] RequestLog retention worker initialized');
}

export async function stopRequestLogRetention() {
  stopping = true;
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = null;
  if (timer) clearInterval(timer);
  timer = null;
  if (prunePromise) {
    await prunePromise.catch((err) => {
      logger.warn(`[RETENTION] Stop waited on failed prune: ${err.message}`);
    });
    prunePromise = null;
  }
}
