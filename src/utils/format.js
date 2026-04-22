/** Formats currency amounts to $0.00 */
export function formatCurrency(amount) {
  if (amount === undefined || amount === null) return '$0.00';
  return `$${Number(amount).toFixed(2)}`;
}

/** Determines if balance is ok, low, or depleted */
export function getBalanceStatus(credits) {
  if (!credits) return 'ok';
  const pct = credits.total > 0 ? (credits.remaining / credits.total) * 100 : 0;
  if (pct <= 0) return 'depleted';
  if (pct <= 15) return 'low';
  return 'ok';
}
