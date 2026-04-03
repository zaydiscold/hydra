import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import * as api from '../api';
import ScrambleText from '../components/ScrambleText';
import LoginAccountModal from '../components/LoginAccountModal';
import { accountNeedsSession } from '../utils/accountSession';
import {
  WalletIcon,
  CreditsIcon,
  DatabaseIcon,
  ShieldIcon,
  PlusIcon,
  InfoIcon,
  KeyIcon,
  PowerIcon,
  TrashIcon,
  EyeIcon,
  EyeOffIcon,
  CopyIcon,
  EditIcon,
} from '../components/Icons';

function CreateKeyModal({ accountId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [limitReset, setLimitReset] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdKey, setCreatedKey] = useState(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = { name: name.trim() };
      if (limit) data.limit = parseFloat(limit);
      if (limitReset) data.limitReset = limitReset;
      const res = await api.createKey(accountId, data);
      setCreatedKey(res.key);
      onCreated();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  function handleCopy() {
    navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (createdKey) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal animate-spring" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>[SUCCESS] Key Created!</h3>
            <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
          </div>
          <p style={{ color: 'var(--status-warning)', fontSize: '0.85rem', marginBottom: 'var(--space-md)' }}>
            [WARNING] Copy your key now. It won't be shown again.
          </p>
          <div className="key-display">
            <code style={{ flex: 1 }}>
              <ScrambleText text={createdKey} duration={1000} />
            </code>
            <button className="btn btn-secondary btn-sm" onClick={handleCopy}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div className="modal-footer">
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal animate-spring" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create New API Key</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Key Name</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g., Claude-Agent, Cursor, Dev..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              spellCheck={false}
            />
          </div>
          <div className="form-group">
            <label>Spending Limit (USD) — Optional</label>
            <input
              type="number"
              className="form-input"
              placeholder="No limit"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              min="0"
              step="0.01"
            />
          </div>
          <div className="form-group">
            <label>Limit Reset Period — Optional</label>
            <select
              className="form-input form-select"
              value={limitReset}
              onChange={(e) => setLimitReset(e.target.value)}
            >
              <option value="">No reset</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {error && <p style={{ color: 'var(--status-error)', fontSize: '0.85rem', marginBottom: 'var(--space-md)' }}>{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><div className="spinner" /> Creating...</> : 'Create Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatCurrency(amount) {
  if (amount === undefined || amount === null) return '$0.00';
  return `$${amount.toFixed(2)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function AccountDetail({ accountId, onBack, addToast }) {
  const params = useParams();
  const resolvedAccountId = accountId || params.accountId;
  const [snapshot, setSnapshot] = useState(null);
  const [accountMeta, setAccountMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const initialFetchDone = useRef(false);

  // Edit alias
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasInput, setAliasInput] = useState('');
  const [aliasSaving, setAliasSaving] = useState(false);

  // Key reveal / copy
  const [revealedKeys, setRevealedKeys] = useState(new Set());
  const [copiedKey, setCopiedKey] = useState(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  const fetchSnapshot = useCallback(async () => {
    if (!resolvedAccountId) return;
    try {
      setLoadError('');
      const res = await api.getAccountSnapshot(resolvedAccountId);
      setSnapshot(res.data);
    } catch (err) {
      setSnapshot(null);
      setLoadError(err.message || 'Failed to load account');
    } finally {
      setLoading(false);
    }
  }, [resolvedAccountId]);

  const fetchMeta = useCallback(async () => {
    if (!resolvedAccountId) return;
    try {
      const res = await api.getAccounts();
      const found = (res.data || []).find((a) => a.id === resolvedAccountId) || null;
      setAccountMeta(found);
    } catch (err) {
      // Non-fatal; snapshot call will still provide most info when available.
      console.error('[ACCOUNT_DETAIL] Failed to fetch meta:', err.message);
    }
  }, [resolvedAccountId]);

  useEffect(() => {
    if (!resolvedAccountId) {
      setLoading(false);
      addToast('Missing account id in route. Returning to dashboard.', 'error');
      onBack();
      return;
    }
    if (!initialFetchDone.current) {
      void (async () => {
        await fetchMeta();
        // If we already know there's no management key, don't spam snapshot.
        // Otherwise try snapshot; it will set a user-friendly error if it fails.
        fetchSnapshot();
      })();
      initialFetchDone.current = true;
    }
  // accountMeta intentionally not a dependency: we only want the initial decision once.
  }, [resolvedAccountId, fetchSnapshot, fetchMeta, addToast, onBack]);

  async function handleToggleKey(hash, currentDisabled) {
    setActionLoading((p) => ({ ...p, [hash]: true }));
    try {
      await api.updateKey(resolvedAccountId, hash, { disabled: !currentDisabled });
      addToast(`Key ${currentDisabled ? 'enabled' : 'disabled'}`, 'success');
      fetchSnapshot();
    } catch (err) {
      addToast(err.message, 'error');
    }
    setActionLoading((p) => ({ ...p, [hash]: false }));
  }

  async function handleDeleteKey(hash, name) {
    if (!window.confirm(`Delete key "${name}"? This cannot be undone.`)) return;
    setActionLoading((p) => ({ ...p, [hash]: true }));
    try {
      await api.deleteKey(resolvedAccountId, hash);
      addToast(`Key "${name}" deleted`, 'success');
      fetchSnapshot();
    } catch (err) {
      addToast(err.message, 'error');
    }
    setActionLoading((p) => ({ ...p, [hash]: false }));
  }

  async function handleSaveAlias() {
    const trimmed = aliasInput.trim();
    if (!trimmed || trimmed === snapshot.alias) { setEditingAlias(false); return; }
    setAliasSaving(true);
    try {
      await api.updateAccount(resolvedAccountId, { alias: trimmed });
      setSnapshot((prev) => ({ ...prev, alias: trimmed }));
      addToast('Account name updated', 'success');
      setEditingAlias(false);
    } catch (err) {
      addToast(err.message, 'error');
    }
    setAliasSaving(false);
  }

  function toggleReveal(hash) {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash); else next.add(hash);
      return next;
    });
  }

  function copyKey(hash, value) {
    navigator.clipboard.writeText(value || hash);
    setCopiedKey(hash);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  async function handleDeleteAccount() {
    if (!window.confirm(`Delete this account from Hydra? This only removes it from Hydra — your OpenRouter account and keys are not affected.`)) return;
    try {
      await api.deleteAccount(resolvedAccountId);
      addToast('Account removed from Hydra', 'success');
      onBack();
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  async function handleProvisionKey() {
    setActionLoading((p) => ({ ...p, __provision: true }));
    try {
      const res = await api.provisionManagementKey(resolvedAccountId);
      if (!res?.data?.key) {
        throw new Error(res?.data?.message || 'Provisioning did not return a management key');
      }
      const source = res.data.source;
      const via = source ? api.formatProvisionSourceForUi(source) : '';
      addToast(`Management key provisioned${via ? ` via ${via}` : ''}`, 'success');
      await fetchMeta();
      await fetchSnapshot();
    } catch (err) {
      addToast(`Provision failed: ${api.formatApiErrorMessage(err)}`, 'error');
    }
    setActionLoading((p) => ({ ...p, __provision: false }));
  }

  if (loading && !snapshot) {
    return (
      <div className="loading-overlay">
        <div className="spinner spinner-lg" />
        <span>Loading account...</span>
      </div>
    );
  }

  if (!snapshot) {
    const hasEmail = !!accountMeta?.email;
    const needsSession =
      hasEmail
      && accountNeedsSession(accountMeta?.sessionStatus, {
        hasCredentials: accountMeta?.hasCredentials,
      });
    const canProvisionAfterAuth =
      !!accountMeta?.hasCredentials
      && !accountMeta?.hasManagementKey
      && !needsSession;

    return (
      <>
        <div className="empty-state animate-spring" style={{ marginTop: 'var(--space-xl)' }}>
          <div className="empty-state-icon pulsar">[ACCOUNT]</div>
          <h3>{accountMeta?.alias || 'Account'}</h3>
          <p style={{ maxWidth: 520 }}>
            {loadError || 'This account can’t be opened yet.'}
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 'var(--space-md)' }}>
            <button type="button" className="btn btn-secondary" onClick={onBack}>
              ← Back
            </button>
            {needsSession && accountMeta && (
              <button type="button" className="btn btn-secondary" onClick={() => setLoginModalOpen(true)}>
                [UNLOCK] Authenticate
              </button>
            )}
            {canProvisionAfterAuth && (
              <button type="button" className="btn btn-primary" onClick={handleProvisionKey} disabled={!!actionLoading.__provision}>
                {actionLoading.__provision ? 'Provisioning…' : '[AUTO] Provision Key'}
              </button>
            )}
            <button type="button" className="btn btn-danger" onClick={handleDeleteAccount}>
              <TrashIcon size={16} style={{ marginRight: 8 }} />
              Delete from Hydra
            </button>
          </div>

          {needsSession && (
            <p style={{ marginTop: 'var(--space-md)', fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
              Authenticate first (email OTP or password), then provision a management key. You can also use the <strong>Dashboard</strong> or <strong>Key Manager</strong>.
            </p>
          )}
          {!accountMeta?.hasCredentials && hasEmail && (
            <p style={{ marginTop: 'var(--space-md)', fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
              This account has no sign-in path stored. Re-add it with Email/OTP or password.
            </p>
          )}
          {!hasEmail && (
            <p style={{ marginTop: 'var(--space-md)', fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
              This account has no email stored. Re-add it with Email/OTP, or delete it from Hydra.
            </p>
          )}
        </div>

        {loginModalOpen && accountMeta && (
          <LoginAccountModal
            account={accountMeta}
            onClose={() => setLoginModalOpen(false)}
            onDone={async (msg) => {
              addToast(msg, 'success');
              setLoginModalOpen(false);
              await fetchMeta();
              await fetchSnapshot();
            }}
          />
        )}
      </>
    );
  }

  const credits = snapshot.credits || {};
  const keys = Array.isArray(snapshot.keys?.list) ? snapshot.keys.list : [];
  const pct = credits.total > 0 ? Math.max(0, (credits.remaining / credits.total) * 100) : 0;

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <ShieldIcon size={28} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
          <button
            className="btn btn-ghost"
            style={{ padding: '3px 7px', minHeight: 'unset', fontSize: '0.7rem', opacity: 0.5, marginRight: 4 }}
            onClick={onBack}
          >
            ← back
          </button>
          {editingAlias ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                className="form-input"
                style={{ padding: '4px 8px', fontSize: '1.1rem', fontWeight: 800, minWidth: 180, height: 36 }}
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveAlias(); if (e.key === 'Escape') setEditingAlias(false); }}
                autoFocus
                spellCheck={false}
              />
              <button className="btn btn-primary btn-sm" onClick={handleSaveAlias} disabled={aliasSaving}>
                {aliasSaving ? '…' : 'Save'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditingAlias(false)}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ margin: 0 }}>{snapshot.alias}</h2>
              <button
                className="btn btn-ghost"
                style={{ padding: '4px 6px', minHeight: 'unset', opacity: 0.6 }}
                title="Edit account name"
                onClick={() => { setAliasInput(snapshot.alias); setEditingAlias(true); }}
              >
                <EditIcon size={14} />
              </button>
            </div>
          )}
        </div>
        <p>Account details and API key management</p>
      </div>

      {/* Management key preview */}
      {snapshot.managementKeyPreview && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-md)', padding: '6px 10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Mgmt Key</span>
          <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', userSelect: 'text', flex: 1 }}>{snapshot.managementKeyPreview}</span>
          <button className="btn btn-ghost" style={{ padding: '2px 4px', minHeight: 'unset', opacity: 0.5 }} onClick={() => copyKey('mgmt', snapshot.managementKeyPreview)} title="Copy preview">
            {copiedKey === 'mgmt' ? <span style={{ fontSize: '0.65rem', color: 'var(--status-success)' }}>✓</span> : <CopyIcon size={11} />}
          </button>
        </div>
      )}

      {/* Credit stats */}
      <div className="stats-grid">
        <div className="stat-card shine-sweep animate-spring stagger-delay-0">
          <div className="stat-card-header">
            <div className="stat-card-label">Remaining</div>
            <WalletIcon className="stat-icon" />
          </div>
          <div className="stat-card-value success mono">
            <ScrambleText text={formatCurrency(credits.remaining)} />
          </div>
        </div>
        <div className="stat-card shine-sweep animate-spring stagger-delay-50">
          <div className="stat-card-header">
            <div className="stat-card-label">Total Purchased</div>
            <CreditsIcon className="stat-icon" />
          </div>
          <div className="stat-card-value accent mono">
            <ScrambleText text={formatCurrency(credits.total)} />
          </div>
        </div>
        <div className="stat-card shine-sweep animate-spring stagger-delay-100">
          <div className="stat-card-header">
            <div className="stat-card-label">Total Used</div>
            <DatabaseIcon className="stat-icon" />
          </div>
          <div className="stat-card-value warning">
            <ScrambleText text={formatCurrency(credits.used)} />
          </div>
        </div>
        <div className="stat-card shine-sweep animate-spring stagger-delay-150">
          <div className="stat-card-header">
            <div className="stat-card-label">Utilization</div>
            <InfoIcon className="stat-icon" />
          </div>
          <div className="stat-card-value info">
            <ScrambleText text={pct.toFixed(1) + '%'} />
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="flex justify-between mb-sm text-xs text-secondary" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
          <span>Balance utilization</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
        <div className="balance-bar balance-bar-mini">
          <div
            className={`balance-bar-fill ${pct < 15 ? 'low' : ''} ${pct <= 0 ? 'depleted' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Keys section */}
      <div className="section-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3>API Keys</h3>
          <span className="section-count">{keys.length}</span>
        </div>
        <div className="action-bar-group" style={{ marginLeft: 'auto' }}>
          <button className="btn btn-secondary btn-sm" onClick={fetchSnapshot} disabled={loading}>
            <span className={loading ? 'spin-inline' : ''}>↻</span> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreateModal(true)}>
            <PlusIcon size={14} /> Create Key
          </button>
        </div>
      </div>

      {keys.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <KeyIcon size={48} strokeWidth={1} style={{ opacity: 0.3 }} />
          </div>
          <h3>No API keys</h3>
          <p>Create your first API key for this account.</p>
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            <PlusIcon size={18} style={{ marginRight: 8 }} />
            Create Key
          </button>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th><div className="icon-inline" style={{ marginRight: 8 }}><KeyIcon size={14} /></div>Name</th>
                <th>Label</th>
                <th>Status</th>
                <th>Usage (Monthly)</th>
                <th>Limit</th>
                <th>Created</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const isKeyDisabled = !!key.disabled;
                return (
                  <tr key={key.hash}>
                    <td style={{ fontWeight: 600 }}>{key.name}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span
                          className="mono"
                          style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', userSelect: 'text', cursor: 'text' }}
                        >
                          {revealedKeys.has(key.hash)
                            ? (key.label || key.hash || '—')
                            : (key.label ? key.label.slice(0, 8) + '••••••' : '—')}
                        </span>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '2px 4px', minHeight: 'unset', opacity: 0.6 }}
                          title={revealedKeys.has(key.hash) ? 'Hide' : 'Show'}
                          onClick={() => toggleReveal(key.hash)}
                        >
                          {revealedKeys.has(key.hash) ? <EyeOffIcon size={12} /> : <EyeIcon size={12} />}
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '2px 4px', minHeight: 'unset', opacity: 0.6 }}
                          title="Copy to clipboard"
                          onClick={() => copyKey(key.hash, key.label)}
                        >
                          {copiedKey === key.hash ? <span style={{ fontSize: '0.7rem', color: 'var(--status-success)' }}>✓</span> : <CopyIcon size={12} />}
                        </button>
                      </div>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 700, color: isKeyDisabled ? 'var(--text-tertiary)' : 'var(--status-success)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
                        {isKeyDisabled ? 'Disabled' : 'Active'}
                      </span>
                    </td>
                    <td className="tabular mono">{formatCurrency(key.usage_monthly)}</td>
                    <td className="tabular mono">
                      {key.limit !== null ? (
                        <span>
                          {formatCurrency(key.limit_remaining)} / {formatCurrency(key.limit)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)' }}>Unlimited</span>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                      {formatDate(key.created_at)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="action-bar-group" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleToggleKey(key.hash, isKeyDisabled)}
                          disabled={actionLoading[key.hash]}
                          title={isKeyDisabled ? 'Enable' : 'Disable'}
                        >
                          {isKeyDisabled ? <PlusIcon size={12} /> : <PowerIcon size={12} />}
                          {isKeyDisabled ? 'Enable' : 'Disable'}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDeleteKey(key.hash, key.name)}
                          disabled={actionLoading[key.hash]}
                          title="Delete key"
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Danger zone */}
      <div style={{ marginTop: 'var(--space-lg)', padding: '10px 14px', border: '1px solid rgba(255,34,85,0.2)', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PowerIcon size={14} style={{ color: 'var(--status-error)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Remove this account from Hydra — OpenRouter data stays untouched.</span>
        </div>
        <button className="btn btn-danger btn-sm" onClick={handleDeleteAccount}>
          <TrashIcon size={12} /> Remove Account
        </button>
      </div>

      {showCreateModal && (
        <CreateKeyModal
          accountId={resolvedAccountId}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            addToast('API key created!', 'success');
            fetchSnapshot();
          }}
        />
      )}
    </>
  );
}
