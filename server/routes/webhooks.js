import { Router } from 'express';
import { recordWebhookEvent } from '../services/webhook-idempotency.js';
import { logger } from '../services/logger.js';
import { revokeSessionsByClerkSessionId } from '../services/store.js';

const router = Router();

router.post('/clerk', async (req, res) => {
  try {
    const payload = req.body ?? {};
    const headerEventId = req.get('svix-id') || req.get('clerk-event-id');
    const payloadEventId = payload?.data?.id || payload?.id;
    const eventId = headerEventId || payloadEventId;
    const eventType = payload?.type || 'unknown';

    const { duplicate, eventId: normalizedId } = await recordWebhookEvent(eventId, payload);
    if (duplicate) {
      return res.status(202).json({
        success: true,
        duplicate: true,
        eventId: normalizedId,
        message: 'Duplicate webhook event ignored',
      });
    }

    let action = { type: 'none', revoked: 0, matched: 0 };
    if (eventType === 'session.ended' || eventType === 'session.revoked') {
      const sessionId = payload?.data?.id || payload?.data?.session_id || payload?.data?.sessionId || null;
      const result = await revokeSessionsByClerkSessionId(sessionId, eventType);
      action = { type: 'session_revoke', ...result };
    }

    logger.info(`[WEBHOOK] Clerk event accepted: ${eventType} (${normalizedId})`);
    return res.status(200).json({
      success: true,
      duplicate: false,
      eventId: normalizedId,
      action,
      message: 'Webhook accepted',
    });
  } catch (err) {
    logger.error(`[WEBHOOK] Clerk webhook failed: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Webhook processing failed' });
  }
});

export default router;
