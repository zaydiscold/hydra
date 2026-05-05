#!/usr/bin/env node
/**
 * Hydra Electron Integration Gate — validates ALL phases.
 * Exit code 0 = ALL PASS, non-zero = FAILURE.
 *
 * Phase 1: Server refactor
 *   C: Import does NOT auto-start server
 *   A: bootstrap({port}) returns http.Server
 *   B: gracefulShutdown({exit:false}) works
 *   K: server/config.js loads without throwing (dynamic import)
 *   L: ephemeral server boots and closes cleanly
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
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL  ' + name + ': ' + err.message);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
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

  // ── Dynamic import + ephemeral server boot ──
  await checkAsync('K: server/config.js loads without throwing', async () => {
    const config = await import(resolve(ROOT, 'server/config.js'));
    if (!config || typeof config !== 'object') throw new Error('config module did not export an object');
  });

  await checkAsync('L: ephemeral server boots and closes cleanly', async () => {
    const { bootstrap, gracefulShutdown } = await import(resolve(ROOT, 'server/index.js'));
    const server = await bootstrap({ port: 0, silent: true });
    if (!server || typeof server.close !== 'function') {
      throw new Error('bootstrap did not return a server instance');
    }
    await gracefulShutdown('SIGTERM', { exit: false });
  });

  // ─── Phase 2: Electron shell ───
  check('D: electron/main.js exists + patterns', () => {
    assertFile('electron/main.js', 'main.js');
    assertFile('electron/app/env.js', 'Electron env module');
    assertFile('electron/app/windows.js', 'Electron windows module');
    assertFile('electron/app/schemaSync.js', 'Electron schema sync module');

    const mainSrc = readFileSync(resolve(ROOT, 'electron/main.js'), 'utf-8');
    const envSrc = readFileSync(resolve(ROOT, 'electron/app/env.js'), 'utf-8');
    const windowsSrc = readFileSync(resolve(ROOT, 'electron/app/windows.js'), 'utf-8');
    const schemaSrc = readFileSync(resolve(ROOT, 'electron/app/schemaSync.js'), 'utf-8');

    assertPattern(envSrc, /HYDRA_DATA_DIR/, 'must set HYDRA_DATA_DIR');
    assertPattern(envSrc, /HYDRA_EMBEDDED/, 'must set HYDRA_EMBEDDED');
    assertPattern(windowsSrc, /BrowserWindow/, 'must create BrowserWindow');
    assertPattern(mainSrc, /gracefulShutdown/, 'must use gracefulShutdown');
    assertPattern(envSrc + windowsSrc, /ICON_PATH|iconPath/, 'must set icon path');
    assertPattern(schemaSrc, /runSelfHeal|db-self-heal/, 'must include packaged schema self-heal');
  });

  check('E: electron/preload.js uses contextBridge', () => {
    assertFile('electron/preload.js', 'preload.js');
    const src = readFileSync(resolve(ROOT, 'electron/preload.js'), 'utf-8');
    assertPattern(src, /contextBridge/, 'must use contextBridge');
  });

  check('F: electron-builder.yml has asar config for Prisma native engine', () => {
    assertFile('electron-builder.yml', 'builder config');
    const src = readFileSync(resolve(ROOT, 'electron-builder.yml'), 'utf-8');
    // Either `asar: false` (current) OR an active `asarUnpack:` block (future)
    // is acceptable — both ensure dlopen() can find the Prisma native engine.
    // A bare `asarUnpack` mention inside a comment does not count.
    const asarFalse = /^\s*asar:\s*false\b/m.test(src);
    const asarUnpackActive = /^\s*asarUnpack:\s*$/m.test(src);
    if (!asarFalse && !asarUnpackActive) {
      throw new Error('must configure either `asar: false` or an `asarUnpack:` block');
    }
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

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
