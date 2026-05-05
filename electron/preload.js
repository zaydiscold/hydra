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

contextBridge.exposeInMainWorld('hydraNative', {
  /**
   * App version string.
   * @returns {Promise<{ok:true,data:string}|{ok:false,error:string,code?:string}>}
   */
  appVersion: () => ipcRenderer.invoke('native:get-version'),

  /**
   * Native paths object: { userData, home, logs, downloads, documents }
   * @returns {Promise<{ok:true,data:object}|{ok:false,error:string,code?:string}>}
   */
  appPaths: () => ipcRenderer.invoke('native:get-paths'),

  /**
   * Open a path in the OS file manager. Path must be inside one of the
   * allowed roots (userData, logs, downloads, documents) — see main.js.
   * @param {string} targetPath
   * @returns {Promise<{ok:true,data:true}|{ok:false,error:string,code?:string}>}
   */
  openPath: (targetPath) => ipcRenderer.invoke('native:open-path', targetPath),

  /**
   * OS platform string (darwin/win32/linux).
   * @returns {Promise<{ok:true,data:string}|{ok:false,error:string,code?:string}>}
   */
  platform: () => ipcRenderer.invoke('native:platform'),

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
});
