import { prisma } from './db.js';
import { logger } from './logger.js';

const RETENTION_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const KEEP_DAYS = 30;
const KEEP_COUNT = 50000;
const NETWORK_ERROR_LOG_WINDOW_MS = 60 * 1000;

let timer = null;
let pruneInFlight = false;
let lastErrorAt = 0;

async function pruneRequestLogs() {
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
    if (now - lastErrorAt >= NETWORK_ERROR_LOG_WINDOW_MS) {
      logger.warn(`[RETENTION] RequestLog prune failed: ${err.message}`);
      lastErrorAt = now;
    }
  } finally {
    pruneInFlight = false;
  }
}

export function startRequestLogRetention() {
  if (timer) return;
  timer = setInterval(pruneRequestLogs, RETENTION_INTERVAL_MS);
  pruneRequestLogs().catch((err) => {
    logger.error(`[RETENTION] Initial prune failed: ${err.message}`);
  });
  logger.info('[RETENTION] RequestLog retention worker initialized');
}

export function stopRequestLogRetention() {
  if (timer) clearInterval(timer);
  timer = null;
}
