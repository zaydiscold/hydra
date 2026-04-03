import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../api';
import LoginAccountModal from '../components/LoginAccountModal';
import PasteManagementKeyModal from '../components/PasteManagementKeyModal';
import AttachSignInModal from '../components/AttachSignInModal';
import {
  getKeyManagerAccountState,
  getCreateKeyDisabledTitle,
} from '../utils/keyManagerAccountState';
import {
  KeyIcon,
  TrashIcon,
  PowerIcon,
  ShieldIcon,
  PlusIcon,
  EyeIcon,
  EyeOffIcon,
  CopyIcon,
} from '../components/Icons';

function formatCurrency(amount) {
  if (amount === undefined || amount === null) return '$0.00';
  return `$${Number(amount).toFixed(2)}`;
}

/** @param {{ total?: number, used?: number, remaining?: number } | null} credits */
function getBalanceStripState(credits) {
  if (!credits) return { status: 'ok', pct: 0 };
  const pct = credits.total > 0 ? Math.max(0, (credits.remaining / credits.total) * 100) : 0;
  let status = 'ok';
  if (credits.total > 0 && credits.remaining <= 0) status = 'depleted';
  else if (pct <= 15 && credits.total > 0) status = 'low';
  return { status, pct };
}

function AccountContextStrip({ account, kmState, balanceCredits, balanceLoading, balanceError, hasManagementKey }) {
  if (!account || !kmState) return null;
  const bal = getBalanceStripState(balanceCredits);
  return (
    <div
      style={{
        padding: '8px 12px',
        marginBottom: 'var(--space-md)',
        fontSize: '0.78rem',
        color: 'var(--text-secondary)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px' }}>
        <strong style={{ color: 'var(--text-primary)' }}>{account.alias}</strong>
        <span style={{ opacity: 0.35 }}>·</span>
        <span>{kmState.laneLabel}</span>
        <span style={{ opacity: 0.35 }}>·</span>
        <span>{kmState.sessionLabel}</span>
        <span style={{ opacity: 0.35 }}>·</span>
        <span>{hasManagementKey ? 'Management key: saved' : 'Management key: none'}</span>
        {kmState.statusHint && (
          <>
            <span style={{ opacity: 0.35 }}>·</span>
            <span
              style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem' }}
              title={kmState.statusHintTitle || undefined}
            >
              {kmState.statusHint}
            </span>
          </>
        )}
      </div>
      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px 12px',
        }}
      >
        {!hasManagementKey ? (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
            Credits: add a management key to load balance from OpenRouter
          </span>
        ) : balanceLoading ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.72rem' }}>
            <div className="spinner-sm" />
            Loading balance…
          </span>
        ) : balanceError ? (
          <span style={{ fontSize: '0.72rem', color: 'var(--status-error)' }} title={balanceError}>
            Credits: unavailable ({balanceError})
          </span>
        ) : (
          <>
            <span
              style={{
                fontSize: '0.68rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-tertiary)',
              }}
            >
              Remaining
            </span>
            <span
              className="mono"
              style={{
                fontWeight: 700,
                fontSize: '0.85rem',
                color:
                  bal.status === 'depleted'
                    ? 'var(--status-error)'
                    : bal.status === 'low'
                      ? 'var(--status-warning)'
                      : 'var(--text-primary)',
              }}
            >
              {formatCurrency(balanceCredits?.remaining)}
            </span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span className="mono" style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
              {formatCurrency(balanceCredits?.used)} used / {formatCurrency(balanceCredits?.total)} total
            </span>
            <div className="balance-bar" style={{ flex: '1 1 140px', minWidth: 100, maxWidth: 240 }}>
              <div
                className={`balance-bar-fill ${bal.status === 'low' ? 'low' : ''} ${bal.status === 'depleted' ? 'depleted' : ''}`}
                style={{ width: `${bal.pct}%` }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KeyStatusBadge({ enabled }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em',
      color: enabled ? 'var(--status-success)' : 'var(--text-tertiary)',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
      {enabled ? 'Active' : 'Disabled'}
    </span>
  );
}

function CreateKeyModal({ accountId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [requestLimit, setRequestLimit] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body = { name: name.trim() };
      if (creditLimit) body.limit = parseFloat(creditLimit);
      if (requestLimit) body.limit_requests = parseInt(requestLimit);
      await api.createKey(accountId, body);
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal animate-spring" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create API Key</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Key Name</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g., Production, Dev, Testing..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
            <div className="form-group">
              <label>Credit Limit ($)</label>
              <input
                type="number"
                className="form-input"
                placeholder="No limit"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                min="0"
                step="0.01"
              />
            </div>
            <div className="form-group">
              <label>Request Limit</label>
              <input
                type="number"
                className="form-input"
                placeholder="No limit"
                value={requestLimit}
                onChange={(e) => setRequestLimit(e.target.value)}
                min="0"
              />
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><div className="spinner-sm" /> Creating...</> : 'Create Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function KeyManager({ addToast }) {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [keysLoading, setKeysLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const didInitialLoadRef = useRef(false);
  const [revealedKeys, setRevealedKeys] = useState(new Set());
  const [copiedKey, setCopiedKey] = useState(null);
  const [loginModalAccount, setLoginModalAccount] = useState(null);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [provisioningIds, setProvisioningIds] = useState(new Set());
  const [balanceCredits, setBalanceCredits] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState('');

  function toggleReveal(hash) {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash); else next.add(hash);
      return next;
    });
  }

  function copyKey(hash, value) {
    navigator.clipboard.writeText(value ?? hash);
    setCopiedKey(hash);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getAccounts();
      const list = res.data || [];
      setAccounts(list);
      if (list.length > 0 && !selectedAccount) {
        setSelectedAccount(list[0]);
      }
      return list;
    } catch (err) {
      addToast(err.message, 'error');
      return null;
    } finally {
      setLoading(false);
    }
  }, [addToast, selectedAccount]);

  const fetchKeys = useCallback(async (accountId) => {
    if (!accountId) return;
    setKeysLoading(true);
    try {
      const res = await api.getKeys(accountId);
      const d = res.data;
      let next = [];
      if (Array.isArray(d)) next = d;
      else if (d && Array.isArray(d.list)) next = d.list;
      else if (d && Array.isArray(d.keys)) next = d.keys;
      setKeys(next);
    } catch (err) {
      addToast(err.message, 'error');
      setKeys([]);
    }
    setKeysLoading(false);
  }, [addToast]);

  const fetchAccountBalance = useCallback(async (accountOverride) => {
    const acc =
      accountOverride ||
      (selectedAccount?.id
        ? accounts.find((a) => a.id === selectedAccount.id) || selectedAccount
        : null);
    if (!acc?.id || !acc.hasManagementKey) {
      setBalanceCredits(null);
      setBalanceError('');
      setBalanceLoading(false);
      return;
    }
    setBalanceLoading(true);
    setBalanceError('');
    try {
      const res = await api.getAccountSnapshot(acc.id);
      setBalanceCredits(res.data?.credits ?? null);
    } catch (err) {
      setBalanceCredits(null);
      setBalanceError(err.message || 'Balance unavailable');
    }
    setBalanceLoading(false);
  }, [selectedAccount, accounts]);

  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    fetchAccounts();
  }, [fetchAccounts]);
  useEffect(() => {
    if (selectedAccount?.id) fetchKeys(selectedAccount.id);
  }, [selectedAccount?.id, fetchKeys]);

  useEffect(() => {
    fetchAccountBalance();
  }, [fetchAccountBalance]);

  async function handleToggleKey(accountId, hash, currentDisabled) {
    setActionLoading(prev => ({ ...prev, [hash]: true }));
    try {
      await api.updateKey(accountId, hash, { disabled: !currentDisabled });
      addToast(`Key ${!currentDisabled ? 'disabled' : 'enabled'}`, 'success');
      fetchKeys(accountId);
      fetchAccountBalance();
    } catch (err) {
      addToast(err.message, 'error');
    }
    setActionLoading(prev => ({ ...prev, [hash]: false }));
  }

  async function handleDeleteKey(accountId, hash, name) {
    if (!confirm(`Delete key "${name}"? This cannot be undone.`)) return;
    setActionLoading(prev => ({ ...prev, [hash]: true }));
    try {
      await api.deleteKey(accountId, hash);
      addToast('Key deleted', 'success');
      fetchKeys(accountId);
      fetchAccountBalance();
    } catch (err) {
      addToast(err.message, 'error');
    }
    setActionLoading(prev => ({ ...prev, [hash]: false }));
  }

  function onKeyCreated() {
    addToast('Key created', 'success');
    fetchKeys(selectedAccount.id);
    fetchAccountBalance();
  }

  const activeAccount = selectedAccount?.id
    ? accounts.find((a) => a.id === selectedAccount.id) || selectedAccount
    : null;
  const kmState = activeAccount ? getKeyManagerAccountState(activeAccount) : null;
  const needsKey = !!(kmState?.needsKey);
  const provisioning = activeAccount && provisioningIds.has(activeAccount.id);

  async function handleProvision(e, accountId) {
    e?.stopPropagation?.();
    setProvisioningIds((prev) => new Set(prev).add(accountId));
    try {
      const res = await api.provisionManagementKey(accountId);
      if (!res?.data?.key) {
        throw new Error(res?.data?.message || 'Provisioning did not return a management key');
      }
      addToast(`Management key provisioned via ${res.data.source}`, 'success');
      const list = await fetchAccounts();
      const row = list?.find((a) => a.id === accountId);
      fetchAccountBalance(row);
    } catch (err) {
      addToast(`Provision failed: ${api.formatApiErrorMessage(err)}`, 'error');
    }
    setProvisioningIds((prev) => {
      const s = new Set(prev);
      s.delete(accountId);
      return s;
    });
  }

  async function handleDeleteSelectedAccount() {
    if (!selectedAccount?.id) return;
    if (!confirm(`Delete "${selectedAccount.alias}" from Hydra? This only removes it from Hydra — your OpenRouter account and keys are not affected.`)) return;
    try {
      await api.deleteAccount(selectedAccount.id);
      addToast('Account removed from Hydra', 'success');
      setSelectedAccount(null);
      setKeys([]);
      fetchAccounts();
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  function renderEmptyKeysState() {
    if (!kmState || !activeAccount) return null;
    const dashLink = (
      <Link to="/dashboard" style={{ color: 'var(--accent-primary)' }}>
        Dashboard
      </Link>
    );
    if (!kmState.needsKey) {
      return (
        <>
          <h3>No keys for {selectedAccount.alias}</h3>
          <p style={{ maxWidth: 440 }}>
            Create an API key to start using this account. Listing keys here uses your saved management key with OpenRouter&apos;s management API.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              Create Key
            </button>
          </div>
        </>
      );
    }
    if (kmState.needsSession && kmState.canAuthenticate) {
      return (
        <>
          <h3>Authenticate first</h3>
          <p style={{ maxWidth: 440 }}>
            Use <strong>Authenticate</strong> with your saved email so Hydra has a live OpenRouter session. Then use <strong>Provision</strong> to create a management key automatically, or <strong>Paste management key</strong> if you already have one.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={() => setLoginModalAccount(activeAccount)}>
              Authenticate
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowPasteModal(true)}>
              Paste management key
            </button>
          </div>
        </>
      );
    }
    if (kmState.needsSession && !kmState.canAuthenticate) {
      const oauthLane = kmState.lane === 'oauth_session';
      return (
        <>
          <h3>Session or management key needed</h3>
          <p style={{ maxWidth: 440 }}>
            {oauthLane ? (
              <>
                This account was added via session import (OAuth). Refresh your OpenRouter session from the {dashLink}, or paste an <span className="mono">sk-or-mgmt-…</span> management key.
              </>
            ) : (
              <>
                This account has no email sign-in in Hydra. Use <strong>Attach email sign-in</strong> to add your OpenRouter email, re-import a session from the {dashLink}, or paste an <span className="mono">sk-or-mgmt-…</span> management key.
              </>
            )}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12, alignItems: 'center' }}>
            {kmState.canAttachSignIn && (
              <button type="button" className="btn btn-primary" onClick={() => setShowAttachModal(true)}>
                Attach email sign-in
              </button>
            )}
            <button type="button" className={`btn ${kmState.canAttachSignIn ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setShowPasteModal(true)}>
              Paste management key
            </button>
            <Link to="/dashboard" className="btn btn-secondary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              Open Dashboard
            </Link>
          </div>
        </>
      );
    }
    /* canProvision is only true when !needsSession (see keyManagerAccountState) */
    if (kmState.canProvision && !kmState.needsSession) {
      return (
        <>
          <h3>No keys for {selectedAccount.alias}</h3>
          <p style={{ maxWidth: 440 }}>
            Use <strong>Provision</strong> to create a management API key from your dashboard session. After that, Hydra can list and create standard API keys.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={provisioning}
              onClick={(e) => handleProvision(e, activeAccount.id)}
            >
              {provisioning ? (
                <>
                  <div className="spinner-sm" style={{ width: 12, height: 12, display: 'inline-block' }} /> Provisioning…
                </>
              ) : (
                'Provision'
              )}
            </button>
          </div>
        </>
      );
    }
    if (kmState.canPasteManagementKey) {
      return (
        <>
          <h3>Add a management key</h3>
          <p style={{ maxWidth: 440 }}>
            Hydra can&apos;t auto-provision without email credentials and a valid session. Paste an <span className="mono">sk-or-mgmt-…</span> key from OpenRouter, or use the {dashLink} to re-import a session or add an account.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12, alignItems: 'center' }}>
            <button type="button" className="btn btn-primary" onClick={() => setShowPasteModal(true)}>
              Paste management key
            </button>
            <Link to="/dashboard" className="btn btn-secondary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              Open Dashboard
            </Link>
          </div>
        </>
      );
    }
    return (
      <>
        <h3>No keys for {selectedAccount.alias}</h3>
        <p style={{ maxWidth: 440 }}>Add a management key to continue.</p>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <KeyIcon size={22} style={{ color: 'var(--accent-primary)' }} />
          <div>
            <h2>Key Manager</h2>
            <p>Create and manage API keys across your accounts</p>
            {keysLoading && keys.length > 0 && (
              <div className="refresh-status animate-fade-in" style={{ marginTop: 8 }}>
                <div className="spinner-sm" />
                <span>Updating Keys...</span>
              </div>
            )}
          </div>
        </div>
        {selectedAccount && kmState && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {kmState.canAuthenticate && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setLoginModalAccount(activeAccount)}
                disabled={keysLoading || loading}
              >
                Authenticate
              </button>
            )}
            {kmState.canProvision && !kmState.needsSession && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={provisioning || keysLoading || loading}
                onClick={(e) => handleProvision(e, activeAccount.id)}
              >
                {provisioning ? <><div className="spinner-sm" style={{ width: 10, height: 10, display: 'inline-block' }} /> Provisioning…</> : 'Provision'}
              </button>
            )}
            {kmState.canAttachSignIn && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAttachModal(true)}
                disabled={keysLoading || loading}
              >
                Attach email sign-in
              </button>
            )}
            {kmState.canPasteManagementKey && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowPasteModal(true)}
                disabled={keysLoading || loading}
              >
                Paste management key
              </button>
            )}
            <button type="button" className="btn btn-danger btn-sm" onClick={handleDeleteSelectedAccount} disabled={keysLoading || loading}>
              <TrashIcon size={14} style={{ marginRight: 6 }} />
              Delete Account
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowCreateModal(true)}
              disabled={keysLoading || loading || needsKey}
              title={kmState ? getCreateKeyDisabledTitle(kmState) : undefined}
            >
              Create Key
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(168px, 200px) 1fr', gap: 'var(--space-md)' }}>
        <div className="col-sidebar">
          <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)', fontWeight: 700, marginBottom: 8 }}>Accounts</div>
          {loading && accounts.length === 0 ? (
            <div className="col-sidebar-loading"><div className="spinner-sm" /></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {accounts.map((account) => {
                const row = getKeyManagerAccountState(account);
                return (
                  <div
                    key={account.id}
                    className={`account-item ${selectedAccount?.id === account.id ? 'selected' : ''}`}
                    style={{ padding: '6px 10px', gap: 0 }}
                    onClick={() => setSelectedAccount(account)}
                  >
                    <div className="account-item-content">
                      <div style={{ fontWeight: 600, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.alias}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        <span
                          className="mono"
                          style={{
                            fontSize: '0.58rem',
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            color: 'var(--accent-primary)',
                            opacity: 0.85,
                          }}
                        >
                          {row.laneLabel}
                        </span>
                        {row.statusHint && (
                          <span style={{ fontSize: '0.58rem', color: 'var(--text-tertiary)' }}>{row.statusHint}</span>
                        )}
                      </div>
                      {account.email && (
                        <div style={{ fontSize: '0.65rem', opacity: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                          {account.email}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="col-main">
          {!selectedAccount ? (
            <div className="empty-state">
              <div className="empty-state-icon pulsar">[KEY]</div>
              <h3>No account selected</h3>
              <p>Add accounts in the Dashboard to manage their keys here.</p>
            </div>
          ) : (
            <>
              {kmState && (
                <AccountContextStrip
                  account={activeAccount}
                  kmState={kmState}
                  balanceCredits={balanceCredits}
                  balanceLoading={balanceLoading}
                  balanceError={balanceError}
                  hasManagementKey={!!activeAccount.hasManagementKey}
                />
              )}
              {keysLoading && keys.length === 0 ? (
                <div className="page-loading">
                  <div className="spinner-sm" />
                  <span>Scanning Vault...</span>
                </div>
              ) : keys.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon pulsar">[KEY]</div>
                  {renderEmptyKeysState()}
                </div>
              ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Usage</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.hash}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{key.name || '(unnamed)'}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 6px', marginTop: 2 }}>
                          <span
                            className="mono"
                            style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
                          >
                            Key id
                          </span>
                          {key.hasKeyString && (
                            <span
                              style={{
                                fontSize: '0.58rem',
                                fontWeight: 700,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                color: 'var(--status-success)',
                              }}
                            >
                              · in vault
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                          <span
                            className="mono"
                            style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', userSelect: 'text', cursor: 'text' }}
                          >
                            {revealedKeys.has(key.hash)
                              ? (key.hash || '—')
                              : (key.hash ? key.hash.slice(0, 10) + '…' : '—')}
                          </span>
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '1px 2px', minHeight: 'unset', opacity: 0.45 }}
                            title={revealedKeys.has(key.hash) ? 'Hide key id' : 'Show full key id'}
                            onClick={() => toggleReveal(key.hash)}
                          >
                            {revealedKeys.has(key.hash) ? <EyeOffIcon size={10} /> : <EyeIcon size={10} />}
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '1px 2px', minHeight: 'unset', opacity: 0.45 }}
                            title={
                              key.hasKeyString && key.plaintextKey
                                ? 'Copy stored sk-or-v1 (same as Pool Manager)'
                                : 'Copy key id only — not the API secret. Paste sk-or-v1 in Pool Manager to pool this key.'
                            }
                            onClick={() => copyKey(key.hash, key.hasKeyString && key.plaintextKey ? key.plaintextKey : key.hash)}
                          >
                            {copiedKey === key.hash ? <span style={{ fontSize: '0.6rem', color: 'var(--status-success)' }}>✓</span> : <CopyIcon size={10} />}
                          </button>
                        </div>
                        {!key.hasKeyString && (
                          <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', marginTop: 4, maxWidth: 420, lineHeight: 1.35 }}>
                            OpenRouter does not return existing <span className="mono">sk-or-v1-…</span> secrets via the management API. Use{' '}
                            <Link to="/pool" style={{ color: 'var(--accent-primary)' }}>Pool Manager</Link>
                            {' '}→ <strong>Paste Key</strong>, or reveal/copy from{' '}
                            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)' }}>
                              openrouter.ai/settings/keys
                            </a>
                            .
                          </div>
                        )}
                      </td>
                      <td><KeyStatusBadge enabled={!key.disabled} /></td>
                      <td className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {key.usage !== undefined ? formatCurrency(key.usage) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="action-bar-group" style={{ justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleToggleKey(selectedAccount.id, key.hash, key.disabled)}
                            disabled={actionLoading[key.hash]}
                            title={key.disabled ? 'Enable' : 'Disable'}
                          >
                            {key.disabled ? <PlusIcon size={12} /> : <PowerIcon size={12} />}
                            {key.disabled ? 'Enable' : 'Disable'}
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteKey(selectedAccount.id, key.hash, key.name)}
                            disabled={actionLoading[key.hash]}
                            title="Delete key"
                          >
                            <TrashIcon size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              )}
            </>
          )}
        </div>
      </div>

      {showCreateModal && selectedAccount && (
        <CreateKeyModal
          accountId={selectedAccount.id}
          onClose={() => setShowCreateModal(false)}
          onCreated={onKeyCreated}
        />
      )}

      {showPasteModal && activeAccount && (
        <PasteManagementKeyModal
          account={activeAccount}
          onClose={() => setShowPasteModal(false)}
          onDone={async (msg) => {
            addToast(msg, 'success');
            const list = await fetchAccounts();
            const row = list?.find((a) => a.id === activeAccount.id);
            fetchKeys(activeAccount.id);
            fetchAccountBalance(row);
          }}
        />
      )}

      {showAttachModal && activeAccount && (
        <AttachSignInModal
          account={activeAccount}
          onClose={() => setShowAttachModal(false)}
          onDone={(msg) => {
            addToast(msg, 'success');
            fetchAccounts();
          }}
        />
      )}

      {loginModalAccount && (
        <LoginAccountModal
          account={loginModalAccount}
          onClose={() => setLoginModalAccount(null)}
          onDone={(msg) => {
            addToast(msg, 'success');
            fetchAccounts();
          }}
        />
      )}
    </>
  );
}
