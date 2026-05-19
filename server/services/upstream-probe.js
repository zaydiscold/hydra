import { OR_BASE } from '../config.js';
import { recordUpstreamFailure, recordUpstreamHttpResult } from './upstream-health.js';

const PROBE_PATH = '/api/v1/models';
const DEFAULT_TIMEOUT_MS = 2500;
let probeInFlight = null;

export async function probeOpenRouterReachability({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (probeInFlight) return probeInFlight;

  probeInFlight = (async () => {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${OR_BASE}${PROBE_PATH}`, {
        method: 'GET',
        signal: ctrl.signal,
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
      probeInFlight = null;
    }
  })();

  return probeInFlight;
}
