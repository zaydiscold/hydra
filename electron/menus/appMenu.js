import { app, Menu, dialog } from 'electron';

const isMac = process.platform === 'darwin';

export function setupAppMenu({
  isDev = false,
  openExternalUrl = async () => false,
  getServerUrl = () => null,
  showAndFocusMainWindow = () => {},
  hideWindow = () => {},
  quitCompletely = () => app.quit(),
  navigateToSettings = () => {},
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
            const { clipboard } = await import('electron');
            clipboard.writeText(`${getServerUrl() || 'http://localhost:3001'}/v1`);
            focusedWindow?.webContents?.send?.('native:copied-proxy-url');
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
          click: async () => {
            await openExternalUrl('https://github.com/zaydiscold/hydra');
          },
        },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
