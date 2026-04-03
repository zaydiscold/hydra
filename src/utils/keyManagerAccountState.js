import { accountNeedsSession } from './accountSession';

/**
 * @typedef {'credentials' | 'key_import' | 'oauth_session'} KeyManagerLane
 */

/**
 * @typedef {object} KeyManagerAccountRow
 * @property {string} id
 * @property {string} alias
 * @property {string} [email]
 * @property {string} [authMethod]
 * @property {boolean} [hasCredentials]
 * @property {boolean} [hasManagementKey]
 * @property {string} [sessionStatus]
 */

/**
 * Lane precedence: credentials (has stored email/password or OTP path) → oauth_session → key_import.
 * @param {KeyManagerAccountRow} account
 * @returns {KeyManagerLane}
 */
export function getKeyManagerLane(account) {
  if (account.hasCredentials) return 'credentials';
  if (account.authMethod === 'oauth') return 'oauth_session';
  return 'key_import';
}

/** @type {Record<KeyManagerLane, string>} */
export const KEY_MANAGER_LANE_LABELS = {
  credentials: 'Email sign-in',
  key_import: 'API key import',
  oauth_session: 'Session import',
};

/**
 * Human-readable session row for the account strip.
 * @param {string} [sessionStatus]
 */
export function formatSessionStatusLabel(sessionStatus) {
  if (!sessionStatus) return '—';
  const map = {
    none: 'No session',
    unknown: 'Session unclear',
    expired: 'Session expired',
    expiring: 'Session expiring',
    active: 'Session active',
  };
  return map[sessionStatus] || sessionStatus;
}

/**
 * Single source of truth for Key Manager CTAs and copy.
 * @param {KeyManagerAccountRow} account
 */
export function getKeyManagerAccountState(account) {
  const lane = getKeyManagerLane(account);
  const hasCredentials = !!account.hasCredentials;
  const needsKey = !account.hasManagementKey;
  const needsSession = accountNeedsSession(account.sessionStatus, { hasCredentials });
  const canProvision = needsKey && hasCredentials && !needsSession;
  const canAuthenticate = needsSession && !!account.email;
  const canPasteManagementKey = needsKey && !canProvision;
  const canAttachSignIn = lane === 'key_import' && !account.email;

  let statusHint = '';
  /** @type {string} */
  let statusHintTitle = '';
  if (needsSession && canAuthenticate) statusHint = 'Sign in';
  else if (needsSession && !account.email) {
    statusHint = 'Session needed';
    if (lane === 'key_import') {
      statusHintTitle =
        'No OpenRouter dashboard session — attach email sign-in to use Authenticate.';
    }
  } else if (needsKey && canProvision) statusHint = 'Provision';
  else if (needsKey && canPasteManagementKey) statusHint = 'Needs mgmt key';
  else if (!needsKey) statusHint = 'Ready';

  return {
    lane,
    laneLabel: KEY_MANAGER_LANE_LABELS[lane],
    needsKey,
    needsSession,
    canProvision,
    canAuthenticate,
    canPasteManagementKey,
    canAttachSignIn,
    statusHint,
    statusHintTitle,
    sessionLabel: formatSessionStatusLabel(account.sessionStatus),
  };
}

/**
 * Tooltip when "+ Create Key" is disabled.
 * @param {ReturnType<typeof getKeyManagerAccountState>} state
 */
export function getCreateKeyDisabledTitle(state) {
  if (!state.needsKey) return undefined;
  if (state.lane === 'credentials') {
    if (state.needsSession) return 'Sign in, then provision a management key first';
    return 'Provision a management key first';
  }
  if (state.lane === 'oauth_session' && state.needsSession) {
    return 'Refresh your OpenRouter session or paste a management key (Dashboard) first';
  }
  return 'Paste or import a management key (Dashboard) first';
}
