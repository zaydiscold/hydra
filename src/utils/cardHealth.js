/**
 * Unified card health logic — drives both the status dot and the border color on AccountCard.
 *
 * healthy  = session active   + management key provisioned  → green  (fully operational)
 * partial  = management key   + session dead/missing         → yellow (API works, Clerk session gone)
 * dead     = no management key                               → red    (can't use OpenRouter API)
 *
 * Both the status dot and the card border use this same value so they never contradict each other.
 */
export function getCardHealth(sessionStatus, hasManagementKey, hasError = false) {
  if (hasError) return 'dead';
  const sessionActive = sessionStatus === 'active' || sessionStatus === 'expiring';
  if (sessionActive && hasManagementKey) return 'healthy';
  if (hasManagementKey) return 'partial';
  return 'dead';
}

export const CARD_HEALTH_COLORS = {
  healthy: {
    dot:    'var(--status-success)',
    border: 'rgba(0,255,136,0.25)',
    glow:   '0 0 6px var(--status-success)',
  },
  partial: {
    dot:    'var(--status-warning)',
    border: 'var(--status-warning)',
    glow:   'none',
  },
  dead: {
    dot:    'var(--status-error)',
    border: 'var(--status-error)',
    glow:   'none',
  },
};
