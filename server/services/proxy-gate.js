/**
 * Proxy kill switch state.
 * Shared between server/index.js (middleware) and SystemController (toggle endpoint).
 * Lives here to avoid circular imports.
 */

let _enabled = true;

export const proxyGate = {
  get enabled() { return _enabled; },
  enable()  { _enabled = true; },
  disable() { _enabled = false; },
  set(val)  { _enabled = !!val; },
};
