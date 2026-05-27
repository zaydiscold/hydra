// In-memory map: signInId → { accountId, userId, clientCookie, email, createdAt }
// TTL: 15 minutes (Clerk magic links typically expire in 10 min)
export const pendingMagicLinks = new Map();

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
let cleanupTimer = null;
let cleanupStarted = false;

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

function nextCleanupDelayMs(now = Date.now()) {
  let nextExpiry = Infinity;
  for (const entry of pendingMagicLinks.values()) {
    const createdAt = Number(entry?.createdAt);
    if (!Number.isFinite(createdAt)) continue;
    nextExpiry = Math.min(nextExpiry, createdAt + MAGIC_LINK_TTL_MS);
  }
  if (!Number.isFinite(nextExpiry)) return null;
  return Math.max(1000, nextExpiry - now);
}

function scheduleMagicLinkCleanup() {
  if (!cleanupStarted) return;
  if (cleanupTimer) clearTimeout(cleanupTimer);
  const delayMs = nextCleanupDelayMs();
  if (delayMs == null) {
    cleanupTimer = null;
    return;
  }
  cleanupTimer = setTimeout(() => {
    cleanupTimer = null;
    sweepExpiredMagicLinks();
    scheduleMagicLinkCleanup();
  }, delayMs);
  cleanupTimer.unref?.();
}

export function trackPendingMagicLink(signInId, entry) {
  pendingMagicLinks.set(signInId, {
    ...entry,
    createdAt: Number.isFinite(Number(entry?.createdAt)) ? Number(entry.createdAt) : Date.now(),
  });
  scheduleMagicLinkCleanup();
}

export function startMagicLinkCleanup() {
  cleanupStarted = true;
  scheduleMagicLinkCleanup();
}

export function stopMagicLinkCleanup() {
  cleanupStarted = false;
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimer = null;
}
