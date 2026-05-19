/**
 * Hydra Electron Preload Script
 *
 * Minimal, secure bridge between the Electron main process and the renderer.
 * contextIsolation=true, nodeIntegration=false, sandbox=true.
 *
 * All IPC calls return a Result type:
 *   { ok: true,  data }  on success
 *   { ok: false, error, code? }  on failure
 *
 * The renderer doesn't need try/catch around invoke() — it just checks `result.ok`.
 *
 * Exposes a controlled API via contextBridge — no fs, no child_process,
 * no require() leaks into the renderer.
 */
import { contextBridge, ipcRenderer } from 'electron';

const MENU_EVENT_CHANNELS = new Set([
  'native:copied-proxy-url',
  'native:copy-proxy-url-not-ready',
  'native:clipboard-copy-failed',
]);

contextBridge.exposeInMainWorld('hydraNative', {
  /**
   * App version string.
   * @returns {Promise<{ok:true,data:string}|{ok:false,error:string,code?:string}>}
   */
  appVersion: () => ipcRenderer.invoke('native:get-version'),

  /**
   * Native path availability metadata. Real filesystem paths stay in main.
   * @returns {Promise<{ok:true,data:object}|{ok:false,error:string,code?:string}>}
   */
  appPaths: () => ipcRenderer.invoke('native:get-paths'),

  /**
   * Native runtime status: server URL, embedded mode, packaging state.
   * @returns {Promise<{ok:true,data:object}|{ok:false,error:string,code?:string}>}
   */
  status: () => ipcRenderer.invoke('native:get-status'),

  /**
   * Open a path in the OS file manager. Path must be inside one of the
   * allowed roots (userData, logs, downloads, documents) — see main.js.
   * @param {string} targetPath
   * @returns {Promise<{ok:true,data:true}|{ok:false,error:string,code?:string}>}
   */
  openPath: (targetPath) => ipcRenderer.invoke('native:open-path', targetPath),

  /**
   * Open a known app-owned folder without exposing its absolute path to the renderer.
   * @param {'userData'|'logs'} location
   * @returns {Promise<{ok:true,data:true}|{ok:false,error:string,code?:string}>}
   */
  openAppLocation: (location) => ipcRenderer.invoke('native:open-app-location', location),

  /**
   * OS platform string (darwin/win32/linux).
   * @returns {Promise<{ok:true,data:string}|{ok:false,error:string,code?:string}>}
   */
  platform: () => ipcRenderer.invoke('native:platform'),

  /**
   * Persist the lock-screen JWT outside renderer localStorage so packaged
   * Electron survives random localhost port changes across launches.
   */
  getAuthToken: () => ipcRenderer.invoke('native:auth-token:get'),
  authTokenStatus: () => ipcRenderer.invoke('native:auth-token:status'),
  setAuthToken: (token) => ipcRenderer.invoke('native:auth-token:set', token),
  clearAuthToken: () => ipcRenderer.invoke('native:auth-token:clear'),

  /**
   * Hide the app window while keeping the embedded server/proxy online.
   * @returns {Promise<{ok:true,data:true}|{ok:false,error:string,code?:string}>}
   */
  hideWindow: () => ipcRenderer.invoke('native:hide-window'),

  /**
   * Quit Hydra and stop the embedded server/proxy.
   * @returns {Promise<{ok:true,data:true}|{ok:false,error:string,code?:string}>}
   */
  quitApp: () => ipcRenderer.invoke('native:quit-app'),

  /**
   * Frameless-window controls for Hydra's renderer-owned app chrome.
   */
  minimizeWindow: () => ipcRenderer.invoke('native:window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('native:window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('native:window:close'),

  /**
   * Listen for main-process navigation requests (e.g., from app menu).
   * Returns the wrapped listener so the caller can pass it to offNavigate
   * to remove the subscription. Without this the renderer accumulates a
   * fresh listener on every component remount → memory leak + double-fire.
   * @param {(path: string) => void} callback
   * @returns {(event: any, path: string) => void} the wrapped listener
   */
  onNavigate: (callback) => {
    const wrapped = (_event, path) => callback(path);
    ipcRenderer.on('navigate', wrapped);
    return wrapped;
  },
  /** Remove a listener previously registered via onNavigate. */
  offNavigate: (wrapped) => {
    if (typeof wrapped === 'function') ipcRenderer.removeListener('navigate', wrapped);
  },

  /**
   * Listen for main-process menu action feedback events.
   * @param {(event: {type:string,payload:any}) => void} callback
   * @returns {Array<[string, Function]>} listener handles for offMenuEvent
   */
  onMenuEvent: (callback) => {
    const listeners = [];
    for (const channel of MENU_EVENT_CHANNELS) {
      const wrapped = (_event, payload) => callback({ type: channel, payload });
      ipcRenderer.on(channel, wrapped);
      listeners.push([channel, wrapped]);
    }
    return listeners;
  },
  /** Remove listeners previously registered via onMenuEvent. */
  offMenuEvent: (listeners) => {
    if (!Array.isArray(listeners)) return;
    for (const [channel, wrapped] of listeners) {
      if (MENU_EVENT_CHANNELS.has(channel) && typeof wrapped === 'function') {
        ipcRenderer.removeListener(channel, wrapped);
      }
    }
  },

  // ── User preferences (theme, telemetry, biometric, …) ──────────────────
  prefsGetAll: () => ipcRenderer.invoke('native:prefs:get-all'),
  prefsSet: (key, value) => ipcRenderer.invoke('native:prefs:set', key, value),

  // ── Biometric unlock (#11) ─────────────────────────────────────────────
  biometricDescribe: () => ipcRenderer.invoke('native:biometric:describe'),
  biometricPrompt: (reason) => ipcRenderer.invoke('native:biometric:prompt', reason),
});
