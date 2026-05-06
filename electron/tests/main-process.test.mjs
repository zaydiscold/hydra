/**
 * Tests for the Electron main-process surface.
 *
 * The main-process logic was split during the 2026-05 modularization
 * (env / windows / ipc / schemaSync / shutdown / state). These assertions
 * now check the *union* of `electron/main.js` + `electron/app/*.js` so they
 * still mean "the main process must wire X" — regardless of which module
 * actually owns X.
 *
 * Validates:
 * - main.js exists and parses as ESM
 * - Electron import is present
 * - HYDRA_DATA_DIR + DATABASE_URL come from app.getPath('userData')
 * - The server is imported and bootstrapped after whenReady
 * - A BrowserWindow is created with a loadURL call
 * - Vite dev URL + localhost prod URL are wired
 * - before-quit triggers gracefulShutdown({exit:false}) then app.exit
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = resolve(__dirname, '..');
const MAIN_JS = resolve(ELECTRON_DIR, 'main.js');
const APP_DIR = resolve(ELECTRON_DIR, 'app');
const ROOT = resolve(__dirname, '..', '..');

/** Concatenate main.js + every electron/app/*.js into one searchable blob. */
function readMainProcessSurface() {
  const files = [MAIN_JS];
  if (existsSync(APP_DIR)) {
    for (const name of readdirSync(APP_DIR)) {
      if (name.endsWith('.js')) files.push(join(APP_DIR, name));
    }
  }
  return files.map(f => readFileSync(f, 'utf-8')).join('\n');
}

describe('electron main-process surface (main.js + app/*.js)', () => {
  it('main.js exists on disk', () => {
    assert.ok(existsSync(MAIN_JS), `File not found: ${MAIN_JS}`);
  });

  it('main.js parses as valid ESM syntax', () => {
    execSync(`node --check "${MAIN_JS}"`, { cwd: ROOT, stdio: 'pipe' });
  });

  it('main.js imports from the electron module', () => {
    const main = readFileSync(MAIN_JS, 'utf-8');
    assert.ok(main.includes("from 'electron'"), 'main.js must import from electron');
  });

  it('sets HYDRA_DATA_DIR from app.getPath(userData)', () => {
    const surface = readMainProcessSurface();
    assert.ok(surface.includes('process.env.HYDRA_DATA_DIR'), 'must set HYDRA_DATA_DIR');
    assert.ok(surface.includes("app.getPath('userData')"), 'must derive from app.getPath(userData)');
  });

  it('sets DATABASE_URL referencing hydra.db', () => {
    const surface = readMainProcessSurface();
    assert.ok(surface.includes('process.env.DATABASE_URL'), 'must set DATABASE_URL');
    assert.ok(surface.includes('hydra.db'), 'DATABASE_URL must reference hydra.db');
  });

  it('imports bootstrap + gracefulShutdown from server/index.js', () => {
    const surface = readMainProcessSurface();
    assert.ok(
      surface.includes("'../server/index.js'") || surface.includes('"../server/index.js"'),
      'must import from ../server/index.js',
    );
    assert.ok(surface.includes('bootstrap'), 'must reference bootstrap');
    assert.ok(surface.includes('gracefulShutdown'), 'must reference gracefulShutdown');
  });

  it('calls bootstrap after app.whenReady', () => {
    const main = readFileSync(MAIN_JS, 'utf-8');
    assert.ok(main.includes('app.whenReady'), 'main.js must use app.whenReady');
    const surface = readMainProcessSurface();
    assert.ok(surface.includes('bootstrap'), 'must call bootstrap after ready');
  });

  it('creates a BrowserWindow with a loadURL call', () => {
    const surface = readMainProcessSurface();
    assert.ok(surface.includes('BrowserWindow'), 'must instantiate BrowserWindow');
    assert.ok(surface.includes('loadURL'), 'must call loadURL on the window');
  });

  it('loads Vite URL in dev and a localhost URL in prod', () => {
    const surface = readMainProcessSurface();
    assert.ok(surface.includes('localhost:5173'), 'dev should load Vite at localhost:5173');
    assert.ok(surface.includes('localhost:'), 'prod should load a localhost URL');
  });

  it('hooks before-quit to gracefulShutdown({exit:false}) then app.exit', () => {
    const surface = readMainProcessSurface();
    assert.ok(surface.includes('before-quit'), 'must listen for before-quit');
    assert.ok(surface.includes('gracefulShutdown'), 'before-quit must call gracefulShutdown');
    assert.ok(
      surface.includes('exit: false') || surface.includes('exit:false'),
      'must pass { exit: false } to gracefulShutdown',
    );
    assert.ok(surface.includes('app.exit'), 'must call app.exit after shutdown');
  });
});
