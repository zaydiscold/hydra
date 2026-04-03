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
    const unclear = account.sessionStatus === 'unknown';
    return {
      badgeVariant: 'low',
      badgeLabel: unclear ? 'SESSION UNCLEAR' : 'SIGN IN',
      isReady: false,
    };
  }

  if (account.sessionStatus === 'expiring' && account.status === 'ok') {
    return {
      badgeVariant: 'low',
      badgeLabel: 'EXPIRING',
      isReady: false,
    };
  }

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
