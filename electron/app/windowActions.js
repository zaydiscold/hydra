import { app, shell } from 'electron';
import { EXTERNAL_URL_ALLOWLIST } from './env.js';
import { getBootingSplash, getMainWindow, getWindowURL, setMainWindow } from './state.js';

function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' && EXTERNAL_URL_ALLOWLIST.has(parsed.hostname);
  } catch (err) {
    console.warn(`[electron] invalid external URL blocked: ${rawUrl} (${err?.message || err})`);
    return false;
  }
}

export async function openExternalUrl(rawUrl) {
  if (!isAllowedExternalUrl(rawUrl)) {
    console.warn(`[electron] blocked external URL: ${rawUrl}`);
    return false;
  }
  try {
    await shell.openExternal(rawUrl);
    return true;
  } catch (err) {
    console.warn(`[electron] failed to open external URL ${rawUrl}: ${err?.message || err}`);
    return false;
  }
}

export async function showAndFocusMainWindow() {
  if (getBootingSplash()) {
    console.log('[electron] showAndFocusMainWindow ignored — boot in progress');
    return;
  }
  if (process.platform === 'darwin') app.dock?.show();
  const w = getMainWindow();
  if (w && !w.isDestroyed()) {
    if (!w.isVisible()) w.show();
    if (w.isMinimized()) w.restore();
    w.focus();
    return;
  }
  const url = getWindowURL();
  if (!url) {
    console.warn('[electron] tray click: no windowURL cached, cannot respawn');
    return;
  }
  const { createMainWindow } = await import('./windows.js');
  const fresh = createMainWindow({ show: true });
  setMainWindow(fresh);
  fresh.loadURL(url).catch(err => console.error('[electron] respawn loadURL failed:', err.message));
}
