const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000;

const upstreamHealth = {
  status: 'unknown',
  checkedAt: null,
  lastOnlineAt: null,
  lastErrorAt: null,
  lastError: null,
  consecutiveFailures: 0,
};

function isoNow() {
  return new Date().toISOString();
}

function normalizeError(err) {
  if (!err) return 'Unknown upstream error';
  if (err.name === 'AbortError') return 'OpenRouter connectivity check timed out';
  return err.message || String(err);
}

export function recordUpstreamSuccess({ statusCode } = {}) {
  const now = isoNow();
  upstreamHealth.status = 'online';
  upstreamHealth.checkedAt = now;
  upstreamHealth.lastOnlineAt = now;
  upstreamHealth.lastError = null;
  upstreamHealth.consecutiveFailures = 0;
  if (statusCode != null) upstreamHealth.lastStatusCode = statusCode;
  else delete upstreamHealth.lastStatusCode;
}

export function recordUpstreamFailure(err, { statusCode } = {}) {
  const now = isoNow();
  upstreamHealth.status = 'offline';
  upstreamHealth.checkedAt = now;
  upstreamHealth.lastErrorAt = now;
  upstreamHealth.lastError = normalizeError(err);
  upstreamHealth.consecutiveFailures += 1;
  if (statusCode != null) upstreamHealth.lastStatusCode = statusCode;
  else delete upstreamHealth.lastStatusCode;
}

export function recordUpstreamHttpResult({ statusCode, source = 'OpenRouter reachability check' } = {}) {
  if (Number.isInteger(statusCode) && statusCode >= 500) {
    recordUpstreamFailure(new Error(`${source} returned HTTP ${statusCode}`), { statusCode });
    return false;
  }
  recordUpstreamSuccess({ statusCode });
  return true;
}

export function markUpstreamIdle() {
  upstreamHealth.status = 'unknown';
  upstreamHealth.checkedAt = null;
  upstreamHealth.lastError = null;
  upstreamHealth.consecutiveFailures = 0;
  delete upstreamHealth.lastStatusCode;
}

export function getUpstreamHealth({ staleAfterMs = DEFAULT_STALE_AFTER_MS, now = Date.now() } = {}) {
  const snapshot = { ...upstreamHealth };
  if (snapshot.checkedAt && snapshot.status === 'online') {
    const checkedAtMs = Date.parse(snapshot.checkedAt);
    if (Number.isFinite(checkedAtMs) && now - checkedAtMs > staleAfterMs) {
      snapshot.status = 'unknown';
      snapshot.stale = true;
    }
  }
  return snapshot;
}

export function shouldProbeUpstream({ minIntervalMs = 60 * 1000, now = Date.now() } = {}) {
  if (!upstreamHealth.checkedAt) return true;
  const checkedAtMs = Date.parse(upstreamHealth.checkedAt);
  if (!Number.isFinite(checkedAtMs)) return true;
  return now - checkedAtMs > minIntervalMs;
}

export function resetUpstreamHealthForTest() {
  upstreamHealth.status = 'unknown';
  upstreamHealth.checkedAt = null;
  upstreamHealth.lastOnlineAt = null;
  upstreamHealth.lastErrorAt = null;
  upstreamHealth.lastError = null;
  upstreamHealth.consecutiveFailures = 0;
  delete upstreamHealth.lastStatusCode;
}
