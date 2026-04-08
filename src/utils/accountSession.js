/**
 * True when the user needs to re-authenticate.
 * 'unknown' means the async Clerk probe is still in flight (JWT stale, __client being checked).
 * It does NOT mean re-auth is needed — wait for the probe to resolve to 'expired' before acting.
 */
export function accountNeedsSession(sessionStatus, options = {}) {
  if (sessionStatus === 'error') return true;
  if (sessionStatus === 'expired' || sessionStatus === 'none') return true;
  return false;
}
