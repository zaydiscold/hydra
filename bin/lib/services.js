/**
 * Hydra CLI — service-level fast path.
 *
 * The CLI talks to the same `server/services/*` modules the Express app uses,
 * so commands run in ~50 ms instead of spawning Express + Prisma per call.
 * No HTTP, no port, no auth handshake — same machine, same DB, same trust.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

let initialized = false;

/**
 * Pin DATABASE_URL to the dev DB before any service imports happen.
 * Electron-packaged installs would set this via electron/main.js — for the
 * raw CLI we default to the dev DB at the repo root.
 */
function pinEnv() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = `file:${resolve(REPO_ROOT, 'data', 'hydra.db')}`;
  }
  if (!process.env.HYDRA_DATA_DIR) {
    process.env.HYDRA_DATA_DIR = resolve(REPO_ROOT, 'data');
  }
}

/**
 * Lazily-import service modules so the CLI's startup cost stays low.
 * Returns a namespace of the modules the commands actually use.
 */
export async function loadServices() {
  if (!initialized) {
    pinEnv();
    initialized = true;
  }
  const [store, db] = await Promise.all([
    import('../../server/services/store.js'),
    import('../../server/services/db.js'),
  ]);
  return { store, db };
}

/**
 * Resolve the local user. The CLI is single-user — first user in the DB wins.
 * Throws if the DB has no user yet (run `npm run setup` or open the UI once).
 */
export async function resolveUser() {
  const { db } = await loadServices();
  const user = await db.prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!user) {
    const err = new Error('No user found in DB. Open the Hydra UI once and set a password to bootstrap.');
    err.code = 'NO_USER';
    throw err;
  }
  return user;
}

/** Best-effort cleanup so Node exits cleanly. */
export async function shutdown() {
  try {
    const { db } = await loadServices();
    await db.disconnectPrisma?.();
  } catch { /* ignore */ }
}
