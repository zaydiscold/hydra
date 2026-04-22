import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMetrics } from '../hooks/useMetrics';
import AccountCard from '../components/AccountCard';
import SummaryCard from '../components/SummaryCard';
import AddAccountModal from '../components/AddAccountModal';
import { getAccountDashboardCardState } from '../utils/accountDashboardCard';
import { formatCurrency } from '../utils/format';
import { 
  WalletIcon, 
  CreditsIcon, 
  DatabaseIcon, 
  PlusIcon, 
  HydraIcon 
} from '../components/Icons';

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

  const totals = data?.totals || {};
  const accounts = data?.accounts || [];
  const syncedCount = accounts.filter((a) => {
    const mergedSessionStatus = liveStatuses[a.id] ?? a.sessionStatus;
    return getAccountDashboardCardState({ ...a, sessionStatus: mergedSessionStatus }).isReady;
  }).length;
  const attentionCount = accounts.length - syncedCount;

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div style={{ color: 'var(--accent-primary)', opacity: 0.9 }}>
            <HydraIcon size={40} />
          </div>
          <div>
            <h2 style={{ margin: 0 }}>Dashboard</h2>
            <p style={{ margin: 0, marginTop: 2, color: 'var(--text-secondary)' }}>Local Management Vault for OpenRouter</p>
          </div>
        </div>
        <div className="page-actions" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          {refreshing && (
            <div className="refresh-status animate-fade-in" style={{ marginBottom: 4 }}>
              <div className="spinner-sm" />
              <span>Updating Vault...</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => fetchDashboard(true)} disabled={refreshing || loading} style={{ gap: 8, minWidth: 120 }}>
              <span className={refreshing ? 'spin-inline' : ''}>↻</span>
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)} disabled={refreshing || loading} style={{ gap: 8, minWidth: 160 }}>
              <PlusIcon size={16} />
              <span>Add Account</span>
            </button>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <SummaryCard 
          label="Total Balance"
          value={formatCurrency(totals.totalRemaining)}
          subtitle={`across ${accounts.length} accounts`}
          icon={WalletIcon}
          variant="highlight"
          delay={0}
        />
        <SummaryCard 
          label="Total Credits"
          value={formatCurrency(totals.totalCredits)}
          icon={CreditsIcon}
          variant="accent"
          delay={50}
        />
        <SummaryCard 
          label="Used"
          value={formatCurrency(totals.totalUsed)}
          icon={DatabaseIcon}
          variant="warning"
          delay={100}
        />
        <SummaryCard 
          label="Accounts"
          value={accounts.length.toString()}
          subtitle={`${syncedCount} synced${attentionCount > 0 ? ` · ${attentionCount} alerts` : ''}`}
          variant="info"
          delay={150}
        />
        <SummaryCard 
          label="Active Keys"
          value={(totals.totalActiveKeys || 0).toString()}
          variant="accent"
          delay={200}
        />
      </div>

      <div className="section-header">
        <h3>Accounts</h3>
        <div className="section-count">{accounts.length}</div>
      </div>
      
      {accounts.length > 0 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: '0 0 var(--space-md)', maxWidth: '52rem', lineHeight: 1.45 }}>
          Dot + border: <strong>green</strong> = session active + management key · <strong>yellow</strong> = management key present but session not active · <strong>red</strong> = missing key or account error.
          <strong>MGMT KEY</strong> badge = key stored · <strong>NO KEY</strong> = key missing.
        </p>
      )}

      {accounts.length === 0 ? (
        <div className="empty-state animate-spring">
          <div className="empty-state-icon pulsar">[EMPTY]</div>
          <h3>No accounts stored locally yet.</h3>
          <p>Add your first OpenRouter account to start monitoring balances and managing keys.</p>
          <div style={{ marginTop: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'stretch', maxWidth: 320, marginLeft: 'auto', marginRight: 'auto' }}>
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
              + Add Your First Account
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/bulk-auth')}>
              Bulk email OTP login
            </button>
          </div>
        </div>
      ) : (
        <div className="accounts-grid">
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
            />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          onAdded={handleAccountAdded}
        />
      )}

    </>
  );
}
