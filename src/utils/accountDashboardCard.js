import { accountNeedsSession } from './accountSession';

/**
 * Dashboard account card badge + readiness (client-derived from GET /api/dashboard fields).
 * @param {object} account - Dashboard account row (snapshot + vault meta)
 * @returns {{ badgeVariant: 'ok'|'error'|'low'|'neutral', badgeLabel: string, subtitle?: string, isReady: boolean }}
 */
export function getAccountDashboardCardState(account) {
  const hasCredentials = !!account.hasCredentials;
  const needsSession = accountNeedsSession(account.sessionStatus, { hasCredentials });

  if (account.sessionDecryptFailed || account.sessionStatus === 'error') {
    return {
      badgeVariant: 'error',
      badgeLabel: 'SESSION UNREADABLE',
      subtitle: 'Vault session could not be decrypted — fix local secrets or use Nuclear Reset',
      isReady: false,
    };
  }

  if (account.status === 'error') {
    const noKey =
      !account.hasManagementKey
      || (typeof account.error === 'string' && /management key/i.test(account.error));
    return {
      badgeVariant: 'error',
      badgeLabel: noKey ? 'NEEDS KEY' : 'SYNC FAILED',
      subtitle: typeof account.error === 'string' ? account.error : undefined,
      isReady: false,
    };
  }

  if (hasCredentials && needsSession) {
    return {
      badgeVariant: 'low',
      badgeLabel: 'SIGN IN',
      isReady: false,
    };
  }

  // 'unknown' = async Clerk probe still in flight — show neutral CHECKING badge, not SIGN IN.
  if (account.sessionStatus === 'unknown') {
    return {
      badgeVariant: 'neutral',
      badgeLabel: 'CHECKING…',
      isReady: false,
    };
  }

  // Note: 'expiring' only appears briefly (JWT has <2.5min left but not expired yet).
  // Probe resolves to 'active' or 'expired' within seconds.

  if (account.status === 'ok' && account.hasManagementKey) {
    return {
      badgeVariant: 'ok',
      badgeLabel: 'SYNCED',
      isReady: true,
    };
  }

  if (account.status === 'ok' && !account.hasManagementKey) {
    return {
      badgeVariant: 'error',
      badgeLabel: 'NEEDS KEY',
      isReady: false,
    };
  }

  return {
    badgeVariant: 'neutral',
    badgeLabel: 'CHECK ACCOUNT',
    isReady: false,
  };
}
