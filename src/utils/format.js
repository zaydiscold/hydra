/** Formats currency amounts to $0.00 */
export function formatCurrency(amount) {
  if (amount === undefined || amount === null) return '$0.00';
  return `$${Number(amount).toFixed(2)}`;
}

/** Formats remaining balances without rounding up and overstating credits. */
export function formatRemainingCurrency(amount) {
  if (amount === undefined || amount === null || amount === '') return '—';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';
  const cents = Math.floor(Math.max(0, value) * 100) / 100;
  return `$${cents.toFixed(2)}`;
}

/** Determines if balance is ok, low, or depleted */
export function getBalanceStatus(credits) {
  if (!credits) return 'ok';
  const pct = credits.total > 0 ? (credits.remaining / credits.total) * 100 : 0;
  if (pct <= 0) return 'depleted';
  if (pct <= 15) return 'low';
  return 'ok';
}
