/**
 * True when the user should establish or refresh a dashboard session before session-backed actions.
 * @param {string} [sessionStatus]
 * @param {{ hasCredentials?: boolean }} [options] - When hasCredentials is true, `unknown` (cookie without vault expiry) also counts as needing attention.
 */
export function accountNeedsSession(sessionStatus, options = {}) {
  const hasCredentials = !!options.hasCredentials;
  if (sessionStatus === 'error') return true;
  if (sessionStatus === 'expired' || sessionStatus === 'none') return true;
  if (hasCredentials && sessionStatus === 'unknown') return true;
  return false;
}
