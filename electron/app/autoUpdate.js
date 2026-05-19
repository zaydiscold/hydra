import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';

let updateCheckStarted = false;

function getAutoUpdater(log) {
  try {
    return electronUpdater.autoUpdater;
  } catch (err) {
    log?.warn?.(`[electron-updater] updater unavailable: ${err?.message || err}`);
    return null;
  }
}

export function setupAutoUpdates({ isDev, getMainWindow, log = console } = {}) {
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
    log.info?.(`[electron-updater] update available: ${info?.version || 'unknown'}`);
  });
  autoUpdater.on('update-not-available', (info) => {
    log.info?.(`[electron-updater] current version is latest: ${info?.version || app.getVersion()}`);
  });
  autoUpdater.on('error', (err) => {
    log.warn?.(`[electron-updater] update check failed: ${err?.message || err}`);
  });
  autoUpdater.on('update-downloaded', async (info) => {
    const version = info?.version || 'latest';
    log.info?.(`[electron-updater] update downloaded: ${version}`);
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
  }, 5000);
  return true;
}
