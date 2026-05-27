import { contextBridge, ipcRenderer } from 'electron';

const UPDATE_PROGRESS_CHANNEL = 'hydra-update-progress';
const DIAGNOSTICS_CHANNEL = 'hydra-splash-diagnostics';

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
});
