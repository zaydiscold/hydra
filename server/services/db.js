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

function getPrisma() {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

export const prisma = new Proxy({}, {
  get(_, prop) {
    const client = getPrisma();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
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
  }
}
