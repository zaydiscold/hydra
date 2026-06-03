import { formatCurrency, formatRemainingCurrency } from './format.js';

function finiteNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function getAccountDisplayCredits(account = {}) {
  const credits = account.credits || {};
  const remaining = finiteNumber(credits.remaining);
  const total = finiteNumber(credits.total);
  const used = finiteNumber(credits.used);

  if (remaining !== null) {
    const resolvedTotal = total ?? (used !== null ? remaining + used : remaining);
    const resolvedUsed = used ?? (total !== null ? Math.max(0, total - remaining) : 0);
    return {
      credits: {
        total: resolvedTotal,
        used: resolvedUsed,
        remaining,
      },
      source: account.balanceSource || (account._cached ? 'recent-live' : 'live'),
      stale: Boolean(account.balanceStale),
      fetchedAt: account.balanceFetchedAt || null,
    };
  }

  const storedRemaining = finiteNumber(account.lastKnownBalance);
  if (storedRemaining !== null) {
    const storedTotal = finiteNumber(account.totalCredits) ?? storedRemaining;
    return {
      credits: {
        total: storedTotal,
        used: Math.max(0, storedTotal - storedRemaining),
        remaining: storedRemaining,
      },
      source: 'stored',
      stale: true,
      fetchedAt: account.lastKnownBalanceAt || account.balanceFetchedAt || null,
    };
  }

  return {
    credits: null,
    source: account.balanceSource || 'unavailable',
    stale: false,
    fetchedAt: null,
  };
}

export function getAccountBalanceDisplay(account = {}) {
  if (account.pendingVerification) {
    return {
      label: '—',
      detail: 'OTP pending',
      hasValue: false,
      credits: null,
      statusSource: 'pending',
    };
  }

  const snapshot = getAccountDisplayCredits(account);
  if (!snapshot.credits) {
    return {
      label: '—',
      detail: account.hasManagementKey ? 'balance unavailable' : 'no control key',
      hasValue: false,
      credits: null,
      statusSource: snapshot.source,
    };
  }

  const detailParts = [];
  if (snapshot.credits.total > 0) {
    detailParts.push(`of ${formatCurrency(snapshot.credits.total)}`);
  }
  if (snapshot.stale || snapshot.source === 'stored') {
    detailParts.push('stored');
  }

  return {
    label: formatRemainingCurrency(snapshot.credits.remaining),
    detail: detailParts.join(' · '),
    hasValue: true,
    credits: snapshot.credits,
    statusSource: snapshot.source,
    stale: snapshot.stale,
    fetchedAt: snapshot.fetchedAt,
  };
}
