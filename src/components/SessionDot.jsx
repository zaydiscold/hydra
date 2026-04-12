import { memo } from 'react';

// ─── Memoized Session Status Dot ─────────────────────────────────────────────
const SessionDot = memo(function SessionDot({ status, hasManagementKey, hasCredentials }) {
  const base = {
    active: {
      color: 'var(--status-success)',
      label: 'Clerk dashboard session active (stored in vault)',
      glow: true,
    },
    expiring: {
      color: 'var(--status-warning)',
      label: 'Clerk session expiring within ~10 minutes',
      glow: false,
    },
    expired: {
      color: 'var(--status-error)',
      label: 'Clerk dashboard session expired — re-authenticate for dashboard actions',
      glow: false,
    },
    error: {
      color: 'var(--status-error)',
      label: 'Session data in vault could not be decrypted — check vault / Nuclear Reset',
      glow: false,
    },
    unknown: {
      color: 'var(--text-tertiary)',
      label: 'Probing session via Clerk — status will update in a moment',
      glow: false,
    },
  };

  let d;
  if (status === 'none') {
    if (hasManagementKey && !hasCredentials) {
      d = {
        color: 'var(--status-info)',
        label:
          'Key-only account: no Clerk session in vault — OpenRouter snapshot uses the management key only. Add credentials + Authenticate if you need dashboard session flows.',
        glow: true,
      };
    } else if (hasManagementKey && hasCredentials) {
      d = {
        color: 'var(--status-warning)',
        label:
          'No Clerk session stored yet — balances still work via management key. Use [UNLOCK] Authenticate to save a session (required after some password+2FA steps until you finish verify).',
        glow: false,
      };
    } else {
      d = {
        color: 'var(--text-tertiary)',
        label:
          'No management key and no Clerk session — add a key or sign in to provision.',
        glow: false,
      };
    }
  } else {
    d = base[status] || base.unknown;
  }

  const pulsar = status === 'active';
  const shadow = pulsar
    ? `0 0 8px ${d.color}`
    : d.glow
      ? `0 0 6px color-mix(in srgb, ${d.color} 55%, transparent)`
      : 'none';

  return (
    <span
      title={d.label}
      className={pulsar ? 'pulsar' : ''}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: d.color,
        boxShadow: shadow,
        flexShrink: 0,
      }}
    />
  );
});

export default SessionDot;
