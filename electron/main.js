/**
 * Hydra Electron Main Process — Orchestrator
 *
 * Delegates to split modules under app/ and utils/.
 * All shared runtime state lives in app/state.js.
 */
import { app, Menu, Tray, nativeImage, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Modules ─────────────────────────────────────────────────────────────────
import {
  isDev, setupLogging, setupPlatform, setupEnvironment,
  ensurePackagedRuntimeState, ICON_PATH, resolveDevServerUrl,
} from './app/env.js';
import {
  getMainWindow, getSplashWindow, getWindowURL, getForceQuit, getShuttingDown, getGracefulShutdown, getTray,
  setMainWindow, setSplashWindow, setWindowURL, setExpressPort, setForceQuit, setGracefulShutdown, setShuttingDown, setTray,
  trackedChildren, setBootingSplash, getBootingSplash,
} from './app/state.js';
import { openExternalUrl, showAndFocusMainWindow } from './app/windowActions.js';
import { createSplashWindow, createMainWindow } from './app/windows.js';
import { registerIpcHandlers } from './app/ipc.js';
import { shouldSyncSchema, firstLaunchSetup } from './app/schemaSync.js';
import { shutdownEverything } from './app/shutdown.js';
import { showStartupErrorDialog } from './app/startupError.js';
import { initTelemetry, captureError } from './app/telemetry.js';
import { setupAutoUpdates } from './app/autoUpdate.js';
import { canPromptBiometric, describeBiometricSupport } from './app/biometric.js';
import { isPrefExplicitlySet, setPref } from './app/userPrefs.js';
import { killKnownHydraAuxiliaryProcesses } from './utils/cleanupAuxProcesses.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

// ─── Init ────────────────────────────────────────────────────────────────────
app.setName('Hydra');
setupLogging();
setupPlatform();

// #85: requestSingleInstanceLock prevents dual Electron processes.
// If we don't get the lock we are the second instance — let app.quit()
// drain naturally (no process.exit race per Bug #16) and SKIP the rest
// of init. The first instance is fully responsible for state; we have
// no business setting env vars, building a tray, or registering events.
// Without the early-exit, setupEnvironment + every module side-effect
// runs in a doomed process — wasteful and historically the source of
// "second instance briefly flashes a window before dying" bugs.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  setupEnvironment(app);
  registerLifecycle();
}

// All lifecycle wiring lives in one fn so the single-instance gate above
// can skip it cleanly. Splitting the file into "what runs always" vs
// "what runs only for the lock-holder" is what makes the gate reliable.
function registerLifecycle() {

// ─── Tray ───────────────────────────────────────────────────────────────────
function createTray() {
  const t = getTray();
  if (t && !t.isDestroyed()) return t;
  let img = createTrayImage();
  const tray = new Tray(img);
  tray.setToolTip('Hydra — local OpenRouter proxy');
  tray._hydraProxyEnabled = true;
  const rebuildMenu = () => {
    const url = getWindowURL();
    const proxyEnabled = tray._hydraProxyEnabled !== false;
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Hydra', click: showAndFocusMainWindow },
      { type: 'separator' },
      { label: `Status: ${url ? (proxyEnabled ? 'proxy running' : 'proxy disabled') : 'starting'}`, enabled: false },
      { label: url ? `Proxy URL: ${url}/v1` : 'Proxy URL: starting', enabled: false },
      { type: 'separator' },
      { label: 'Open Logs Folder', click: () => { openTrayFolder('logs'); } },
      { label: 'Open Data Folder', click: () => { openTrayFolder('userData'); } },
      { type: 'separator' },
      { label: 'Hide Window', click: () => { const w = getMainWindow(); if (w && !w.isDestroyed()) w.hide(); } },
      { label: 'Quit Hydra Completely', click: () => { setForceQuit(true); app.quit(); } },
    ]));
  };
  rebuildMenu();
  // Expose rebuild so the tray can be updated when proxy status changes
  tray._hydraRebuildMenu = rebuildMenu;
  tray.on('click', showAndFocusMainWindow);
  setTray(tray);
  return tray;
}

async function openTrayFolder(location) {
  try {
    const result = await shell.openPath(app.getPath(location));
    if (result) console.warn(`[electron] tray open ${location} folder failed: ${result}`);
  } catch (err) {
    console.warn(`[electron] tray open ${location} folder failed: ${err?.message || err}`);
  }
}

async function bindTrayProxyState() {
  const tray = getTray();
  if (!tray || tray.isDestroyed() || tray._hydraProxyUnsubscribe) return;

  try {
    const { proxyGate } = await import('../server/services/proxy-gate.js');
    tray._hydraProxyEnabled = proxyGate.enabled;
    tray._hydraRebuildMenu?.();
    tray._hydraProxyUnsubscribe = proxyGate.onChange(({ enabled }) => {
      const currentTray = getTray();
      if (!currentTray || currentTray.isDestroyed()) return;
      currentTray._hydraProxyEnabled = enabled;
      currentTray._hydraRebuildMenu?.();
    });
  } catch (e) {
    console.warn('[electron] failed to bind tray proxy state:', e?.message || e);
  }
}

function createTrayImage() {
  if (process.platform === 'darwin') {
    // Menu-bar icons on macOS should be template masks, not full-color app
    // icons. This keeps the approved app icon for Dock/Finder while the top
    // bar gets a crisp monochrome mark that follows light/dark mode.
    const size = 18;
    const data = Buffer.alloc(size * size * 4);
    const paint = (x, y, alpha = 255) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = alpha;
    };
    for (let y = 3; y <= 14; y++) {
      paint(4, y);
      paint(5, y, 220);
      paint(12, y);
      paint(13, y, 220);
    }
    for (let x = 5; x <= 12; x++) {
      paint(x, 8);
      paint(x, 9, 220);
    }
    // Small split-terminal cues so it reads as Hydra rather than a generic H.
    paint(3, 4, 180);
    paint(14, 13, 180);
    const template = nativeImage.createFromBuffer(data, { width: size, height: size });
    template.setTemplateImage(true);
    return template;
  }

  const img = nativeImage.createFromPath(ICON_PATH);
  return (img.isEmpty() ? nativeImage.createEmpty() : img).resize({ width: 18, height: 18 });
}

app.on('second-instance', () => {
  // Boot-gate parity with the `activate` handler — without this, a user
  // double-clicking the dock icon during the splash → main hand-off can
  // race-spawn a second main window before the strict serialization in
  // whenReady completes, producing the "splash + main visible at once" bug.
  if (getBootingSplash()) {
    console.log('[electron] second-instance ignored — boot in progress');
    return;
  }
  showAndFocusMainWindow();
});

// ─── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // #97: Startup performance instrumentation — performance.mark/measure
  // at every major phase so we can track regressions and identify
  // per-user bottlenecks. Marks are preserved in the Performance
  // timeline (available via DevTools traces).
  performance.mark('hydra:startup:begin');

  // #9 — opt-in crash telemetry. Init must happen BEFORE we touch any
  // module that might throw, so we get the earliest-possible coverage.
  // Returns false (no-op) when DSN is unset OR user hasn't opted in.
  // Failure modes worth logging: Sentry SDK install corrupted, prefs
  // file unreadable. Never blocks startup either way.
  await initTelemetry().catch((e) => {
    console.warn('[electron] telemetry init failed:', e?.message || e);
  });

  // Biometric auto-enable was REMOVED 2026-05-06 PM. Reason: with auto-on,
  // every launch fires a Touch ID prompt before the auth-token releases →
  // if the user dismisses (or doesn't see the system dialog), the renderer
  // gets `null` and force-routes to the login screen. Result: "session not
  // persisting" reports even though the JWT TTL is 30 days. Biometric is
  // now a deliberate opt-in via Settings → Touch ID Unlock.
  // (Code preserved for one-shot probe in describeBiometricSupport so the
  // Settings UI can still detect availability.)
  void describeBiometricSupport;
  void isPrefExplicitlySet;
  void setPref;
  void canPromptBiometric;

  try {
    // createSplashWindow already calls setSplashWindow(win) internally, so we
    // don't double-set it here. (Earlier code did `setSplashWindow(splash)`
    // where splash was undefined — overwriting the state with undefined and
    // making the destroy() call later silently no-op because getSplashWindow()
    // returned undefined.)
    createSplashWindow();
    performance.mark('hydra:startup:splash-shown');
    // Track when splash first appeared so we can guarantee a minimum visible
    // duration before destroying it. Defined HERE (right at splash creation)
    // not later — otherwise heavy server-bootstrap work below counts against
    // the elapsed time and we'd skip the visible delay entirely on slow boots.
    const splashStartedAt = Date.now();

    const startupSweep = killKnownHydraAuxiliaryProcesses('startup sweep').catch((err) => {
      console.warn(`[electron] startup auxiliary process sweep failed: ${err.message}`);
    });
    // Companion sweep: every Playwright launch creates a fresh `mkdtempSync`
    // profile dir under the OS tmpdir. Past crashed/killed runs leave them
    // behind. They're empty (just the dir entry) but accumulate over weeks
    // of dev cycles and pollute /var/folders inspection. The sweep is safe
    // by construction — only acts on `hydra-pw-profile-*` names under
    // `tmpdir()`, and only on dirs ≥ 60s old (so we never race a sibling).
    const profileSweep = import('../server/lib/playwright-browser.js')
      .then(({ sweepStaleEphemeralProfiles }) => sweepStaleEphemeralProfiles())
      .catch((err) => {
        console.warn(`[electron] stale profile sweep failed: ${err.message}`);
      });
    await ensurePackagedRuntimeState();
    await Promise.allSettled([startupSweep, profileSweep]);
    performance.mark('hydra:startup:runtime-ready');

    // shouldSyncSchema now returns { shouldSync, hash, mtimeFingerprint }.
    // We only need the boolean here; firstLaunchSetup recomputes its own
    // decision (the schema may have been touched between this check and
    // the deferred sync). Threading the full decision through is a future
    // optimization but adds complexity for marginal gain.
    const schemaDecision = await shouldSyncSchema();
    const needsSync = schemaDecision.shouldSync;
    performance.mark('hydra:startup:schema-check');

    const server = await import('../server/index.js');
    setGracefulShutdown(server.gracefulShutdown);
    performance.mark('hydra:startup:server-imported');

    // Item #76: in dev we prefer port 3001 for stable URLs (Vite proxy targets,
    // bookmarks, terminal hot-pasted curl commands), but a stale Vite/Hydra
    // or any other process holding 3001 used to crash the entire app with
    // EADDRINUSE.  Fall back to an OS-assigned random port instead, log
    // clearly which port was actually selected, and surface it via state so
    // the IPC status helper can report the real listen port to renderers.
    const PREFERRED_DEV_PORT = 3001;
    const PORT = isDev ? PREFERRED_DEV_PORT : 0;
    let s;
    try {
      s = await server.bootstrap({ port: PORT, silent: !isDev });
    } catch (bootErr) {
      if (isDev && bootErr?.code === 'EADDRINUSE') {
        console.warn(`[electron] Port ${PREFERRED_DEV_PORT} already in use — falling back to random port. ` +
          'Hint: a stale Vite or Hydra dev server may still be bound. Run `lsof -i :3001` to investigate.');
        s = await server.bootstrap({ port: 0, silent: !isDev });
      } else {
        throw bootErr;
      }
    }
    const expressPort = s.address()?.port ?? PORT;
    setExpressPort(expressPort);
    performance.mark('hydra:startup:bootstrap-done');
    const serverModeLabel = isDev ? 'dev server' : 'embedded server';
    if (isDev && expressPort !== PREFERRED_DEV_PORT) {
      console.log(`[electron] Hydra ${serverModeLabel} bound to port ${expressPort} (preferred ${PREFERRED_DEV_PORT} was busy).`);
    } else {
      console.log(`[electron] Hydra ${serverModeLabel} bound to port ${expressPort}.`);
    }

    // DEV server URL: prefer VITE_DEV_SERVER_URL env, but fall back to
    // Express static serve when Vite isn't running (e.g. standalone `electron .`).
    const staticUrl = `http://localhost:${expressPort}`;
    const url = isDev ? resolveDevServerUrl(process.env.VITE_DEV_SERVER_URL, staticUrl) : staticUrl;
    setWindowURL(url);
    console.log(`[electron] Hydra UI listening at ${url}`);

    registerIpcHandlers();

    const { setupAppMenu } = await import('./menus/appMenu.js');
    setupAppMenu({
      isDev,
      openExternalUrl,
      getServerUrl: () => getWindowURL(),
      showAndFocusMainWindow,
      hideWindow: () => { const w = getMainWindow(); if (w && !w.isDestroyed()) w.hide(); },
      quitCompletely: () => { setForceQuit(true); app.quit(); },
      navigateToSettings: () => {
        showAndFocusMainWindow();
        const mw = getMainWindow();
        if (mw && !mw.isDestroyed()) mw.webContents.send('navigate', '/settings');
      },
      navigateToDiagnostics: () => {
        showAndFocusMainWindow();
        const mw = getMainWindow();
        if (mw && !mw.isDestroyed()) mw.webContents.send('navigate', '/settings#diagnostics');
      },
    });

    createTray();
    await bindTrayProxyState();
    setupAutoUpdates({ isDev, getMainWindow });

    // ─── STRICT SPLASH → MAIN SERIALIZATION ────────────────────────────────
    //
    // Earlier we created the main window in parallel with the splash, with
    // `show: false`, and swapped on `ready-to-show`. That looks clean in
    // theory but in practice the user reported splash + main visible at the
    // same time — caused by either (a) the 15 s loadTimeout fallback firing
    // when ready-to-show was delayed, or (b) main's paint leaking through
    // splash's transparent compositor layer on some macOS versions.
    //
    // True serialization: don't even CONSTRUCT main until the splash is
    // gone. Trade-off is ~500–800 ms slower perceived total (we lose the
    // parallelism that would have pre-warmed main during splash) but we
    // get the clean Pica-style "splash → animation → close → app" flow
    // the product wants.
    //
    // Duration history:
    //   1500 ms — initial; felt like a flash
    //   2500 ms — "let it last a little bit longer"
    //   6800 ms — "extends over 4 more seconds compared to old one with
    //             falling letters" — Pica-style sprawl + falling letters
    //             need this much screen time for the geometry sprawl to
    //             read as intentional, not accidental.
    //   7000 ms — bumped to a clean 7s (2026-05-06).
    //  10000 ms — Pica-style canvas physics splash (2026-05-06 PM). Letters
    //             actually fall + collide + pile up at the bottom now (was
    //             CSS keyframes that just looped). 10s gives the physics
    //             enough time for the pile to settle into a recognizable
    //             pile rather than dismissing mid-bounce.
    //
    // PROGRESS-BAR LOCKSTEP: the splash canvas physics is self-contained,
    // but the `fillbar` keyframe in windows.js still measures perceived
    // progress for the user. Keep that keyframe duration in lockstep with
    // this constant so the bar reaches 100% as the splash dismisses.
    const SPLASH_MIN_VISIBLE_MS = 10000;
    const splashElapsed = Date.now() - splashStartedAt;
    if (splashElapsed < SPLASH_MIN_VISIBLE_MS) {
      await new Promise(resolve => setTimeout(resolve, SPLASH_MIN_VISIBLE_MS - splashElapsed));
    }

    // Phase 1: destroy splash (synchronous). After this line the splash
    // window literally does not exist — there is no race with main.
    const sp = getSplashWindow();
    if (sp && !sp.isDestroyed()) {
      sp.setAlwaysOnTop(false);
      sp.destroy();
    }

    // Phase 2: 250 ms gap so macOS has a Display refresh cycle to fully
    // unmount the splash compositor layer before main starts painting.
    await new Promise(resolve => setTimeout(resolve, 250));

    // Phase 3: NOW construct main window + load URL. show:false until
    // ready-to-show so we don't paint a half-loaded React app for a frame.
    performance.mark('hydra:startup:main-construct');
    const mainWindow = createMainWindow({ show: false, preloadPath: PRELOAD_PATH });
    setMainWindow(mainWindow);

    // Show on ready-to-show (paint complete). 5s safety timeout in case
    // ready-to-show never fires (e.g. React threw on import) — we'd rather
    // show a half-loaded window than leave the user staring at a dock icon.
    let mainShown = false;
    const showMainOnce = () => {
      if (mainShown || !mainWindow || mainWindow.isDestroyed()) return;
      mainShown = true;
      performance.mark('hydra:startup:ready-to-show');
      mainWindow.show();
      mainWindow.focus();
      // Boot complete — release the gate so activate / second-instance /
      // tray-click handlers can spawn windows again from this point on.
      setBootingSplash(false);
    };
    mainWindow.once('ready-to-show', showMainOnce);
    const safetyTimeout = setTimeout(() => {
      if (!mainShown) {
        console.warn('[electron] ready-to-show did not fire within 5s — showing main window anyway');
        showMainOnce();
      }
    }, 5000);

    performance.mark('hydra:startup:loadurl-begin');
    let loadSucceeded = false;
    try {
      await mainWindow.loadURL(url);
      loadSucceeded = true;
    } finally {
      clearTimeout(safetyTimeout);
      if (loadSucceeded && !mainShown) {
        console.warn('[electron] loadURL resolved before ready-to-show — showing main window');
        showMainOnce();
      }
    }
    performance.mark('hydra:startup:loadurl-done');

    if (needsSync) {
      firstLaunchSetup(trackedChildren).catch(async e => {
        console.error('[electron] background firstLaunchSetup failed:', e);
        const w = getMainWindow();
        if (w && !w.isDestroyed()) {
          await showStartupErrorDialog({
            message: 'Hydra was unable to sync the database schema.\n\n'
              + 'This may mean the app needs to be restarted. If the problem persists, your database may be corrupt.\n\n'
              + 'Error: ' + (e.message || String(e)),
            stack: e?.stack || null,
            phase: 'background-firstLaunchSetup',
          });
        }
      });
    }

    // ── Log startup timing summary ─────────────────────────────────────────
    performance.mark('hydra:startup:end');
    const measures = [
      ['splash-shown', 'runtime-ready', 'Hydra startup: runtime init'],
      ['runtime-ready', 'schema-check', 'Hydra startup: schema check'],
      ['schema-check', 'server-imported', 'Hydra startup: server import'],
      ['server-imported', 'bootstrap-done', 'Hydra startup: bootstrap'],
      ['loadurl-begin', 'loadurl-done', 'Hydra startup: loadURL'],
      ['begin', 'ready-to-show', 'Hydra startup: total → ready-to-show'],
      ['begin', 'end', 'Hydra startup: total'],
    ];
    for (const [from, to, label] of measures) {
      try {
        performance.measure(label, `hydra:startup:${from}`, `hydra:startup:${to}`);
      } catch (measureErr) {
        console.warn(`[electron] startup timing measure skipped (${label}): ${measureErr.message}`);
      }
    }
    const totalEntry = performance.getEntriesByName('Hydra startup: total', 'measure')[0];
    if (totalEntry) {
      console.log(`[electron] Hydra startup completed in ${totalEntry.duration.toFixed(0)}ms`);
    }
  } catch (e) {
    console.error('[electron] Failed to start Hydra:', e);
    const sp = getSplashWindow();
    if (sp && !sp.isDestroyed()) sp.close();
    // Replaces the legacy one-button error box — the user now gets
    // "Open Logs Folder" + "Copy Details" buttons before Quit.
    await showStartupErrorDialog({
      message: e?.message || String(e),
      stack: e?.stack || null,
      phase: 'whenReady-bootstrap',
    });
    app.quit();
  }
});

app.on('window-all-closed', () => {});

app.on('activate', () => {
  // GATE: during the splash → main boot sequence the strict-serialization
  // in `whenReady` is responsible for constructing main exactly once. If we
  // also spawn one here from `activate` (which macOS fires when the user
  // double-clicks the .app or the dock icon during startup), we get TWO
  // main windows simultaneously — and the bug where the user sees splash +
  // unlock screen at the same time. Just no-op while booting.
  if (getBootingSplash()) {
    console.log('[electron] activate event ignored — boot in progress');
    return;
  }
  const w = getMainWindow();
  if (w && !w.isDestroyed()) { showAndFocusMainWindow(); return; }
  const url = getWindowURL();
  if (url) {
    const newWin = createMainWindow({ show: false, preloadPath: PRELOAD_PATH });
    setMainWindow(newWin);
    let activateShown = false;
    const showActivatedWindow = () => {
      if (activateShown || newWin.isDestroyed()) return;
      activateShown = true;
      newWin.show();
      newWin.focus();
    };
    newWin.once('ready-to-show', showActivatedWindow);
    newWin.loadURL(url).then(showActivatedWindow).catch(async loadErr => {
      console.error('[electron] Activate loadURL failed:', loadErr.message);
      const mw = getMainWindow();
      if (mw && !mw.isDestroyed()) {
        mw.close();
        // Same actionable buttons as the startup-failure case so the
        // user can grab logs/copy details before having to restart.
        await showStartupErrorDialog({
          message: `Failed to load the Hydra interface.\n${loadErr.message}\n\nPlease restart Hydra.`,
          stack: loadErr?.stack || null,
          phase: 'activate-loadURL',
        });
      }
    });
  }
});

// ─── Shutdown ──────────────────────────────────────────────────────────────
app.on('before-quit', (event) => {
  event.preventDefault();
  if (getShuttingDown()) return;
  setShuttingDown(true);
  shutdownEverything({
    reason: 'before-quit',
    trackedChildren,
    gracefulShutdown: getGracefulShutdown(),
  }).finally(() => app.exit(0));
});

process.on('uncaughtException', async (err) => {
  console.error('[electron] uncaughtException:', err);
  // Best-effort telemetry — no-op if user hasn't opted in.
  try {
    captureError(err, { phase: 'uncaughtException' });
  } catch (captureErr) {
    console.warn('[electron] uncaughtException telemetry capture failed:', captureErr?.message ?? captureErr);
  }
  setShuttingDown(true);
  await shutdownEverything({
    reason: 'uncaughtException',
    trackedChildren,
    gracefulShutdown: getGracefulShutdown(),
  });
  app.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  console.error('[electron] unhandledRejection:', reason);
});

} // end registerLifecycle — see top-of-file single-instance gate
