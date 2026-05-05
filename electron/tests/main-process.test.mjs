/**
 * Tests for electron/main.js
 *
 * Validates that the Electron main process module:
 * - Exists on disk
 * - Can be parsed as ESM by Node.js
 * - Contains the expected imports/exports patterns
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_JS = resolve(__dirname, '..', 'main.js');
const ROOT = resolve(__dirname, '..', '..');

describe('electron/main.js', () => {
  it('exists on disk', () => {
    assert.ok(existsSync(MAIN_JS), `File not found: ${MAIN_JS}`);
  });

  it('can be parsed as valid ESM syntax', () => {
    // node --check validates syntax without executing.
    // Imports (e.g. from 'electron') are not resolved during --check.
    execSync(`node --check "${MAIN_JS}"`, {
      cwd: ROOT,
      stdio: 'pipe',
    });
  });

  it('imports from the electron module', () => {
    const content = readFileSync(MAIN_JS, 'utf-8');
    assert.ok(
      content.includes("from 'electron'"),
      'main.js must import from the electron module',
    );
  });

  it('sets HYDRA_DATA_DIR from app.getPath', () => {
    const content = readFileSync(MAIN_JS, 'utf-8');
    assert.ok(
      content.includes('process.env.HYDRA_DATA_DIR'),
      'must set HYDRA_DATA_DIR env var',
    );
    assert.ok(
      content.includes("app.getPath('userData')"),
      'must derive HYDRA_DATA_DIR from app.getPath(userData)',
    );
  });

  it('sets DATABASE_URL to userData/hydra.db', () => {
    const content = readFileSync(MAIN_JS, 'utf-8');
    assert.ok(
      content.includes('process.env.DATABASE_URL'),
      'must set DATABASE_URL env var',
    );
    assert.ok(
      content.includes('hydra.db'),
      'DATABASE_URL must reference hydra.db',
    );
  });

  it('references bootstrap and gracefulShutdown from server/index.js', () => {
    const content = readFileSync(MAIN_JS, 'utf-8');
    assert.ok(
      content.includes("'../server/index.js'") || content.includes('"../server/index.js"'),
      'must import from ../server/index.js',
    );
    assert.ok(content.includes('bootstrap'), 'must reference bootstrap');
    assert.ok(content.includes('gracefulShutdown'), 'must reference gracefulShutdown');
  });

  it('calls bootstrap after app.whenReady', () => {
    const content = readFileSync(MAIN_JS, 'utf-8');
    assert.ok(
      content.includes('app.whenReady'),
      'must use app.whenReady to wait for Electron readiness',
    );
    assert.ok(
      content.includes('bootstrap'),
      'must call bootstrap after ready',
    );
  });

  it('creates a BrowserWindow and loads a URL', () => {
    const content = readFileSync(MAIN_JS, 'utf-8');
    assert.ok(
      content.includes('BrowserWindow'),
      'must import and instantiate BrowserWindow',
    );
    assert.ok(
      content.includes('loadURL'),
      'must call loadURL on the window',
    );
  });

  it('loads Vite URL in dev and Express URL in prod', () => {
    const content = readFileSync(MAIN_JS, 'utf-8');
    assert.ok(
      content.includes('localhost:5173'),
      'dev mode should load from Vite dev server at localhost:5173',
    );
    assert.ok(
      content.includes('localhost:'),
      'prod mode should load from Express URL',
    );
  });

  it('hooks before-quit to gracefulShutdown then app.exit(0)', () => {
    const content = readFileSync(MAIN_JS, 'utf-8');
    assert.ok(
      content.includes('before-quit'),
      'must listen for the before-quit event',
    );
    assert.ok(
      content.includes('gracefulShutdown'),
      'before-quit handler must call gracefulShutdown',
    );
    assert.ok(
      content.includes('exit: false') || content.includes('exit:false'),
      'must pass { exit: false } to gracefulShutdown',
    );
    assert.ok(
      content.includes('app.exit'),
      'must call app.exit(0) after shutdown completes',
    );
  });
});
