import { OR_BASE } from '../config.js';
import { throwIfAborted } from '../lib/abort.js';
import { recordUpstreamFailure, recordUpstreamHttpResult } from './upstream-health.js';

const PROBE_PATH = '/api/v1/models';
const DEFAULT_TIMEOUT_MS = 2500;
let probeInFlight = null;

function startProbe(timeoutMs) {
  const controller = new AbortController();
  const state = {
    controller,
    promise: null,
    settled: false,
    subscribers: new Set(),
  };

  state.promise = (async () => {
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    timeoutId.unref?.();
    try {
      const res = await fetch(`${OR_BASE}${PROBE_PATH}`, {
        method: 'GET',
        signal: controller.signal,
      });
      return recordUpstreamHttpResult({
        statusCode: res.status,
        source: 'OpenRouter reachability probe',
      });
    } catch (err) {
      recordUpstreamFailure(err);
      return false;
    } finally {
      clearTimeout(timeoutId);
      state.settled = true;
      if (probeInFlight === state) probeInFlight = null;
    }
  })();

  probeInFlight = state;
  return state;
}

function waitForProbe(state, signal) {
  throwIfAborted(signal);

  const subscriber = Symbol('OpenRouter reachability subscriber');
  state.subscribers.add(subscriber);
  let finished = false;

  return new Promise((resolve, reject) => {
    const detach = () => {
      signal?.removeEventListener('abort', onAbort);
      state.subscribers.delete(subscriber);
      if (!state.settled && state.subscribers.size === 0) {
        state.controller.abort(new Error('OpenRouter reachability probe has no remaining subscribers'));
      }
    };
    const settle = (callback, value) => {
      if (finished) return;
      finished = true;
      detach();
      callback(value);
    };
    const onAbort = () => {
      settle(reject, signal.reason ?? new Error('OpenRouter reachability subscriber aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    state.promise.then(
      (result) => settle(resolve, result),
      (err) => settle(reject, err),
    );
  });
}

export async function probeOpenRouterReachability({ timeoutMs = DEFAULT_TIMEOUT_MS, signal = null } = {}) {
  const state = probeInFlight ?? startProbe(timeoutMs);
  return waitForProbe(state, signal);
}
