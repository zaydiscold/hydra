// In-memory map: signInId → { accountId, userId, clientCookie, email, createdAt }
// TTL: 15 minutes (Clerk magic links typically expire in 10 min)
export const pendingMagicLinks = new Map();

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const MAGIC_LINK_SWEEP_MS = 60 * 1000;
let cleanupTimer = null;

export function sweepExpiredMagicLinks(now = Date.now()) {
  const cutoff = now - MAGIC_LINK_TTL_MS;
  let removed = 0;
  for (const [k, v] of pendingMagicLinks) {
    if (v.createdAt < cutoff) {
      pendingMagicLinks.delete(k);
      removed++;
    }
  }
  return removed;
}

export function startMagicLinkCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    sweepExpiredMagicLinks();
  }, MAGIC_LINK_SWEEP_MS);
  cleanupTimer.unref?.();
}

export function stopMagicLinkCleanup() {
  if (!cleanupTimer) return;
  clearInterval(cleanupTimer);
  cleanupTimer = null;
}
