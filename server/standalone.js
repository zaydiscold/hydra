#!/usr/bin/env node
/**
 * Hydra standalone server entry point (terminal / launch.js).
 *
 * Thin wrapper that imports bootstrap + gracefulShutdown from ./index.js,
 * registers SIGINT/SIGTERM handlers, and starts the server on the
 * configured port (env PORT or 3001 via server/config.js).
 *
 * ─── ELECTRON_MIGRATION ───
 * This is the terminal-only entry point. Electron uses electron/main.js
 * which imports bootstrap/gracefulShutdown directly and manages its own
 * lifecycle — do NOT add Electron-specific code here.
 * ─── END ELECTRON_MIGRATION ───
 */
import { bootstrap, gracefulShutdown } from './index.js';

const port = process.env.PORT || 3001;
process.env.PORT = String(port);

async function main() {
  const shutdown = async (signal) => {
    console.log(`\n[standalone] Received ${signal} — shutting down...`);
    await gracefulShutdown(signal);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await bootstrap();
  } catch (err) {
    console.error(`[standalone] Bootstrap failed: ${err.message}`);
    await gracefulShutdown('bootstrap-error', { exit: true });
  }
}

main();
