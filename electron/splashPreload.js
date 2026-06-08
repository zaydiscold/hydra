// Sandboxed Electron preloads run as plain JavaScript, not ESM.
const { contextBridge, ipcRenderer } = require('electron');

const UPDATE_PROGRESS_CHANNEL = 'hydra-update-progress';
const DIAGNOSTICS_CHANNEL = 'hydra-splash-diagnostics';
// Fire-and-forget channels for the hold-to-skip affordance. `splash:skip`
// asks the main process to tear the splash down early (reusing the timed
// dismissal path); `splash:set-interactive` lets the renderer momentarily
// disable the window's click-through so a real mouse press can land on the
// Skip button hit area without the splash ever stealing OS focus.
const SKIP_CHANNEL = 'splash:skip';
const SET_INTERACTIVE_CHANNEL = 'splash:set-interactive';

contextBridge.exposeInMainWorld('hydraSplash', {
  onUpdateProgress: (callback) => {
    if (typeof callback !== 'function') return null;
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on(UPDATE_PROGRESS_CHANNEL, wrapped);
    return wrapped;
  },
  offUpdateProgress: (wrapped) => {
    if (typeof wrapped === 'function') {
      ipcRenderer.removeListener(UPDATE_PROGRESS_CHANNEL, wrapped);
    }
  },
  reportDiagnostics: (payload) => {
    if (!payload || typeof payload !== 'object') return;
    ipcRenderer.send(DIAGNOSTICS_CHANNEL, payload);
  },
  // Hold-to-skip completed (full 3s hold) — dismiss the splash early.
  requestSkip: () => {
    ipcRenderer.send(SKIP_CHANNEL);
  },
  // Toggle the splash's click-through so the Skip button hit area can take a
  // real press while the rest of the splash stays transparent to the mouse.
  setInteractive: (interactive) => {
    ipcRenderer.send(SET_INTERACTIVE_CHANNEL, Boolean(interactive));
  },
});
