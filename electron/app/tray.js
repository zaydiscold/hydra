/**
 * Hydra Electron — Tray Icon
 *
 * Keeps Hydra reachable from the menu bar even when the main
 * window is hidden ("Keep Proxy Running" in the close dialog).
 */
import { app, Tray, Menu, nativeImage, shell } from 'electron';
import { ICON_PATH } from './env.js';
import { mainWindow, windowURL, tray, setTray, setForceQuit, showAndFocusMainWindow } from './state.js';

export function createTray() {
  if (tray && !tray.isDestroyed()) return tray;

  let img = nativeImage.createFromPath(ICON_PATH);
  if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 });
  const t = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  t.setToolTip('Hydra — local OpenRouter proxy');

  const rebuildMenu = () => {
    t.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Hydra', click: showAndFocusMainWindow },
      { type: 'separator' },
      { label: `Status: ${windowURL ? 'proxy running' : 'starting'}`, enabled: false },
      { label: windowURL ? `Proxy URL: ${windowURL}/v1` : 'Proxy URL: starting', enabled: false },
      { type: 'separator' },
      { label: 'Open Logs Folder', click: () => shell.openPath(app.getPath('logs')) },
      { label: 'Open Data Folder', click: () => shell.openPath(app.getPath('userData')) },
      { type: 'separator' },
      {
        label: 'Hide Window',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
        },
      },
      {
        label: 'Quit Hydra Completely',
        click: () => {
          setForceQuit(true);
          app.quit();
        },
      },
    ]));
  };
  rebuildMenu();
  t.on('click', showAndFocusMainWindow);
  setTray(t);
  return t;
}
