import { app, Menu } from 'electron';

const isMac = process.platform === 'darwin';

export function setupAppMenu({
  isDev = false,
  openExternalUrl = async () => false,
  getServerUrl = () => null,
  showAndFocusMainWindow = () => {},
  hideWindow = () => {},
  quitCompletely = () => app.quit(),
} = {}) {
  const template = [
    ...(isMac ? [{
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Show Hydra', click: showAndFocusMainWindow },
        { label: 'Hide Window', click: hideWindow },
        { label: 'Quit Hydra Completely', click: quitCompletely },
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
        { role: 'forceReload' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
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
        { label: 'Show Hydra', click: showAndFocusMainWindow },
        { label: 'Hide Window', click: hideWindow },
        {
          label: 'Copy Proxy URL',
          click: async (_item, focusedWindow) => {
            const { clipboard } = await import('electron');
            clipboard.writeText(`${getServerUrl() || 'http://localhost:3001'}/v1`);
            focusedWindow?.webContents?.send?.('native:copied-proxy-url');
          },
        },
        { type: 'separator' },
        { label: 'Quit Hydra Completely', click: quitCompletely },
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
