import { app, Menu, dialog, shell } from 'electron';

const isMac = process.platform === 'darwin';

const REPO_URL = 'https://github.com/zaydiscold/hydra';
const ISSUES_URL = `${REPO_URL}/issues/new`;

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
            const { clipboard } = await import('electron');
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
            clipboard.writeText(`${url}/v1`);
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
          accelerator: 'CmdOrCtrl+/',
          click: async () => { await openExternalUrl(REPO_URL); },
        },
        {
          label: 'Report an Issue…',
          click: async () => { await openExternalUrl(ISSUES_URL); },
        },
        { type: 'separator' },
        {
          label: 'Diagnostics',
          accelerator: 'CmdOrCtrl+D',
          click: navigateToDiagnostics,
        },
        {
          label: 'Show Logs Folder',
          click: () => { shell.openPath(app.getPath('logs')); },
        },
        {
          label: 'Show Data Folder',
          click: () => { shell.openPath(app.getPath('userData')); },
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
                // Lazy import to avoid pulling clipboard into module scope
                import('electron').then(({ clipboard }) => clipboard.writeText(info));
              }
            });
          },
        },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
