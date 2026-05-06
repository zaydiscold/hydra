/**
 * Hydra Electron — Shared Runtime State
 *
 * Mutable singleton shared between main.js and app modules.
 */

// ─── Mutable state ───────────────────────────────────────────────────────────
const state = {
  mainWindow: null,
  splashWindow: null,
  tray: null,
  gracefulShutdown: null,
  windowURL: null,
  expressPort: null,
  forceQuit: false,
  closePromptPending: false,
  shuttingDown: false,
  // True while the strict splash → main sequence is in progress. Gates the
  // activate / second-instance / tray-respawn handlers so they don't race-spawn
  // main while the splash is still up. Cleared once main is shown.
  bootingSplash: true,
};
export const trackedChildren = new Set();

const get = key => state[key];
const set = key => value => { state[key] = value; };

export const getMainWindow = () => get('mainWindow');
export const getSplashWindow = () => get('splashWindow');
export const getTray = () => get('tray');
export const getGracefulShutdown = () => get('gracefulShutdown');
export const getWindowURL = () => get('windowURL');
export const getExpressPort = () => get('expressPort');
export const getForceQuit = () => get('forceQuit');
export const getClosePromptPending = () => get('closePromptPending');
export const getShuttingDown = () => get('shuttingDown');
export const getBootingSplash = () => get('bootingSplash');

export const setMainWindow = set('mainWindow');
export const setSplashWindow = set('splashWindow');
export const setTray = set('tray');
export const setGracefulShutdown = set('gracefulShutdown');
export const setWindowURL = set('windowURL');
export const setExpressPort = set('expressPort');
export const setForceQuit = set('forceQuit');
export const setClosePromptPending = set('closePromptPending');
export const setShuttingDown = set('shuttingDown');
export const setBootingSplash = set('bootingSplash');
