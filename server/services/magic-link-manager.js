// In-memory maps:
// - signInId → pending entry for Hydra renderer polling
// - opaque linkId → the same entry for the public email callback
// TTL: 15 minutes (Clerk magic links typically expire in 10 min)
export const pendingMagicLinks = new Map();
export const pendingMagicLinkCallbacks = new Map();

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
let cleanupTimer = null;
let cleanupStarted = false;

export function sweepExpiredMagicLinks(now = Date.now()) {
  const cutoff = now - MAGIC_LINK_TTL_MS;
  let removed = 0;
  for (const [k, v] of pendingMagicLinks) {
    if (v.createdAt < cutoff) {
      forgetPendingMagicLink(k);
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
  const previous = pendingMagicLinks.get(signInId);
  if (previous?.linkId) pendingMagicLinkCallbacks.delete(previous.linkId);
  const normalized = {
    ...entry,
    signInId,
    createdAt: Number.isFinite(Number(entry?.createdAt)) ? Number(entry.createdAt) : Date.now(),
  };
  pendingMagicLinks.set(signInId, normalized);
  if (normalized.linkId) pendingMagicLinkCallbacks.set(normalized.linkId, normalized);
  scheduleMagicLinkCleanup();
}

export function forgetPendingMagicLink(signInId) {
  const pending = pendingMagicLinks.get(signInId);
  pendingMagicLinks.delete(signInId);
  if (pending?.linkId) pendingMagicLinkCallbacks.delete(pending.linkId);
}

export function claimPendingMagicLinkCallback(linkId) {
  const pending = pendingMagicLinkCallbacks.get(linkId);
  if (!pending) return null;
  pendingMagicLinkCallbacks.delete(linkId);
  return pending;
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
