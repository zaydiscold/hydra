/**
 * True when the user needs to re-authenticate.
 * 'unknown' means the async Clerk probe is still in flight (JWT stale, __client being checked).
 * It does NOT mean re-auth is needed — wait for the probe to resolve to 'expired' before acting.
 */
export function accountNeedsSession(sessionStatus) {
  if (sessionStatus === 'error') return true;
  if (sessionStatus === 'expired' || sessionStatus === 'none') return true;
  if (sessionStatus === 'unknown') return false; // probe in flight — don't force re-auth yet
  return false;
}

/** Probe is still in-flight; UI should avoid irreversible/session-gated actions. */
export function isSessionProbePending(sessionStatus) {
  return sessionStatus === 'unknown';
}

/** Session state is sufficiently alive to run key provisioning. */
export function canProvisionWithSession(sessionStatus) {
  return sessionStatus === 'active' || sessionStatus === 'expiring';
}
