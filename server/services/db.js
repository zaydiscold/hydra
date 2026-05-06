import pkg from '@prisma/client';
const { PrismaClient } = pkg;

// #94: Lazy PrismaClient initialization.
// Previously `new PrismaClient()` ran at module evaluation time, which dlopen'd
// the 18MB native query engine synchronously during Electron startup.  The
// engine load blocked the entire import chain (main.js → server/index.js →
// store.js → db.js → @prisma/client → .dylib.node), freezing the splash screen
// for 50-200ms on cold cache.
//
// The Proxy defers construction until the first property access — by that point
// the splash is already rendered and the server bootstrap is under way, so the
// engine load overlaps with meaningful work instead of blocking the UI thread.
let _prisma = null;
// Per-property cache of bound methods + reference to the client instance
// they were bound to. The previous Proxy called `value.bind(client)` on
// EVERY property access — `prisma.user.findMany()` does ~3 trap hits and
// each .bind() allocates a fresh function object. On hot paths (the proxy
// router does dozens of prisma calls per inbound request) this generates
// noticeable GC pressure; tens of MB of short-lived bound functions per
// minute under load.
//
// We cache the bound function once per (client, prop) pair and invalidate
// the cache on `disconnectPrisma` so a re-init doesn't return stale
// bindings to a closed client.
let _bindCache = new WeakMap();

function getPrisma() {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

function getCachedBound(client, prop) {
  let perClient = _bindCache.get(client);
  if (!perClient) {
    perClient = new Map();
    _bindCache.set(client, perClient);
  }
  let bound = perClient.get(prop);
  if (!bound) {
    const raw = client[prop];
    if (typeof raw !== 'function') return raw;
    bound = raw.bind(client);
    perClient.set(prop, bound);
  }
  return bound;
}

export const prisma = new Proxy({}, {
  get(_, prop) {
    const client = getPrisma();
    const value = client[prop];
    if (typeof value !== 'function') return value;
    return getCachedBound(client, prop);
  },
  set(_, prop, value) {
    getPrisma()[prop] = value;
    return true;
  },
  has(_, prop) {
    return prop in getPrisma();
  },
});

export async function disconnectPrisma() {
  if (_prisma) {
    try { await _prisma.$disconnect(); } catch { /* best effort */ }
    _prisma = null;
    // Reset the bound-method cache so a future re-init doesn't return
    // bindings against the disconnected client. WeakMap entries for the
    // old client become unreachable once `_prisma` is nulled out, but
    // resetting explicitly makes the lifecycle obvious to readers.
    _bindCache = new WeakMap();
  }
}
