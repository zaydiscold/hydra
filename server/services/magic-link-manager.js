// In-memory map: signInId → { accountId, userId, clientCookie, email, createdAt }
// TTL: 15 minutes (Clerk magic links typically expire in 10 min)
export const pendingMagicLinks = new Map();

setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [k, v] of pendingMagicLinks) {
    if (v.createdAt < cutoff) pendingMagicLinks.delete(k);
  }
}, 60_000);
