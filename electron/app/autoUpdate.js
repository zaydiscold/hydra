import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';

let updateCheckStarted = false;
let latestUpdateVersion = null;
const UPDATE_CHECK_DELAY_MS = 500;
const SPLASH_UPDATE_PROGRESS_EVENT = 'hydra-update-progress';

function getAutoUpdater(log) {
  try {
    return electronUpdater.autoUpdater;
  } catch (err) {
    log?.warn?.(`[electron-updater] updater unavailable: ${err?.message || err}`);
    return null;
  }
}

function sendSplashUpdateProgress(getSplashWindow, payload) {
  const splash = getSplashWindow?.();
  if (!splash || splash.isDestroyed()) return false;
  splash.webContents?.send?.(SPLASH_UPDATE_PROGRESS_EVENT, payload);
  return true;
}

export function setupAutoUpdates({ isDev, getMainWindow, getSplashWindow, log = console } = {}) {
  if (updateCheckStarted) return false;
  if (isDev || !app.isPackaged) return false;

  const autoUpdater = getAutoUpdater(log);
  if (!autoUpdater) return false;

  updateCheckStarted = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log.info?.('[electron-updater] checking for updates');
  });
  autoUpdater.on('update-available', (info) => {
    const version = info?.version || 'unknown';
    latestUpdateVersion = version;
    log.info?.(`[electron-updater] update available: ${version}`);
    sendSplashUpdateProgress(getSplashWindow, {
      state: 'available',
      version,
      percent: 0,
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    log.info?.(`[electron-updater] current version is latest: ${info?.version || app.getVersion()}`);
  });
  autoUpdater.on('error', (err) => {
    log.warn?.(`[electron-updater] update check failed: ${err?.message || err}`);
    sendSplashUpdateProgress(getSplashWindow, {
      state: 'error',
      message: err?.message || String(err),
    });
  });
  autoUpdater.on('download-progress', (progress = {}) => {
    const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : 0;
    sendSplashUpdateProgress(getSplashWindow, {
      state: 'downloading',
      version: latestUpdateVersion,
      percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });
  autoUpdater.on('update-downloaded', async (info) => {
    const version = info?.version || 'latest';
    log.info?.(`[electron-updater] update downloaded: ${version}`);
    const splashStillVisible = sendSplashUpdateProgress(getSplashWindow, {
      state: 'downloaded',
      version,
      percent: 100,
    });
    if (splashStillVisible) {
      autoUpdater.quitAndInstall(false, true);
      return;
    }

    const owner = getMainWindow?.();
    const { response } = await dialog.showMessageBox(owner && !owner.isDestroyed() ? owner : undefined, {
      type: 'info',
      buttons: ['Restart now', 'Install on quit'],
      defaultId: 0,
      cancelId: 1,
      message: `Hydra ${version} is ready to install.`,
      detail: 'Restart Hydra to switch to the newest packaged version.',
    });
    if (response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn?.(`[electron-updater] checkForUpdates failed: ${err?.message || err}`);
    });
  }, UPDATE_CHECK_DELAY_MS);
  return true;
}
