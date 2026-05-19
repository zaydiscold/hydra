import { app, Menu, dialog, shell } from 'electron';

const isMac = process.platform === 'darwin';

const REPO_URL = 'https://github.com/zaydiscold/hydra';
const ISSUES_URL = `${REPO_URL}/issues/new`;

async function openAppFolder(location, label) {
  try {
    const result = await shell.openPath(app.getPath(location));
    if (result) console.warn(`[electron] ${label} failed: ${result}`);
  } catch (err) {
    console.warn(`[electron] ${label} failed: ${err?.message || err}`);
  }
}

async function copyTextToClipboard(text, label, focusedWindow) {
  try {
    const { clipboard } = await import('electron');
    clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn(`[electron] ${label} failed: ${err?.message || err}`);
    focusedWindow?.webContents?.send?.('native:clipboard-copy-failed', { label, message: err?.message || String(err) });
    return false;
  }
}

export function setupAppMenu({
  isDev = false,
  openExternalUrl = async () => false,
  getServerUrl = () => null,
  showAndFocusMainWindow = () => {},
  hideWindow = () => {},
  quitCompletely = () => app.quit(),
  navigateToSettings = () => {},
  navigateToDiagnostics = () => {},
} = {}) {
  const name = app.getName();
  const template = [
    ...(isMac ? [{
      label: name,
      submenu: [
        {
          label: `About ${name}`,
          click: (_item, focusedWindow) => {
            // Custom About panel instead of Electron's generic dialog
            const details = [
              `${name} — local OpenRouter proxy & account manager`,
              '',
              `Version: ${app.getVersion()}`,
              `Electron: ${process.versions.electron}`,
              `Chrome: ${process.versions.chrome}`,
              `Node.js: ${process.versions.node}`,
              `Platform: ${process.platform} ${process.arch}`,
              '',
              'License: MIT',
              'https://github.com/zaydiscold/hydra',
            ].join('\n');
            dialog.showMessageBox(focusedWindow || undefined, {
              type: 'info',
              title: `About ${name}`,
              message: name,
              detail: details,
              buttons: ['OK'],
            });
          },
        },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: navigateToSettings },
        { type: 'separator' },
        { label: 'Show Hydra', accelerator: 'CmdOrCtrl+0', click: showAndFocusMainWindow },
        { label: 'Hide Window', accelerator: 'CmdOrCtrl+H', click: hideWindow },
        { label: 'Quit Hydra Completely', accelerator: 'CmdOrCtrl+Alt+Q', click: quitCompletely },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(isDev || process.env.HYDRA_DEBUG_MENU === '1' ? [
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
        ] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Hydra',
      submenu: [
        { label: 'Show Hydra', accelerator: 'CmdOrCtrl+0', click: showAndFocusMainWindow },
        { label: 'Hide Window', accelerator: 'CmdOrCtrl+H', click: hideWindow },
        {
          label: 'Copy Proxy URL',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: async (_item, focusedWindow) => {
            // Bug fix: getServerUrl() returns the real chosen port (random
            // in packaged builds). The previous `|| 'http://localhost:3001'`
            // fallback would silently copy the WRONG url if the server URL
            // wasn't set yet. Refuse to copy a stale value — log and toast
            // the renderer so the user knows to retry once boot finishes.
            const url = getServerUrl();
            if (!url) {
              focusedWindow?.webContents?.send?.('native:copy-proxy-url-not-ready');
              return;
            }
            if (await copyTextToClipboard(`${url}/v1`, 'copy proxy URL', focusedWindow)) {
              focusedWindow?.webContents?.send?.('native:copied-proxy-url');
            }
          },
        },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: navigateToSettings },
        { type: 'separator' },
        { label: 'Quit Hydra Completely', accelerator: 'CmdOrCtrl+Alt+Q', click: quitCompletely },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
        ] : [{ role: 'close' }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Hydra Documentation',
          accelerator: 'CmdOrCtrl+/',
          click: async () => { await openExternalUrl(REPO_URL); },
        },
        {
          label: 'Report an Issue…',
          click: async () => { await openExternalUrl(ISSUES_URL); },
        },
        { type: 'separator' },
        {
          label: 'Diagnostics in Settings',
          accelerator: 'CmdOrCtrl+D',
          click: navigateToDiagnostics,
        },
        {
          label: 'Show Logs Folder',
          click: () => { openAppFolder('logs', 'show logs folder'); },
        },
        {
          label: 'Show Data Folder',
          click: () => { openAppFolder('userData', 'show data folder'); },
        },
        { type: 'separator' },
        {
          label: 'Show Build Info',
          click: (_item, focusedWindow) => {
            const info = [
              `Version:     ${app.getVersion()}`,
              `Electron:    ${process.versions.electron}`,
              `Chrome:      ${process.versions.chrome}`,
              `Node.js:     ${process.versions.node}`,
              `V8:          ${process.versions.v8}`,
              `Platform:    ${process.platform} ${process.arch}`,
              `Packaged:    ${app.isPackaged}`,
              `User Data:   ${app.getPath('userData')}`,
              `Logs:        ${app.getPath('logs')}`,
            ].join('\n');
            dialog.showMessageBox(focusedWindow || undefined, {
              type: 'info',
              title: 'Hydra — Build Info',
              message: 'Hydra Build Information',
              detail: info,
              buttons: ['OK', 'Copy'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            }).then(({ response }) => {
              if (response === 1) {
                void copyTextToClipboard(info, 'copy build info', focusedWindow);
              }
            }).catch((err) => {
              console.warn(`[electron] build info dialog failed: ${err?.message || err}`);
            });
          },
        },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
