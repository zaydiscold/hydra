/**
 * Hydra Native Bridge — Renderer Wrapper
 *
 * Single source of truth for talking to `window.hydraNative` (the Electron
 * preload bridge). Every preload method returns the same Result envelope:
 *
 *   { ok: true,  data }
 *   { ok: false, error: string, code?: string }
 *
 * Every call site in the renderer used to do this:
 *
 *   try { const v = await window.hydraNative.appVersion(); }
 *   catch { ... }
 *
 * That `try/catch` only fires if the IPC channel itself rejects — but the
 * handlers never reject, they return `{ok:false}`. So errors were silently
 * swallowed (per Sweep finding #77 in `.swarm-working.md`).
 *
 * This module wraps every bridge method so:
 *   • a missing bridge returns a NotInElectron error (typed, no crash)
 *   • an `{ok:false}` response THROWS a `NativeError` the caller can catch
 *   • callers can use plain `await native.appVersion()` and trust the value
 *
 * Usage:
 *   import { native, isElectron, useNativeInfo } from '../lib/native';
 *   const version = await native.appVersion();   // string | throws
 *
 * For React components there's a `useNativeInfo()` hook below that wraps
 * the common "load version + platform + paths once on mount" pattern.
 */

import { useEffect, useState } from 'react';

export class NativeError extends Error {
  constructor(message, { code, method } = {}) {
    super(message || 'Native bridge error');
    this.name = 'NativeError';
    this.code = code || 'NATIVE_ERROR';
    this.method = method || null;
  }
}

export class NotInElectronError extends NativeError {
  constructor(method) {
    super(`Not in Electron — window.hydraNative is unavailable (called ${method})`, {
      code: 'NOT_IN_ELECTRON',
      method,
    });
    this.name = 'NotInElectronError';
  }
}

/** True when running inside the packaged Electron renderer. */
export function isElectron() {
  return typeof window !== 'undefined' && Boolean(window.hydraNative);
}

/**
 * Invoke a preload method by name and unwrap the Result envelope.
 * Throws `NativeError` on `ok:false` or `NotInElectronError` if the bridge
 * isn't available — so the caller's existing try/catch becomes useful.
 *
 * @template T
 * @param {string} method — bridge method name (e.g. 'appVersion')
 * @param  {...any} args  — forwarded to the bridge call
 * @returns {Promise<T>}
 */
export async function invokeNative(method, ...args) {
  if (!isElectron()) throw new NotInElectronError(method);
  const fn = window.hydraNative[method];
  if (typeof fn !== 'function') {
    throw new NativeError(`Bridge method missing: ${method}`, { code: 'NO_METHOD', method });
  }
  let result;
  try {
    result = await fn.apply(window.hydraNative, args);
  } catch (e) {
    // IPC channel itself rejected (rare — usually means main was destroyed)
    throw new NativeError(e?.message || 'IPC channel error', { code: 'IPC_REJECTED', method });
  }
  if (!result || typeof result !== 'object') {
    throw new NativeError(`Bridge returned non-Result value from ${method}`, {
      code: 'BAD_RESULT',
      method,
    });
  }
  if (result.ok) return result.data;
  throw new NativeError(result.error || `Native call ${method} failed`, {
    code: result.code || 'NATIVE_ERROR',
    method,
  });
}

/**
 * Pre-bound, type-friendly facade. Each method returns the unwrapped data
 * (or throws). Methods mirror `electron/preload.js` 1:1.
 */
export const native = {
  appVersion: () => invokeNative('appVersion'),
  appPaths: () => invokeNative('appPaths'),
  status: () => invokeNative('status'),
  platform: () => invokeNative('platform'),
  openPath: (target) => invokeNative('openPath', target),
  getAuthToken: () => invokeNative('getAuthToken'),
  authTokenStatus: () => invokeNative('authTokenStatus'),
  setAuthToken: (token) => invokeNative('setAuthToken', token),
  clearAuthToken: () => invokeNative('clearAuthToken'),
  hideWindow: () => invokeNative('hideWindow'),
  quitApp: () => invokeNative('quitApp'),
  // Preferences (telemetry, biometric, theme, …)
  prefsGetAll: () => invokeNative('prefsGetAll'),
  prefsSet: (key, value) => invokeNative('prefsSet', key, value),
  // Biometric (#11)
  biometricDescribe: () => invokeNative('biometricDescribe'),
  biometricPrompt: (reason) => invokeNative('biometricPrompt', reason),
  /**
   * Pass-through; on-style listeners don't use the Result envelope.
   * Returns an unsubscribe function — call it in a `useEffect` cleanup
   * so component remounts don't accumulate listeners (the leak fixed in
   * the preload bridge `offNavigate` change).
   */
  onNavigate: (cb) => {
    if (!isElectron()) return () => {};
    const wrapped = window.hydraNative.onNavigate?.(cb);
    return () => {
      if (wrapped) window.hydraNative.offNavigate?.(wrapped);
    };
  },
};

/**
 * Variant that returns `null` instead of throwing — useful for "nice to
 * have" reads where you don't want to clutter the component with try/catch.
 *
 * @template T
 * @param {() => Promise<T>} call
 * @returns {Promise<T|null>}
 */
export async function tryNative(call) {
  try { return await call(); }
  catch (e) {
    if (e instanceof NotInElectronError) return null;
    // Bubble unexpected errors through console for visibility
    if (typeof console !== 'undefined') console.warn('[native] tryNative:', e);
    return null;
  }
}

/**
 * React hook: load `{version, platform, paths}` once on mount.
 * Returns `{ data, loading, error }`. `data` is `null` outside Electron.
 *
 * @returns {{
 *   data: { version: string|null, platform: string|null, paths: object|null }|null,
 *   loading: boolean,
 *   error: NativeError|null,
 * }}
 */
export function useNativeInfo() {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    let mounted = true;
    if (!isElectron()) {
      setState({ data: null, loading: false, error: null });
      return () => { mounted = false; };
    }
    (async () => {
      try {
        // Use Promise.all (not allSettled) — if all three throw together
        // the bridge is broken and we want to know. Each call is fast.
        const [version, platform, paths] = await Promise.all([
          tryNative(native.appVersion),
          tryNative(native.platform),
          tryNative(native.appPaths),
        ]);
        if (mounted) setState({ data: { version, platform, paths }, loading: false, error: null });
      } catch (e) {
        if (mounted) setState({ data: null, loading: false, error: e });
      }
    })();
    return () => { mounted = false; };
  }, []);
  return state;
}
