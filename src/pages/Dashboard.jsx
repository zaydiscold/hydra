import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMetrics } from '../hooks/useMetrics';
import AccountCard from '../components/AccountCard';
import AddAccountModal from '../components/AddAccountModal';
import AnimeText from '../components/AnimeText';
import { getAccountDashboardCardState } from '../utils/accountDashboardCard';
import { formatCurrency } from '../utils/format';
import { getCardHealth } from '../utils/cardHealth';
import { PlusIcon } from '../components/Icons';

export default function Dashboard({ onSelectAccount, addToast }) {
  const navigate = useNavigate();
  const {
    data,
    loading,
    refreshing,
    provisioningIds,
    liveStatuses,
    actionSessionTruth,
    cooldownMap,
    fetchDashboard,
    handleProvision,
  } = useMetrics({ addToast });

  const [showAddModal, setShowAddModal] = useState(false);

  // UI Handlers
  const handleAccountAdded = useCallback((msg) => {
    addToast(msg || 'Account added', 'success');
    fetchDashboard(true);
  }, [addToast, fetchDashboard]);

  const {
    fleetHealth,
    burnRate,
    lastSyncLabel,
    lastSyncText,
    activity,
    statusLabel,
    statusClass,
  } = useMemo(() => {
    const totals = data?.totals || {};
    const accounts = data?.accounts || [];
    const sCount = accounts.filter((a) => {
      const mergedSessionStatus = liveStatuses[a.id] ?? a.sessionStatus;
      return getAccountDashboardCardState({ ...a, sessionStatus: mergedSessionStatus }).isReady;
    }).length;
    const aCount = accounts.length - sCount;
    const health = getFleetHealth(accounts, liveStatuses);
    const burn = (totals.totalUsed || 0) / 30;
    const syncLabel = getLastSyncLabel(accounts);
    const syncText = formatHeaderSyncLabel(syncLabel);
    const act = getDashboardActivity(accounts, liveStatuses, cooldownMap);
    const sLabel = aCount > 0 ? 'FLEET ATTENTION' : accounts.length > 0 ? 'FLEET NOMINAL' : 'FLEET EMPTY';
    const sClass = aCount > 0 ? 'warning' : accounts.length > 0 ? 'success' : 'neutral';

    return {
      syncedCount: sCount,
      attentionCount: aCount,
      fleetHealth: health,
      burnRate: burn,
      lastSyncLabel: syncLabel,
      lastSyncText: syncText,
      activity: act,
      statusLabel: sLabel,
      statusClass: sClass,
    };
  }, [data, liveStatuses, cooldownMap]);

  if (loading && !data) {
    return (
      <div className="animate-fade-in">
        <div className="page-header">
          <div className="skeleton-shimmer" style={{ width: 300, height: 40, marginBottom: 8 }} />
          <div className="skeleton-shimmer" style={{ width: 200, height: 20 }} />
        </div>
        <div className="stats-grid">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="stat-card skeleton-shimmer" style={{ height: 120, border: 'none' }} />)}
        </div>
        <div className="section-header">
          <div className="skeleton-shimmer" style={{ width: 150, height: 30 }} />
        </div>
        <div className="accounts-grid">
          {[1, 2, 3].map(i => <div key={i} className="card account-card skeleton-shimmer" style={{ height: 220, border: 'none' }} />)}
        </div>
      </div>
    );
  }

  const accounts = data?.accounts || [];
  const totals = data?.totals || {};

  return (
    <>
      <div className="page-header dashboard-command-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div>
            <AnimeText as="h1" mode="words" variant="signal" delay={28} style={{ margin: 0 }}>Command</AnimeText>
            <p style={{ margin: 0, marginTop: 2, color: 'var(--text-secondary)' }}>Fleet health, activity, and account control at a glance</p>
          </div>
          <div className={`fleet-status-pill fleet-status-pill--${statusClass}`}>
            <span />
            {statusLabel}
          </div>
        </div>
        <div className="page-actions dashboard-command-header-actions">
          {refreshing && (
            <div className="refresh-status animate-fade-in" style={{ marginBottom: 4 }}>
              <div className="spinner-sm" />
              <span>Updating Vault...</span>
            </div>
          )}
          <div className="dashboard-command-actions">
            <span className="dashboard-last-sync">last sync {lastSyncText}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fetchDashboard(true)} disabled={refreshing || loading} style={{ gap: 8, minWidth: 92 }}>
              <span className={refreshing ? 'spin-inline' : ''}>↻</span>
              {refreshing ? 'Syncing...' : 'Sync'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)} disabled={refreshing || loading} style={{ gap: 8, minWidth: 160 }}>
              <PlusIcon size={16} />
              <span>Add Account</span>
            </button>
          </div>
        </div>
      </div>

      <div className="dashboard-command-layout">
        <aside className="dashboard-command-rail">
          <FleetHealthPanel
            fleetHealth={fleetHealth}
            accountsCount={accounts.length}
            totals={totals}
          />
          <BurnRatePanel burnRate={burnRate} />
          <ActivityPanel events={activity} />
        </aside>

        <section className="dashboard-command-main">
          <div className="section-header dashboard-accounts-header">
            <div>
              <div className="dashboard-accounts-title">
                <h3>Accounts</h3>
                {accounts.length > 0 && (
                  <span className="dashboard-account-count">{accounts.length}</span>
                )}
              </div>
              {accounts.length > 0 && (
                <p className="dashboard-key-legend">
                  <strong>CONTROL</strong> is the management plane. <strong>API</strong> is usable model access.
                </p>
              )}
            </div>
            <div className="dashboard-view-toggle" aria-label="Dashboard view mode">
              <span className="active">GRID</span>
              <span>LIST</span>
              <span>MAP</span>
            </div>
          </div>

          {accounts.length === 0 ? (
            <div className="empty-state animate-spring">
              <div className="empty-state-icon pulsar">[EMPTY]</div>
              <h3>No accounts stored locally yet.</h3>
              <p>Add your first OpenRouter account to start monitoring balances and managing keys.</p>
              <div style={{ marginTop: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'stretch', maxWidth: 320, marginLeft: 'auto', marginRight: 'auto' }}>
                <button type="button" className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                  + Add Your First Account
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => navigate('/bulk-auth')}>
                  Bulk email OTP login
                </button>
              </div>
            </div>
          ) : (
            <div className="accounts-grid dashboard-mini-grid">
              {accounts.map((account, index) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  index={index}
                  onSelect={onSelectAccount}
                  onProvision={handleProvision}
                  provisioningIds={provisioningIds}
                  liveStatuses={liveStatuses}
                  actionSessionTruth={actionSessionTruth}
                  cooldownMap={cooldownMap}
                  compact
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="dashboard-mobile-only">
        <div className="section-header">
          <h3>Fleet Snapshot</h3>
          <div className="section-count">{lastSyncLabel}</div>
        </div>
      </div>

      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          onAdded={handleAccountAdded}
        />
      )}

    </>
  );
}

function FleetHealthPanel({ fleetHealth, accountsCount, totals }) {
  const totalCredits = totals.totalCredits || 0;
  const totalRemaining = totals.totalRemaining || 0;
  const remainingPct = totalCredits > 0 ? Math.round((totalRemaining / totalCredits) * 100) : 0;
  const circumference = 2 * Math.PI * 45;
  const healthyLen = accountsCount > 0 ? (fleetHealth.healthy / accountsCount) * circumference : 0;
  const partialLen = accountsCount > 0 ? (fleetHealth.partial / accountsCount) * circumference : 0;
  const deadLen = accountsCount > 0 ? (fleetHealth.dead / accountsCount) * circumference : 0;

  return (
    <section className="dashboard-command-panel fleet-health-panel" aria-label="Fleet health chart">
      <div className="fleet-donut" data-testid="fleet-health-donut">
        <svg viewBox="0 0 110 110" role="img" aria-label={`${fleetHealth.healthy} ready, ${fleetHealth.partial} attention, ${fleetHealth.dead} error accounts`}>
          <circle className="fleet-donut-track" cx="55" cy="55" r="45" />
          <circle className="fleet-donut-ready" cx="55" cy="55" r="45" strokeDasharray={`${healthyLen} ${circumference}`} strokeDashoffset="0" />
          <circle className="fleet-donut-attention" cx="55" cy="55" r="45" strokeDasharray={`${partialLen} ${circumference}`} strokeDashoffset={-healthyLen} />
          <circle className="fleet-donut-error" cx="55" cy="55" r="45" strokeDasharray={`${deadLen} ${circumference}`} strokeDashoffset={-(healthyLen + partialLen)} />
        </svg>
        <div className="fleet-donut-center">
          <strong>{accountsCount}</strong>
          <span>ACCOUNTS</span>
        </div>
      </div>
      <div className="fleet-health-copy">
        <div className="command-kicker">FLEET BALANCE</div>
        <div className="fleet-balance-value mono">{formatCurrency(totalRemaining)}</div>
        <p>{remainingPct}% of {formatCurrency(totalCredits)}</p>
        <HealthRow tone="ready" label="ready" value={fleetHealth.healthy} />
        <HealthRow tone="attention" label="attention" value={fleetHealth.partial} />
        <HealthRow tone="error" label="error" value={fleetHealth.dead} />
      </div>
    </section>
  );
}

function HealthRow({ tone, label, value }) {
  return (
    <div className={`health-row health-row--${tone}`}>
      <span />
      <em>{label}</em>
      <strong>{value}</strong>
    </div>
  );
}

function BurnRatePanel({ burnRate }) {
  return (
    <section className="dashboard-command-panel burn-rate-panel">
      <div className="command-kicker">BURN RATE</div>
      <div className="burn-rate-value mono">
        {formatCurrency(burnRate)}
        <span>/ day · 30d avg</span>
      </div>
      <svg className="burn-sparkline" viewBox="0 0 200 42" aria-hidden="true">
        <defs>
          <linearGradient id="hydra-burn-spark" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent-secondary)" />
            <stop offset="1" stopColor="var(--accent-secondary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0,29 L18,26 L36,31 L54,23 L72,21 L90,18 L108,22 L126,15 L144,17 L162,12 L180,10 L200,6" />
        <path className="burn-sparkline-fill" d="M0,29 L18,26 L36,31 L54,23 L72,21 L90,18 L108,22 L126,15 L144,17 L162,12 L180,10 L200,6 L200,42 L0,42 Z" />
      </svg>
    </section>
  );
}

function ActivityPanel({ events }) {
  return (
    <section className="dashboard-command-panel activity-panel">
      <div className="activity-panel-header">
        <div className="command-kicker">ACTIVITY</div>
        <span>local</span>
      </div>
      <div className="activity-list">
        {events.map((event) => (
          <div className={`activity-row activity-row--${event.tone}`} key={`${event.title}-${event.detail}`}>
            <span className="activity-dot" />
            <div>
              <strong>{event.title}</strong>
              <em>{event.detail}</em>
            </div>
            <time>{event.time}</time>
          </div>
        ))}
      </div>
    </section>
  );
}

function getFleetHealth(accounts, liveStatuses = {}) {
  return accounts.reduce((acc, account) => {
    const sessionStatus = liveStatuses[account.id] ?? account.sessionStatus ?? 'none';
    const hasErrorState = account.status === 'error' || account.sessionDecryptFailed;
    const health = getCardHealth(sessionStatus, !!account.hasManagementKey, hasErrorState);
    acc[health] += 1;
    return acc;
  }, { healthy: 0, partial: 0, dead: 0 });
}

function getLastSyncLabel(accounts) {
  let latest = null;
  for (const account of accounts) {
    const ts = getSyncTimestamp(account);
    if (ts != null && (latest == null || ts > latest)) latest = ts;
  }
  if (!latest) return 'no sync';
  return formatRelativeSyncLabel(latest);
}

function getSyncTimestamp(account) {
  const timestamp = Date.parse(account.lastSyncAt || account.updatedAt || account.lastLoginAt || '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatRelativeSyncLabel(timestamp) {
  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) return 'now';
  if (diffMinutes < 60) return `${diffMinutes}m`;
  return `${Math.floor(diffMinutes / 60)}h`;
}

function getDashboardActivity(accounts, liveStatuses = {}, cooldownMap = {}) {
  if (accounts.length === 0) {
    return [
      { tone: 'neutral', title: 'vault ready', detail: 'add accounts to begin fleet monitoring', time: 'now' },
      { tone: 'info', title: 'bulk OTP available', detail: 'batch import accounts from the sidebar flow', time: 'next' },
      { tone: 'success', title: 'proxy standby', detail: 'pooled keys activate after account setup', time: 'idle' },
    ];
  }

  const now = Date.now();
  const events = [];
  for (const account of accounts) {
    const alias = account.alias || account.email || 'account';
    const sessionStatus = liveStatuses[account.id] ?? account.sessionStatus ?? 'none';
    const lockedKeys = (account.keys?.list || []).filter((key) => cooldownMap[key.hash] && cooldownMap[key.hash] > now);
    const remaining = account.credits?.remaining ?? 0;
    const total = account.credits?.total ?? 0;
    const pct = total > 0 ? (remaining / total) * 100 : 0;
    const syncTimestamp = getSyncTimestamp(account);
    const syncLabel = syncTimestamp == null ? 'no sync' : formatRelativeSyncLabel(syncTimestamp);

    if (account.status === 'error' || account.sessionDecryptFailed) {
      events.push({ tone: 'error', title: 'account needs repair', detail: alias, time: syncLabel });
    } else if (!account.hasManagementKey) {
      events.push({ tone: 'error', title: 'control key missing', detail: alias, time: syncLabel });
    } else if (sessionStatus === 'expired' || sessionStatus === 'none') {
      events.push({ tone: 'warning', title: 'session needs sign-in', detail: alias, time: syncLabel });
    } else if (lockedKeys.length > 0) {
      events.push({ tone: 'warning', title: `${lockedKeys.length} key cooldown`, detail: alias, time: 'now' });
    } else if (total > 0 && pct < 20) {
      events.push({ tone: 'warning', title: 'low balance', detail: `${alias} · ${formatCurrency(remaining)}`, time: syncLabel });
    } else {
      events.push({ tone: 'success', title: 'account synced', detail: alias, time: syncLabel });
    }
  }

  return events.slice(0, 5);
}

function formatHeaderSyncLabel(label) {
  if (label === 'no sync') return 'never';
  if (label === 'now') return 'now';
  return `${label} ago`;
}
