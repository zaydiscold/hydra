/**
 * Hydra Electron Main Process — Orchestrator
 *
 * Delegates to split modules under app/ and utils/.
 * All shared runtime state lives in app/state.js.
 */
import { app, Menu, Tray, nativeImage, shell } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
import { completePendingUpdate, readPendingUpdate } from './app/updateHandoff.js';
import { canPromptBiometric } from './app/biometric.js';
import { initializeBiometricDefault } from './app/userPrefs.js';
import { killKnownHydraAuxiliaryProcesses } from './utils/cleanupAuxProcesses.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const LIFECYCLE_KEEPALIVE_RENEW_MS = 24 * 60 * 60 * 1000;

let lifecycleKeepAliveTimer = null;

function lifecycleSnapshot(extra = {}) {
  const mainWindow = getMainWindow();
  const splashWindow = getSplashWindow();
  const tray = getTray();
  return {
    forceQuit: getForceQuit(),
    shuttingDown: getShuttingDown(),
    bootingSplash: getBootingSplash(),
    mainWindow: mainWindow && !mainWindow.isDestroyed(),
    splashWindow: splashWindow && !splashWindow.isDestroyed(),
    tray: tray && !tray.isDestroyed(),
    activeHandles: typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : null,
    ...extra,
  };
}

function logLifecycle(event, extra = {}) {
  try {
    console.warn(`[electron] lifecycle:${event} ${JSON.stringify(lifecycleSnapshot(extra))}`);
  } catch (err) {
    console.warn(`[electron] lifecycle:${event} log failed: ${err?.message || err}`);
  }
}

const RENDERER_DIAGNOSTICS_SCRIPT = `
(() => {
  const fn = window.__HYDRA_RENDERER_DIAGNOSTICS__;
  return typeof fn === 'function' ? fn() : null;
})()
`;
const SELF_CAPTURE_ARG_PREFIX = '--hydra-self-capture=';
const SELF_CAPTURE_DELAY_ARG_PREFIX = '--hydra-self-capture-delay-ms=';
const SELF_CAPTURE_DEFAULT_DELAY_MS = 2500;
const SELF_CAPTURE_MIN_DELAY_MS = 1000;
const SELF_CAPTURE_MAX_DELAY_MS = 15000;

let selfCaptureScheduled = false;

function summarizeRendererBucket(bucket) {
  const active = Number.isFinite(Number(bucket?.active)) ? Number(bucket.active) : 0;
  const byOwner = {};
  const owners = bucket?.byOwner && typeof bucket.byOwner === 'object' ? bucket.byOwner : {};
  for (const [owner, count] of Object.entries(owners)) {
    const safeOwner = String(owner || 'unknown').slice(0, 120);
    byOwner[safeOwner] = Number.isFinite(Number(count)) ? Number(count) : 0;
  }
  return { active, byOwner };
}

function summarizeRendererDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== 'object') {
    return { available: false };
  }

  const timeouts = summarizeRendererBucket(diagnostics.timeouts);
  const intervals = summarizeRendererBucket(diagnostics.intervals);
  const animationFrames = summarizeRendererBucket(diagnostics.animationFrames);
  const animations = summarizeRendererBucket(diagnostics.animations);
  const activeTotal = Number.isFinite(Number(diagnostics.activeTotal))
    ? Number(diagnostics.activeTotal)
    : timeouts.active + intervals.active + animationFrames.active + animations.active;

  return {
    available: true,
    generatedAt: Number.isFinite(Number(diagnostics.generatedAt)) ? Number(diagnostics.generatedAt) : null,
    activeTotal,
    timeouts,
    intervals,
    animationFrames,
    animations,
  };
}

async function logRendererDiagnostics(window, label) {
  if (!window || window.isDestroyed() || window.webContents?.isDestroyed?.()) return;
  try {
    const diagnostics = await window.webContents.executeJavaScript(RENDERER_DIAGNOSTICS_SCRIPT, true);
    console.warn('[hydra-renderer] diagnostics', JSON.stringify({
      label,
      ...summarizeRendererDiagnostics(diagnostics),
    }));
  } catch (err) {
    console.warn('[hydra-renderer] diagnostics failed:', err?.message || err);
  }
}

function scheduleRendererDiagnostics(window, label, delayMs) {
  const timer = setTimeout(() => {
    void logRendererDiagnostics(window, label);
  }, delayMs);
  timer.unref?.();
}

function parseSelfCaptureRequest() {
  const captureArg = process.argv.find((arg) => arg.startsWith(SELF_CAPTURE_ARG_PREFIX));
  if (!captureArg) return null;

  const rawOutputPath = captureArg.slice(SELF_CAPTURE_ARG_PREFIX.length).trim();
  if (!rawOutputPath) return { error: 'empty capture path' };
  if (!path.isAbsolute(rawOutputPath)) return { error: 'capture path must be absolute' };

  const outputPath = path.resolve(rawOutputPath);
  if (path.extname(outputPath).toLowerCase() !== '.png') return { error: 'capture path must end in .png' };

  const allowedRoots = [
    path.resolve(tmpdir()),
    path.resolve('/tmp'),
    path.resolve('/private/tmp'),
    path.resolve(app.getPath('logs')),
  ];
  const allowed = allowedRoots.some((root) => outputPath === root || outputPath.startsWith(`${root}${path.sep}`));
  if (!allowed) return { error: 'capture path must be under the OS temp dir or Hydra logs dir' };

  const delayArg = process.argv.find((arg) => arg.startsWith(SELF_CAPTURE_DELAY_ARG_PREFIX));
  const rawDelay = delayArg ? Number.parseInt(delayArg.slice(SELF_CAPTURE_DELAY_ARG_PREFIX.length), 10) : SELF_CAPTURE_DEFAULT_DELAY_MS;
  const delayMs = Number.isFinite(rawDelay)
    ? Math.max(SELF_CAPTURE_MIN_DELAY_MS, Math.min(SELF_CAPTURE_MAX_DELAY_MS, rawDelay))
    : SELF_CAPTURE_DEFAULT_DELAY_MS;

  return { outputPath, delayMs };
}

function selfCapturePathForLog(outputPath) {
  const tmpRoot = path.resolve(tmpdir());
  if (outputPath === tmpRoot || outputPath.startsWith(`${tmpRoot}${path.sep}`)) {
    return `$TMPDIR/${path.relative(tmpRoot, outputPath)}`;
  }
  const logsRoot = path.resolve(app.getPath('logs'));
  if (outputPath === logsRoot || outputPath.startsWith(`${logsRoot}${path.sep}`)) {
    return `$HYDRA_LOGS/${path.relative(logsRoot, outputPath)}`;
  }
  return path.basename(outputPath);
}

function scheduleSelfCapture(window, reason) {
  if (selfCaptureScheduled) return;
  const request = parseSelfCaptureRequest();
  if (!request) return;
  selfCaptureScheduled = true;

  if (request.error) {
    console.warn(`[hydra-capture] self capture disabled: ${request.error}`);
    return;
  }

  const timer = setTimeout(async () => {
    try {
      if (!window || window.isDestroyed() || window.webContents?.isDestroyed?.()) {
        throw new Error('main window not available');
      }
      const image = await window.webContents.capturePage();
      if (!image || image.isEmpty()) throw new Error('captured image is empty');
      const png = image.toPNG();
      await mkdir(path.dirname(request.outputPath), { recursive: true });
      await writeFile(request.outputPath, png, { mode: 0o600 });
      console.warn('[hydra-capture] self capture wrote', JSON.stringify({
        reason,
        output: selfCapturePathForLog(request.outputPath),
        bytes: png.length,
      }));
    } catch (err) {
      console.warn('[hydra-capture] self capture failed:', err?.message || err);
    }
  }, request.delayMs);
  timer.unref?.();
}

function armLifecycleKeepAlive() {
  // Electron native objects should be enough to keep a packaged app alive, but
  // LaunchServices dogfood exposed a voluntary zero-code exit without any app
  // quit/window/IPC path firing. A single long-horizon ref'd timeout is enough
  // to retain the process without waking the idle event loop every minute.
  lifecycleKeepAliveTimer = setTimeout(() => {
    lifecycleKeepAliveTimer = null;
    armLifecycleKeepAlive();
  }, LIFECYCLE_KEEPALIVE_RENEW_MS);
  lifecycleKeepAliveTimer.ref?.();
}

function startLifecycleKeepAlive() {
  if (lifecycleKeepAliveTimer) return;
  armLifecycleKeepAlive();
  logLifecycle('keepalive-started', { renewMs: LIFECYCLE_KEEPALIVE_RENEW_MS });
}

function stopLifecycleKeepAlive() {
  if (!lifecycleKeepAliveTimer) return;
  clearTimeout(lifecycleKeepAliveTimer);
  lifecycleKeepAliveTimer = null;
  logLifecycle('keepalive-stopped');
}

function registerProcessExitDiagnostics() {
  process.on('beforeExit', (code) => {
    logLifecycle('process-beforeExit', { code });
  });
  process.on('exit', (code) => {
    logLifecycle('process-exit', { code });
  });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(signal, () => {
      logLifecycle('process-signal', { signal });
      setForceQuit(true);
      app.quit();
    });
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────
app.setName('Hydra');
// Enforce renderer sandboxing globally before app readiness. Individual
// BrowserWindow options retain sandbox:true as an explicit local contract.
app.enableSandbox();
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
  logLifecycle('single-instance-denied');
  app.quit();
} else {
  setupEnvironment(app);
  registerLifecycle();
}

// All lifecycle wiring lives in one fn so the single-instance gate above
// can skip it cleanly. Splitting the file into "what runs always" vs
// "what runs only for the lock-holder" is what makes the gate reliable.
function registerLifecycle() {
startLifecycleKeepAlive();
registerProcessExitDiagnostics();

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
      { label: 'Quit Hydra Completely', click: () => { logLifecycle('tray-quit-click'); setForceQuit(true); app.quit(); } },
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

  // Touch ID-capable Macs default biometric unlock on once. The preference
  // initializer preserves a Settings opt-out and keeps unsupported platforms
  // off. The IPC token gate still checks for a usable saved token before
  // prompting, so first launch and expired-token flows go straight to the
  // password fallback instead of showing a pointless OS prompt.
  await initializeBiometricDefault(canPromptBiometric()).then((result) => {
    if (result.changed) {
      console.warn(`[electron] biometric default initialized: enabled=${result.enabled} source=${result.source}`);
    }
  }).catch((e) => {
    console.warn('[electron] biometric default initialization failed:', e?.message || e);
  });

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

    const pendingUpdate = readPendingUpdate();
    const completingUpdate = pendingUpdate?.targetVersion === app.getVersion();

    // shouldSyncSchema now returns { shouldSync, hash, mtimeFingerprint }.
    // We only need the boolean here; firstLaunchSetup recomputes its own
    // decision (the schema may have been touched between this check and
    // the deferred sync). Threading the full decision through is a future
    // optimization but adds complexity for marginal gain.
    const schemaDecision = await shouldSyncSchema();
    const needsSync = schemaDecision.shouldSync;
    performance.mark('hydra:startup:schema-check');

    if (completingUpdate) {
      console.log(`[electron-updater] completing update maintenance ${pendingUpdate.fromVersion} -> ${pendingUpdate.targetVersion}`);
      await firstLaunchSetup(trackedChildren);
      completePendingUpdate(pendingUpdate);
      console.log(`[electron-updater] completed update maintenance for ${pendingUpdate.targetVersion}`);
    }

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
      quitCompletely: () => { logLifecycle('menu-quit-completely'); setForceQuit(true); app.quit(); },
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
    setupAutoUpdates({ isDev, getMainWindow, getSplashWindow });

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
    //  12000 ms — +2s density pass (2026-05-26). User feedback: the new
    //             falling animation looks good; let it breathe longer and
    //             fill more of the screen before the main window takes over.
    //  16000 ms — +33% elegance pass (2026-05-30). The final portal phase
    //             now pulls settled glyphs into an accelerating center orbit
    //             instead of disappearing behind a hard gravity flip.
    //             A 2026-06-02 refinement starts that phase at 11.75s, giving
    //             the bounded glyph light wave 4.25s without extending launch.
    //
    // PROGRESS-BAR LOCKSTEP: the splash canvas physics is self-contained,
    // but the `fillbar` keyframe in windows.js still measures perceived
    // progress for the user. Keep that keyframe duration in lockstep with
    // this constant so the bar reaches 100% as the splash dismisses.
    const SPLASH_MIN_VISIBLE_MS = 16000;
    const splashElapsed = Date.now() - splashStartedAt;
    if (splashElapsed < SPLASH_MIN_VISIBLE_MS) {
      await new Promise(resolve => setTimeout(resolve, SPLASH_MIN_VISIBLE_MS - splashElapsed));
    }

    // Phase 1: destroy splash (synchronous). After this line the splash
    // window literally does not exist — there is no race with main.
    const sp = getSplashWindow();
    if (sp && !sp.isDestroyed()) {
      try {
        const splashDiagnostics = await sp.webContents.executeJavaScript(
          'window.__HYDRA_DISPOSE_SPLASH__ && window.__HYDRA_DISPOSE_SPLASH__("main-destroy")',
          true,
        );
        if (splashDiagnostics && typeof splashDiagnostics === 'object') {
          console.warn('[hydra-splash] diagnostics', JSON.stringify(splashDiagnostics));
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (disposeErr) {
        console.warn('[electron] splash diagnostics dispose failed:', disposeErr?.message || disposeErr);
      }
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
    let mainRevealStarted = false;
    // If macOS accepts the show request but still reports the window hidden
    // (LaunchServices occasionally does this during relaunch/activate races),
    // try the shared tray/activate path once boot has been released.
    const armLateRecover = () => {
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
        console.warn('[electron] main reveal late recovery — using shared show/focus path');
        showAndFocusMainWindow().catch?.((err) => {
          console.warn('[electron] main reveal late recovery failed:', err?.message || err);
        });
      }, 2200).unref?.();
    };

    const revealMainWindow = async (reason = 'ready-to-show') => {
      if (mainRevealStarted || !mainWindow || mainWindow.isDestroyed()) return;
      mainRevealStarted = true;
      performance.mark('hydra:startup:ready-to-show');
      if (process.platform === 'darwin') {
        try {
          await Promise.race([
            Promise.resolve(app.dock?.show()),
            new Promise(resolve => setTimeout(resolve, 500)),
          ]);
        } catch (err) {
          console.warn('[electron] dock show before main reveal failed:', err?.message || err);
        }
      }
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.showInactive();
      mainWindow.show();
      if (process.platform === 'darwin') {
        try {
          app.focus({ steal: true });
        } catch (err) {
          console.warn('[electron] app focus before main reveal failed:', err?.message || err);
        }
      }
      mainWindow.focus();
      mainWindow.moveTop();

      const verifyVisible = (label) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (!mainWindow.isVisible()) {
          console.warn(`[electron] main reveal did not become visible after ${label} — retrying show`);
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.showInactive();
          mainWindow.show();
          mainWindow.focus();
          mainWindow.moveTop();
        }
        console.warn(`[electron] main-window:startup-reveal ${JSON.stringify({
          reason,
          label,
          visible: mainWindow.isVisible(),
          minimized: mainWindow.isMinimized(),
          focused: mainWindow.isFocused(),
        })}`);
      };
      verifyVisible(reason);
      setTimeout(() => verifyVisible(`${reason}+300ms`), 300).unref?.();
      setTimeout(() => verifyVisible(`${reason}+1200ms`), 1200).unref?.();
      scheduleRendererDiagnostics(mainWindow, `${reason}+2s`, 2000);
      scheduleRendererDiagnostics(mainWindow, `${reason}+10s`, 10000);
      scheduleSelfCapture(mainWindow, reason);
      // Boot complete — release the gate so activate / second-instance /
      // tray-click handlers can spawn windows again from this point on.
      setBootingSplash(false);
      armLateRecover();
    };
    mainWindow.once('ready-to-show', () => {
      void revealMainWindow('ready-to-show');
    });
    const safetyTimeout = setTimeout(() => {
      if (!mainRevealStarted) {
        console.warn('[electron] ready-to-show did not fire within 5s — showing main window anyway');
        void revealMainWindow('ready-timeout');
      }
    }, 5000);
    safetyTimeout.unref?.();

    performance.mark('hydra:startup:loadurl-begin');
    let loadSucceeded = false;
    try {
      await mainWindow.loadURL(url);
      loadSucceeded = true;
    } finally {
      clearTimeout(safetyTimeout);
      if (loadSucceeded && !mainRevealStarted) {
        console.warn('[electron] loadURL resolved before ready-to-show — showing main window');
        await revealMainWindow('loadURL-resolved');
      }
    }
    performance.mark('hydra:startup:loadurl-done');

    if (needsSync && !completingUpdate) {
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
    logLifecycle('startup-failure-quit');
    app.quit();
  }
});

app.on('window-all-closed', () => {
  logLifecycle('window-all-closed');
});

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
  logLifecycle('before-quit');
  event.preventDefault();
  if (getShuttingDown()) {
    logLifecycle('before-quit-already-shutting-down');
    return;
  }
  setShuttingDown(true);
  stopLifecycleKeepAlive();
  shutdownEverything({
    reason: 'before-quit',
    trackedChildren,
    gracefulShutdown: getGracefulShutdown(),
  }).finally(() => app.exit(0));
});

app.on('will-quit', (_event) => {
  logLifecycle('will-quit');
});

app.on('quit', (_event, exitCode) => {
  logLifecycle('quit', { exitCode });
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
