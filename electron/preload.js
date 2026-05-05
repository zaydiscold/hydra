/**
 * Hydra Electron Preload Script
 *
 * Minimal, secure bridge between the Electron main process and the renderer.
 * contextIsolation=true, nodeIntegration=false, sandbox=true.
 *
 * Exposes a controlled API via contextBridge — no fs, no child_process,
 * no require() leaks into the renderer.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('hydraNative', {
  appVersion: () => ipcRenderer.invoke('native:get-version'),
  appPaths: () => ipcRenderer.invoke('native:get-paths'),
  openPath: (targetPath) => ipcRenderer.invoke('native:open-path', targetPath),
  platform: () => process.platform,
});
