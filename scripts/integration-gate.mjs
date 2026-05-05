#!/usr/bin/env node
/**
 * Hydra Electron Integration Gate — validates ALL phases.
 * Exit code 0 = ALL PASS, non-zero = FAILURE.
 *
 * Phase 1: Server refactor
 *   C: Import does NOT auto-start server
 *   A: bootstrap({port}) returns http.Server
 *   B: gracefulShutdown({exit:false}) works
 *
 * Phase 2: Electron shell
 *   D: electron/main.js exists and has required patterns
 *   E: electron/preload.js exists and uses contextBridge
 *   F: electron-builder.yml exists and has asarUnpack
 *   G: package.json has electron deps + dev:electron script
 *
 * Phase 3: Polish
 *   H: desktop/icons/icon.png exists
 *   I: desktop/icons/icon.icns exists
 *   J: dist/index.html exists (Vite build output)
 *
 * Phase 4: Live integration
 *   K: Dynamic import of server modules works
 *   L: Ephemeral server boot + graceful shutdown
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      // Async check — will be awaited in the main run loop
      return result.then(
        () => { passed++; console.log('  PASS  ' + name); },
        (err) => { failed++; console.log('  FAIL  ' + name + ': ' + err.message); }
      );
    }
    passed++;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL  ' + name + ': ' + err.message);
  }
}

function assertFile(path, desc) {
  if (!existsSync(resolve(ROOT, path))) throw new Error(desc + ' missing at ' + path);
}

function assertPattern(content, regex, desc) {
  if (!regex.test(content)) throw new Error(desc + ' not found');
}

/** Find a free port by binding to port 0. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('listening', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1');
  });
}

async function run() {
  console.log('\n=== Hydra Electron Integration Gate ===\n');

  // ─── Phase 1: Server refactor ───
  check('C: import does not auto-start server', () => {
    // Static analysis — verify server is initialized as null and exported
    const src = readFileSync(resolve(ROOT, 'server/index.js'), 'utf-8');
    assertPattern(src, /let\s+server\s*=\s*null/, 'server must init as null');
    assertPattern(src, /export\s*\{\s*app,\s*bootstrap,\s*gracefulShutdown,\s*server/, 'must export named');
  });

  check('A: bootstrap({port}) returns http.Server', () => {
    const src = readFileSync(resolve(ROOT, 'server/index.js'), 'utf-8');
    assertPattern(src, /return\s+server/, 'bootstrap must return server');
    assertPattern(src, /async function bootstrap\(\{/, 'must accept options');
  });

  check('B: gracefulShutdown({exit:false}) works', () => {
    const src = readFileSync(resolve(ROOT, 'server/index.js'), 'utf-8');
    assertPattern(src, /exit\s*=\s*true/, 'must default exit=true');
    assertPattern(src, /if\s*\(\s*exit\s*\)/, 'must guard process.exit');
  });

  // ─── Phase 2: Electron shell ───
  check('D: electron/main.js exists + patterns', () => {
    assertFile('electron/main.js', 'main.js');
    const src = readFileSync(resolve(ROOT, 'electron/main.js'), 'utf-8');
    assertPattern(src, /HYDRA_DATA_DIR/, 'must set HYDRA_DATA_DIR');
    assertPattern(src, /HYDRA_EMBEDDED/, 'must set HYDRA_EMBEDDED');
    assertPattern(src, /BrowserWindow/, 'must create BrowserWindow');
    assertPattern(src, /gracefulShutdown/, 'must use gracefulShutdown');
    assertPattern(src, /ICON_PATH|iconPath/, 'must set icon path');
  });

  check('E: electron/preload.js uses contextBridge', () => {
    assertFile('electron/preload.js', 'preload.js');
    const src = readFileSync(resolve(ROOT, 'electron/preload.js'), 'utf-8');
    assertPattern(src, /contextBridge/, 'must use contextBridge');
  });

  check('F: electron-builder.yml has asarUnpack', () => {
    assertFile('electron-builder.yml', 'builder config');
    const src = readFileSync(resolve(ROOT, 'electron-builder.yml'), 'utf-8');
    assertPattern(src, /asarUnpack/, 'must configure asarUnpack');
  });

  check('G: package.json has Electron deps + scripts', () => {
    assertFile('package.json', 'package.json');
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
    if (!pkg.dependencies.electron && !pkg.devDependencies?.electron)
      throw new Error('electron not installed');
    if (!pkg.scripts['dev:electron'])
      throw new Error('dev:electron script missing');
    if (pkg.main !== 'electron/main.js')
      throw new Error('main entry wrong');
  });

  // ─── Phase 3: Polish ───
  check('H: desktop/icons/icon.png exists', () => {
    assertFile('desktop/icons/icon.png', 'icon.png');
  });

  check('I: desktop/icons/icon.icns exists', () => {
    assertFile('desktop/icons/icon.icns', 'icon.icns');
  });

  check('J: dist/index.html exists (Vite built)', () => {
    assertFile('dist/index.html', 'dist/index.html');
    console.log('      (run `npm run build` to generate if missing)');
  });

  // ─── Phase 4: Live integration ───
  await check('K: dynamic import of server modules works', async () => {
    // Verify key server modules can be imported without error
    const { bootstrap, gracefulShutdown, server } = await import('../server/index.js');
    if (typeof bootstrap !== 'function') throw new Error('bootstrap is not a function');
    if (typeof gracefulShutdown !== 'function') throw new Error('gracefulShutdown is not a function');
    if (server !== null) throw new Error('server should be null before bootstrap');
  });

  await check('L: ephemeral server boot + graceful shutdown', async () => {
    const { bootstrap, gracefulShutdown } = await import('../server/index.js');

    // Find a free port to avoid conflicts
    const port = await findFreePort();
    const originalDbUrl = process.env.DATABASE_URL;

    // Use the empty-hydra.db for a clean sandbox
    const dbPath = resolve(ROOT, 'data', 'empty-hydra.db');
    if (!existsSync(dbPath)) {
      throw new Error('empty-hydra.db not found — run `node scripts/build-empty-db.mjs` first');
    }
    process.env.DATABASE_URL = `file:${dbPath}`;

    try {
      const srv = await bootstrap({ port, silent: true });
      if (!srv || typeof srv.close !== 'function') {
        throw new Error('bootstrap did not return an http.Server');
      }

      // Verify server responds to health checks
      const res = await fetch(`http://127.0.0.1:${port}/api/system/health`);
      if (res.status !== 200) {
        throw new Error(`Health endpoint returned status ${res.status}`);
      }

      // Shut down gracefully
      await gracefulShutdown('integration-gate', { exit: false });
      console.log('      (ephemeral server started on port ' + port + ', health check passed, shut down)');
    } finally {
      // Restore original DATABASE_URL
      if (originalDbUrl) {
        process.env.DATABASE_URL = originalDbUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
    }
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
