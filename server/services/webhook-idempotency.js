import crypto from 'crypto';
import { prisma } from './db.js';
import { logger } from './logger.js';

let initialized = false;

async function ensureTable() {
  if (initialized) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS clerk_webhook_events (
      event_id TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  initialized = true;
}

function stablePayloadHash(payload) {
  const json = JSON.stringify(payload ?? {});
  return crypto.createHash('sha256').update(json).digest('hex');
}

export async function recordWebhookEvent(eventId, payload) {
  await ensureTable();
  const normalizedId = String(eventId || '').trim() || `payload:${stablePayloadHash(payload)}`;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO clerk_webhook_events (event_id) VALUES (?)`,
      normalizedId
    );
    return { duplicate: false, eventId: normalizedId };
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg.includes('UNIQUE constraint failed') || msg.includes('PRIMARY KEY')) {
      return { duplicate: true, eventId: normalizedId };
    }
    logger.error(`[WEBHOOK] failed to record event ${normalizedId}: ${msg}`);
    throw err;
  }
}
