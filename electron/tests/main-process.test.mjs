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
const MENU_JS = resolve(ELECTRON_DIR, 'menus', 'appMenu.js');
const CLEANUP_JS = resolve(ELECTRON_DIR, 'utils', 'cleanupAuxProcesses.js');
const MIGRATE_LEGACY_JS = resolve(ELECTRON_DIR, 'utils', 'migrateLegacyData.js');
const STARTUP_ERROR_JS = resolve(APP_DIR, 'startupError.js');
const WINDOW_ACTIONS_JS = resolve(APP_DIR, 'windowActions.js');
const AFTER_PACK_JS = resolve(ELECTRON_DIR, 'builders', 'afterPack.js');
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

  it('afterPack parses as valid ESM syntax', () => {
    execSync(`node --check "${AFTER_PACK_JS}"`, { cwd: ROOT, stdio: 'pipe' });
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

  it('keeps standard native macOS traffic lights and titlebar drag affordance on the main window', () => {
    const windows = readFileSync(resolve(APP_DIR, 'windows.js'), 'utf-8');

    assert.match(windows, /const useNativeMacChrome = process\.platform === 'darwin'/);
    assert.match(windows, /frame: useNativeMacChrome/);
    assert.doesNotMatch(windows, /titleBarStyle:/);
    assert.doesNotMatch(windows, /trafficLightPosition:/);
  });

  it('loads Vite URL in dev and a localhost URL in prod', () => {
    const surface = readMainProcessSurface();
    assert.ok(surface.includes('resolveDevServerUrl'), 'dev should resolve the Vite URL dynamically');
    assert.ok(surface.includes('VITE_DEV_SERVER_URL'), 'dev should honor VITE_DEV_SERVER_URL when set');
    assert.ok(surface.includes('staticUrl'), 'prod should derive a localhost static URL');
    assert.ok(surface.includes('http://localhost:'), 'prod should load a localhost URL');
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

  it('wires quit and tray actions through the complete shutdown path', () => {
    const main = readFileSync(MAIN_JS, 'utf-8');
    const surface = readMainProcessSurface();

    assert.ok(main.includes('Quit Hydra Completely'), 'tray/menu must expose a full quit action');
    assert.ok(main.includes('setForceQuit(true); app.quit();'), 'full quit actions must set force-quit before app.quit');
    assert.ok(surface.includes('tracked child kill failed:'), 'tracked child kill failures must be logged');
    assert.ok(!surface.includes("catch { /* already dead */ }"), 'tracked child kill failures must not be silently swallowed');
    assert.ok(surface.includes('shutdownEverything({'), 'before-quit must route through shutdownEverything');
    assert.ok(surface.includes('trackedChildren'), 'shutdown must receive tracked child processes');
    assert.ok(surface.includes('getGracefulShutdown()'), 'shutdown must receive the embedded server shutdown function');
  });

  it('shutdown sweeps auxiliary processes, stale Playwright profiles, and tray state', () => {
    const surface = readMainProcessSurface();
    const cleanup = readFileSync(CLEANUP_JS, 'utf-8');

    assert.ok(surface.includes('killKnownHydraAuxiliaryProcesses(reason)'), 'shutdown must sweep Hydra auxiliary processes');
    assert.ok(cleanup.includes('Get-CimInstance Win32_Process'), 'Windows sweep must enumerate process command lines');
    assert.ok(cleanup.includes("taskkill.exe', ['/PID', String(pid), '/T', '/F']"), 'Windows sweep must kill matched process trees');
    assert.ok(!cleanup.includes("if (process.platform === 'win32') return"), 'Windows sweep must not be a no-op');
    assert.ok(surface.includes('sweepStaleEphemeralProfiles'), 'shutdown must sweep stale Playwright profile dirs');
    assert.ok(surface.includes('tray.destroy()'), 'shutdown must destroy the tray icon');
    assert.ok(surface.includes('setTray(null)'), 'shutdown must clear tray state after destroy');
    assert.ok(surface.includes('gracefulShutdown(reason, { exit: false, timeoutMs: 3000 })'), 'shutdown must bound server shutdown');
  });

  it('wires Help menu documentation, diagnostics, folders, and build-info copy actions', () => {
    const main = readFileSync(MAIN_JS, 'utf-8');
    const menu = readFileSync(MENU_JS, 'utf-8');
    const windowActions = readFileSync(WINDOW_ACTIONS_JS, 'utf-8');

    assert.ok(menu.includes('Hydra Documentation'), 'Help menu must expose documentation');
    assert.ok(menu.includes('Report an Issue'), 'Help menu must expose issue reporting');
    assert.ok(menu.includes('openExternalUrl(REPO_URL)'), 'documentation action must open the repo URL externally');
    assert.ok(menu.includes('openExternalUrl(ISSUES_URL)'), 'issue action must open the issues URL externally');
    assert.ok(windowActions.includes('invalid external URL blocked:'), 'invalid external URLs must be logged');
    assert.ok(windowActions.includes('failed to open external URL ${rawUrl}:'), 'external URL open failures must be logged');
    assert.ok(menu.includes('Diagnostics in Settings'), 'Help menu must expose diagnostics');
    assert.ok(menu.includes("accelerator: 'CmdOrCtrl+D'"), 'Diagnostics must have Cmd/Ctrl+D accelerator');
    assert.ok(menu.includes('click: navigateToDiagnostics'), 'Diagnostics action must route through navigateToDiagnostics');
    assert.ok(main.includes("mw.webContents.send('navigate', '/settings#diagnostics')"), 'main process must route diagnostics to Settings anchor');
    assert.ok(menu.includes('Show Logs Folder'), 'Help menu must expose logs folder');
    assert.ok(menu.includes("openAppFolder('logs', 'show logs folder')"), 'logs action must open app logs path through checked helper');
    assert.ok(menu.includes('Show Data Folder'), 'Help menu must expose data folder');
    assert.ok(menu.includes("openAppFolder('userData', 'show data folder')"), 'data action must open app userData path through checked helper');
    assert.ok(menu.includes('Show Build Info'), 'Help menu must expose build info');
    assert.ok(menu.includes("buttons: ['OK', 'Copy']"), 'Build Info dialog must offer Copy');
    assert.ok(menu.includes("copyTextToClipboard(info, 'copy build info', focusedWindow)"), 'Build Info Copy must use checked clipboard helper');
    assert.ok(menu.includes('native:clipboard-copy-failed'), 'menu clipboard failures must notify the renderer when possible');
    assert.ok(menu.includes('build info dialog failed:'), 'Build Info dialog failures must be logged');
    assert.ok(main.includes("openTrayFolder('logs')"), 'tray logs action must use checked folder helper');
    assert.ok(main.includes("openTrayFolder('userData')"), 'tray data action must use checked folder helper');
    assert.ok(main.includes('tray open ${location} folder failed:'), 'tray folder-open failures must be logged');
  });

  it('startup failure dialog reports Open Logs and Copy Details action failures', () => {
    const startup = readFileSync(STARTUP_ERROR_JS, 'utf-8');

    assert.ok(startup.includes("buttons: ['Quit', 'Open Logs Folder', 'Copy Details']"), 'startup dialog must expose recovery actions');
    assert.ok(startup.includes("console.error('[startupError] open logs failed:'"), 'Open Logs failures must be logged');
    assert.ok(startup.includes("console.error('[startupError] copy details failed:'"), 'Copy Details failures must be logged');
    assert.ok(startup.includes('Failed to open logs folder.'), 'Open Logs failure must show user feedback');
    assert.ok(startup.includes('Failed to copy error details.'), 'Copy Details failure must show user feedback');
    assert.ok(startup.includes('Error details copied to clipboard.'), 'Copy Details success must show success feedback');
    assert.ok(!startup.includes("catch { /* ignore */ }"), 'startup dialog actions must not silently ignore failures');
  });

  it('does not leave startup or activate windows blank when ready-to-show is missing', () => {
    const surface = readFileSync(MAIN_JS, 'utf-8');

    assert.ok(surface.includes('loadURL resolved before ready-to-show'), 'startup must show main after a successful load even if ready-to-show never fires');
    assert.ok(surface.includes('if (loadSucceeded && !mainShown)'), 'startup fallback must only show after loadURL succeeds');
    assert.ok(surface.includes('createMainWindow({ show: false, preloadPath: PRELOAD_PATH })'), 'activate path must not show a blank window before loadURL');
    assert.ok(surface.includes('newWin.once(\'ready-to-show\', showActivatedWindow)'), 'activate path must show after ready-to-show');
    assert.ok(surface.includes('newWin.loadURL(url).then(showActivatedWindow).catch'), 'activate path must also show after successful loadURL when ready-to-show is missing');
    assert.ok(surface.includes('mw.close();'), 'activate load failure must close the hidden failed window before surfacing recovery');
  });

  it('startup timing and uncaught-exception telemetry failures are visible', () => {
    const surface = readFileSync(MAIN_JS, 'utf-8');

    assert.ok(surface.includes('startup timing measure skipped (${label}): ${measureErr.message}'), 'missing startup timing marks must log context');
    assert.ok(surface.includes('uncaughtException telemetry capture failed:'), 'telemetry capture failure during crash handling must be logged');
    assert.ok(!surface.includes("catch { /* mark may not exist yet"), 'startup timing measure failures must not be silent');
    assert.ok(!surface.includes("catch { /* ignore */ }"), 'uncaught exception telemetry failures must not be silent');
  });

  it('splash greeting lookup fallbacks leave diagnostic evidence', () => {
    const windows = readFileSync(resolve(APP_DIR, 'windows.js'), 'utf-8');

    assert.ok(windows.includes('full-name greeting lookup failed, using username fallback'), 'macOS full-name lookup failures must be logged');
    assert.ok(windows.includes('greeting name fallback failed:'), 'username fallback failures must be logged');
    assert.ok(!windows.includes("catch { /* fall back */ }"), 'full-name lookup failures must not be silent');
    assert.ok(!windows.includes("catch { /* greeting is best-effort */ }"), 'greeting fallback failures must not be silent');
  });

  it('Electron log tee write and close failures remain visible without recursion', () => {
    const surface = readFileSync(resolve(APP_DIR, 'env.js'), 'utf-8');

    assert.ok(surface.includes('rawConsoleWarn = console.warn.bind(console)'), 'log tee must keep a raw warning channel before wrapping console.warn');
    assert.ok(surface.includes('log stream write failed:'), 'log stream write failures must be reported');
    assert.ok(surface.includes('log stream close failed:'), 'log stream close failures must be reported');
    assert.ok(surface.includes('_logWriteFailureReported'), 'repeated write failures must be bounded');
    assert.ok(!surface.includes('catch { /* stream closed during shutdown */ }'), 'log stream write failures must not be silently swallowed');
    assert.ok(!surface.includes('catch { /* may not exist */ }'), 'log rotation cleanup must not hide non-ENOENT unlink failures');
  });

  it('legacy data migration distinguishes missing files from unreadable state', () => {
    const migration = readFileSync(MIGRATE_LEGACY_JS, 'utf-8');

    assert.ok(migration.includes('function isNotFoundError(err)'), 'migration must identify true not-found errors');
    assert.ok(migration.includes("err?.code === 'ENOENT'"), 'missing files may be treated as absent');
    assert.ok(migration.includes("err?.code === 'ENOTDIR'"), 'missing parent directories may be treated as absent');
    assert.ok(migration.includes('Could not inspect ${label}, skipping migration'), 'unexpected access failures must log context');
    assert.ok(migration.includes('throw err'), 'unexpected access failures must skip migration instead of looking absent');
    assert.ok(migration.includes('function isMissingAccountTableError(err)'), 'only missing Account tables should fall through as uninitialized');
    assert.ok(migration.includes('Could not inspect database accounts for ${dbPath}, skipping migration'), 'database inspection failures must be visible');
    assert.ok(migration.includes('Prisma disconnect after account inspection failed'), 'inspection cleanup failures must be visible');
    assert.ok(migration.includes('Legacy hydra.db has no Account table; skipping migration'), 'empty legacy DBs must not be promoted');
    assert.ok(migration.includes('fsConstants.COPYFILE_EXCL'), 'sidecar files must not overwrite newer userData files');
    assert.ok(!migration.includes('.catch(() => false)'), 'access failures must not be silently collapsed to missing');
  });

  it('persists renderer auth token through native IPC', () => {
    const surface = readMainProcessSurface();
    assert.ok(surface.includes('native:auth-token:get'), 'must expose native token read');
    assert.ok(surface.includes('native:auth-token:status'), 'must expose native token status for diagnostics');
    assert.ok(surface.includes('native:auth-token:set'), 'must expose native token write');
    assert.ok(surface.includes('renderer-auth-token.json'), 'must persist token outside port-scoped localStorage');
    assert.ok(surface.includes('expiresAt'), 'native persisted token must store an explicit expiry');
    assert.ok(surface.includes('24 * 60 * 60 * 1000'), 'native persisted token must be capped to a 24-hour unlock window');
  });

  it('keeps biometric auth-token fallback failures visible while failing closed', () => {
    const ipc = readFileSync(resolve(ROOT, 'electron/app/ipc.js'), 'utf-8');
    const biometric = readFileSync(resolve(ROOT, 'electron/app/biometric.js'), 'utf-8');
    assert.ok(ipc.includes('biometric auth-token gate denied release'), 'auth-token gate denial must leave log evidence');
    assert.ok(ipc.includes("promptErr?.code || 'BIOMETRIC_DENIED'"), 'auth-token gate denial must preserve the biometric failure code');
    assert.ok(ipc.includes('return ok(null); // user cancelled, failed, or unavailable'), 'auth-token gate denial must still fall back to password');
    assert.ok(biometric.includes('Touch ID availability check failed'), 'Touch ID availability probe failures must be logged');
    assert.ok(biometric.includes('Touch ID prompt failed (${e.code})'), 'Touch ID prompt failures must be logged with typed codes');
    assert.ok(!biometric.includes('} catch {\n    return false;'), 'Touch ID availability failures must not be silently swallowed');
  });

  it('afterPack writes macOS PkgInfo before signing', () => {
    const afterPack = readFileSync(AFTER_PACK_JS, 'utf-8');

    assert.ok(afterPack.includes("writeFileSync(pkgInfoPath, 'APPL????')"), 'macOS packages should include Contents/PkgInfo');
    assert.ok(afterPack.includes('resolveMacAppPath(appOutDir, packager)'), 'afterPack must resolve the .app path from appOutDir');
    assert.ok(afterPack.includes('ensureMacPkgInfo(appOutDir, packager, platform)'), 'afterPack must call the PkgInfo helper');
  });
});
