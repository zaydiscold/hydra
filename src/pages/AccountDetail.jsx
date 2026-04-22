import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import * as api from '../api';
import ScrambleText from '../components/ScrambleText';
import LoginAccountModal from '../components/LoginAccountModal';
import SessionDot from '../components/SessionDot';
import { accountNeedsSession, canProvisionWithSession, isSessionProbePending } from '../utils/accountSession';
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
  const [errors, setErrors] = useState({});
  const [createdKey, setCreatedKey] = useState(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const newErrors = {};
    if (!name.trim()) {
      newErrors.name = 'Key Name is required';
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setLoading(true);
    try {
      const data = { name: name.trim() };
      if (limit) data.limit = parseFloat(limit);
      if (limitReset) data.limitReset = limitReset;
      const res = await api.createKey(accountId, data);
      setCreatedKey(res.key);
      onCreated();
    } catch (err) {
      setErrors({ submit: err.message });
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
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label>Key Name</label>
            <input
              type="text"
              className={`form-input ${errors.name ? 'error' : ''}`}
              placeholder="e.g., Claude-Agent, Cursor, Dev..."
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors(prev => ({ ...prev, name: null }));
              }}
              autoFocus
              spellCheck={false}
            />
            {errors.name && <p className="field-error">{errors.name}</p>}
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
          {errors.submit && <p className="form-error">{errors.submit}</p>}
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

  // Live Clerk session probe — overrides stale heuristic from getAccounts()
  const [liveSessionStatus, setLiveSessionStatus] = useState(null);
  const [sessionProbing, setSessionProbing] = useState(false);

  // Edit alias
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasInput, setAliasInput] = useState('');
  const [aliasSaving, setAliasSaving] = useState(false);

  // Key reveal / copy
  const [revealedKeys, setRevealedKeys] = useState(new Set());
  const [copiedKey, setCopiedKey] = useState(null);

  // Key test status: { [hash]: { loading, valid, error } }
  const [testKeyStatus, setTestKeyStatus] = useState({});
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  // Mgmt key reveal
  const [mgmtKeyFull, setMgmtKeyFull] = useState(null);
  const [revealedMgmt, setRevealedMgmt] = useState(false);
  const [loadingMgmtReveal, setLoadingMgmtReveal] = useState(false);

  // Management keys storage (New)
  const [managementKeys, setManagementKeys] = useState([]);
  const [loadingMgmtKeys, setLoadingMgmtKeys] = useState(false);
  const [managementKeysLoaded, setManagementKeysLoaded] = useState(false);
  const [managementKeysLoadError, setManagementKeysLoadError] = useState('');

  // Import management key
  const [showImport, setShowImport] = useState(false);
  const [importKey, setImportKey] = useState('');
  const [importName, setImportName] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState('');

  // Confirm modals
  const [deleteKeyConfirm, setDeleteKeyConfirm] = useState(null); // { hash, name }
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState(false);

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

  const fetchManagementKeys = useCallback(async () => {
    if (!resolvedAccountId) return;
    setLoadingMgmtKeys(true);
    setManagementKeysLoadError('');
    try {
      const res = await api.getManagementKeys(resolvedAccountId);
      const raw = res.data?.keys || [];
      // Canonical identity is row id from backend; do not assume hash is present.
      const seen = new Set();
      setManagementKeys(raw.filter((k) => {
        const identity = k?.id || `${k?.name || ''}:${k?.createdAt || ''}:${k?.preview || ''}`;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      }));
      setManagementKeysLoaded(true);
    } catch (err) {
      console.error('[ACCOUNT_DETAIL] Failed to fetch management keys:', err.message);
      setManagementKeysLoadError(err.message || 'Failed to load management keys');
      setManagementKeysLoaded(true);
    } finally {
      setLoadingMgmtKeys(false);
    }
  }, [resolvedAccountId]);

  const probeSession = useCallback(async () => {
    if (!resolvedAccountId) return;
    setSessionProbing(true);
    try {
      const res = await api.checkSessionLive(resolvedAccountId);
      setLiveSessionStatus(res.data?.status ?? null);
    } catch {
      // Non-fatal; stale heuristic stays as fallback
    } finally {
      setSessionProbing(false);
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
        // Also fetch stored management keys (new)
        fetchManagementKeys();
        // Live Clerk probe — overrides stale heuristic
        probeSession();
      })();
      initialFetchDone.current = true;
    }
  // accountMeta intentionally not a dependency: we only want the initial decision once.
  }, [resolvedAccountId, fetchSnapshot, fetchMeta, fetchManagementKeys, probeSession, addToast, onBack]);

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
    setDeleteKeyConfirm({ hash, name });
  }

  async function handleDeleteKeyConfirmed() {
    const { hash, name } = deleteKeyConfirm;
    setDeleteKeyConfirm(null);
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

  async function handleRevealMgmtKey() {
    if (mgmtKeyFull) { setRevealedMgmt(v => !v); return; }
    setLoadingMgmtReveal(true);
    try {
      const res = await api.getAccountManagementKey(resolvedAccountId);
      setMgmtKeyFull(res.data.managementKey);
      setRevealedMgmt(true);
    } catch (err) {
      addToast('Could not retrieve management key: ' + err.message, 'error');
    }
    setLoadingMgmtReveal(false);
  }

  function copyKey(hash, value) {
    navigator.clipboard.writeText(value || hash);
    setCopiedKey(hash);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  async function handleTestKey(hash) {
    setTestKeyStatus((p) => ({ ...p, [hash]: { loading: true } }));
    try {
      const res = await api.testKey(resolvedAccountId, hash);
      setTestKeyStatus((p) => ({ ...p, [hash]: { loading: false, valid: true, data: res.data } }));
      setTimeout(() => setTestKeyStatus((p) => { const n = { ...p }; delete n[hash]; return n; }), 6000);
    } catch (err) {
      setTestKeyStatus((p) => ({ ...p, [hash]: { loading: false, valid: false, error: err.message } }));
      setTimeout(() => setTestKeyStatus((p) => { const n = { ...p }; delete n[hash]; return n; }), 6000);
    }
  }

  async function handleDeleteAccount() {
    setDeleteAccountConfirm(true);
  }

  async function handleDeleteAccountConfirmed() {
    setDeleteAccountConfirm(false);
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

  async function handleImportKey(e) {
    e.preventDefault();
    if (!importKey.startsWith('sk-or-v1-')) {
      setImportError('Key must start with sk-or-v1-');
      return;
    }
    setImportLoading(true);
    setImportError('');
    try {
      await api.importManagementKey(resolvedAccountId, importKey.trim(), importName.trim() || 'Imported Key');
      addToast('Management key imported', 'success');
      setShowImport(false);
      setImportKey('');
      setImportName('');
      await fetchManagementKeys();
    } catch (err) {
      setImportError(api.formatApiErrorMessage ? api.formatApiErrorMessage(err) : (err?.response?.data?.error || err.message || 'Import failed'));
    }
    setImportLoading(false);
  }

  async function handleRevokeKey(keyId) {
    try {
      await api.revokeManagementKey(resolvedAccountId, keyId);
      addToast('Management key revoked', 'success');
      await fetchManagementKeys();
    } catch (err) {
      addToast(api.formatApiErrorMessage ? api.formatApiErrorMessage(err) : 'Revoke failed', 'error');
    }
  }

  if (loading && !snapshot) {
    return (
      <div className="loading-overlay">
        <div className="spinner spinner-lg" />
        <span>Loading account...</span>
      </div>
    );
  }

  // Degraded view: management key exists but snapshot failed (OpenRouter unreachable / key revoked).
  // Key management still works — show the page with an error banner instead of the "sign in first" empty state.
  if (!snapshot && accountMeta?.hasManagementKey) {
    const displayStatus = liveSessionStatus ?? accountMeta?.sessionStatus;
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
            <h2 style={{ margin: 0 }}>{accountMeta.alias}</h2>
          </div>
          <p style={{ margin: 0 }}>Account details and API key management</p>
        </div>

        {/* Error banner */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          marginBottom: 'var(--space-md)',
          padding: '10px 14px',
          background: 'rgba(255,170,0,0.07)',
          border: '1px solid var(--status-warning)',
          fontSize: '0.82rem', color: 'var(--status-warning)',
        }}>
          <span style={{ flexShrink: 0 }}>⚠</span>
          <span>
            Balance snapshot unavailable — {loadError || 'OpenRouter API unreachable or key revoked'}.{' '}
            Key management is still functional.
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={fetchSnapshot}
            disabled={loading}
            style={{ marginLeft: 'auto', flexShrink: 0 }}
          >
            {loading ? '…' : '↻ Retry'}
          </button>
        </div>

        {/* Identity strip */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          marginBottom: 'var(--space-lg)',
          padding: '10px 14px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
        }}>
          <SessionDot
            status={displayStatus}
            hasManagementKey={!!accountMeta.hasManagementKey}
            hasCredentials={!!accountMeta.hasCredentials}
          />
          <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>
            {accountMeta.email || '—'}
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {resolvedAccountId}
          </span>
          {displayStatus && (
            <span style={{
              marginLeft: 'auto', fontSize: '0.65rem', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.07em',
              color: displayStatus === 'active' ? 'var(--status-success)'
                : displayStatus === 'expiring' ? 'var(--status-warning)'
                : 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {liveSessionStatus ? '[LIVE]' : '[CACHED]'} {displayStatus}
              <button
                type="button"
                onClick={probeSession}
                disabled={sessionProbing}
                title="Re-probe session status from Clerk"
                style={{
                  background: 'none', border: 'none', cursor: sessionProbing ? 'default' : 'pointer',
                  padding: '0 2px', fontSize: '0.75rem', color: 'var(--text-tertiary)',
                  opacity: sessionProbing ? 0.4 : 0.7,
                }}
              >
                {sessionProbing ? '…' : '↻'}
              </button>
            </span>
          )}
          {accountMeta.hasCredentials && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setLoginModalOpen(true)}
              title="Re-authenticate via email OTP or password"
            >
              [UNLOCK] Re-auth
            </button>
          )}
        </div>

        {/* Management keys */}
        <div style={{ marginBottom: 'var(--space-md)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Management Keys {managementKeys.length > 0 ? `(${managementKeys.length})` : ''}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={fetchManagementKeys} disabled={loadingMgmtKeys} style={{ fontSize: '0.7rem' }}>
              {loadingMgmtKeys ? '…' : '↻'}
            </button>
          </div>
          {managementKeysLoadError && (
            <div className="account-detail-inline-status account-detail-inline-status--error">
              <span>Management key list failed to load.</span>
              <span style={{ color: 'var(--text-secondary)' }}>{managementKeysLoadError}</span>
              <button className="btn btn-ghost btn-sm" onClick={fetchManagementKeys} disabled={loadingMgmtKeys} style={{ fontSize: '0.75rem', marginLeft: 'auto' }}>
                {loadingMgmtKeys ? '…' : 'Retry'}
              </button>
            </div>
          )}
          {managementKeysLoaded && !managementKeysLoadError && managementKeys.length === 0 && !loadingMgmtKeys && (
            <div className="account-detail-empty-inline">
              <div>No management keys in Hydra.</div>
              <div style={{ color: 'var(--text-tertiary)' }}>Provision a new one or import an existing key from OpenRouter.</div>
              <button className="btn btn-ghost btn-sm" onClick={fetchManagementKeys} style={{ fontSize: '0.75rem', alignSelf: 'flex-start' }}>
                Reload keys
              </button>
            </div>
          )}
          {managementKeys.map((key) => (
            <div key={key.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: 'var(--bg-card)', borderTop: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)', fontWeight: 500 }}>{key.name}</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--status-success)' }}>{key.status}</span>
              <code style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>{key.preview}</code>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>{formatDate(key.createdAt)}</span>
              {key.status === 'active' && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 'auto', color: 'var(--status-error)', fontSize: '0.7rem' }}
                  onClick={() => handleRevokeKey(key.id)}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
          <div style={{ padding: '6px 10px' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowImport(v => !v)}
              style={{ marginTop: 8 }}
            >
              {showImport ? 'Cancel' : '+ Import existing key'}
            </button>
            {showImport && (
              <form onSubmit={handleImportKey} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="sk-or-v1-..."
                  value={importKey}
                  onChange={e => setImportKey(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  data-1p-ignore
                  disabled={importLoading}
                />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Key name (optional)"
                  value={importName}
                  onChange={e => setImportName(e.target.value)}
                  disabled={importLoading}
                />
                {importError && <p className="field-error">{importError}</p>}
                <button type="submit" className="btn btn-primary btn-sm" disabled={importLoading || !importKey}>
                  {importLoading ? 'Importing…' : 'Import Key'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Snapshot placeholder */}
        <div style={{
          padding: '24px 16px', marginBottom: 'var(--space-md)',
          border: '1px dashed var(--border-subtle)',
          textAlign: 'center',
          fontSize: '0.82rem', color: 'var(--text-tertiary)',
        }}>
          Balance and API key data unavailable — snapshot fetch failed.
          <br />
          <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>
            API keys can still be created and deleted via the management key once the snapshot is restored.
          </span>
        </div>

        <div className="account-detail-actions account-detail-actions--end" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 'var(--space-md)' }}>
          <button type="button" className="btn btn-secondary" onClick={onBack}>← Back</button>
          <button type="button" className="btn btn-danger" onClick={handleDeleteAccount} style={{ marginLeft: 'auto' }}>
            <TrashIcon size={14} style={{ marginRight: 6 }} />
            Remove from Hydra
          </button>
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
        {deleteAccountConfirm && (
          <div className="modal-overlay" onClick={() => setDeleteAccountConfirm(false)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">Remove account from Hydra?</div>
              <p className="modal-body">This only removes the account from Hydra — your OpenRouter account, keys, and credits are not affected.</p>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setDeleteAccountConfirm(false)}>Cancel</button>
                <button className="btn btn-danger" onClick={handleDeleteAccountConfirmed}>Remove account</button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  if (!snapshot) {
    const hasEmail = !!accountMeta?.email;
    const sessionStatus = liveSessionStatus ?? accountMeta?.sessionStatus;
    const needsSession =
      hasEmail
      && accountNeedsSession(sessionStatus);
    // Can provision if session is alive and key is missing — no longer gates on hasCredentials
    // (user may have a live session without stored creds)
    const canProvisionAfterAuth =
      !!accountMeta
      && !accountMeta.hasManagementKey
      && !needsSession
      && canProvisionWithSession(sessionStatus)
      && !isSessionProbePending(sessionStatus);

    // Show Sign In only when the session is actually missing/expired.
    // If the session is active (NEEDS KEY state), Sign In would be confusing and misleading.
    // 'unknown' → probe in flight; show Sign In as a fallback in case probe comes back expired.
    const canTryAuth = hasEmail && (needsSession || sessionStatus === 'unknown' || !sessionStatus);

    // Translate raw API errors into human-readable guidance
    const humanError = (() => {
      const raw = loadError || '';
      if (raw.includes('no management key') || raw.includes('provision'))
        return needsSession
          ? 'This account needs to be signed in before a management key can be provisioned.'
          : canProvisionAfterAuth
          ? 'Session is active — click Provision Key to set up a management key automatically.'
          : 'This account needs a management key. Sign in first, then provision one.';
      if (raw.includes('session') || raw.includes('auth') || raw.includes('401'))
        return 'Session expired or missing. Sign in to restore access.';
      if (raw) return raw;
      return 'This account needs attention before it can be fully loaded.';
    })();

    // Status pill — tells operator at a glance what state the account is in
    const statusPill = (() => {
      if (!hasEmail) return { label: 'NO EMAIL', color: 'var(--text-tertiary)' };
      if (sessionStatus === 'active' && !accountMeta?.hasManagementKey)
        return { label: 'NEEDS KEY', color: 'var(--status-warning)' };
      if (sessionStatus === 'active') return { label: 'ACTIVE', color: 'var(--status-success)' };
      if (sessionStatus === 'expiring') return { label: 'SESSION EXPIRING', color: 'var(--status-warning)' };
      if (sessionStatus === 'unknown') return { label: 'CHECKING…', color: 'var(--text-tertiary)' };
      return { label: 'SIGN IN REQUIRED', color: 'var(--status-error)' };
    })();

    return (
      <>
        <div className="empty-state animate-spring" style={{ marginTop: 'var(--space-xl)' }}>
          <div className="empty-state-icon pulsar">[ACCOUNT]</div>
          <h3 style={{ marginBottom: 6 }}>{accountMeta?.alias || 'Account'}</h3>

          {/* Status pill */}
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <span style={{
              display: 'inline-block',
              fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
              color: statusPill.color,
              border: `1px solid ${statusPill.color}`,
              padding: '2px 8px',
            }}>
              {statusPill.label}
            </span>
          </div>

          <p style={{ maxWidth: 440, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {humanError}
          </p>

          <div className="account-detail-actions" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 'var(--space-md)' }}>
            <button type="button" className="btn btn-secondary" onClick={onBack}>
              ← Back
            </button>
            {canTryAuth && (
              <button type="button" className="btn btn-secondary" onClick={() => setLoginModalOpen(true)}>
                Sign In
              </button>
            )}
            {canProvisionAfterAuth && (
              <button type="button" className="btn btn-primary" onClick={handleProvisionKey} disabled={!!actionLoading.__provision}>
                {actionLoading.__provision ? 'Provisioning…' : 'Provision Key'}
              </button>
            )}
            <button type="button" className="btn btn-danger" onClick={handleDeleteAccount}>
              <TrashIcon size={14} style={{ marginRight: 6 }} />
              Remove from Hydra
            </button>
          </div>

          {!hasEmail && (
            <p style={{ marginTop: 'var(--space-md)', fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
              No email address on record. Remove this account and re-add it with an email address.
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

        {deleteAccountConfirm && (
          <div className="modal-overlay" onClick={() => setDeleteAccountConfirm(false)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">Remove account from Hydra?</div>
              <p className="modal-body">This only removes the account from Hydra — your OpenRouter account, keys, and credits are not affected.</p>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setDeleteAccountConfirm(false)}>Cancel</button>
                <button className="btn btn-danger" onClick={handleDeleteAccountConfirmed}>Remove account</button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  const credits = snapshot.credits || {};
  const keys = Array.isArray(snapshot.keys?.list) ? snapshot.keys.list : [];
  const remainingPct = credits.total > 0 ? Math.max(0, (credits.remaining / credits.total) * 100) : 0;
  const pct = remainingPct; // alias for balance bar (remaining %)
  const utilizationPct = credits.total > 0 ? Math.min(100, Math.max(0, (credits.used / credits.total) * 100)) : 0;

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
        <p style={{ margin: 0 }}>Account details and API key management</p>
      </div>

      {/* Identity strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        marginBottom: 'var(--space-lg)',
        padding: '10px 14px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
      }}>
        <SessionDot
          status={liveSessionStatus ?? accountMeta?.sessionStatus}
          hasManagementKey={!!accountMeta?.hasManagementKey}
          hasCredentials={!!accountMeta?.hasCredentials}
        />
        <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>
          {snapshot.email || accountMeta?.email || '—'}
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          {resolvedAccountId}
        </span>
        {(liveSessionStatus || accountMeta?.sessionStatus) && (() => {
          const displayStatus = liveSessionStatus ?? accountMeta?.sessionStatus;
          return (
            <span style={{
              marginLeft: 'auto', fontSize: '0.65rem', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.07em',
              color: displayStatus === 'active' ? 'var(--status-success)'
                : displayStatus === 'expiring' ? 'var(--status-warning)'
                : 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {liveSessionStatus ? '[LIVE]' : '[CACHED]'} {displayStatus}
              <button
                type="button"
                onClick={probeSession}
                disabled={sessionProbing}
                title="Re-probe session status from Clerk"
                style={{
                  background: 'none', border: 'none', cursor: sessionProbing ? 'default' : 'pointer',
                  padding: '0 2px', fontSize: '0.75rem', color: 'var(--text-tertiary)',
                  opacity: sessionProbing ? 0.4 : 0.7,
                }}
              >
                {sessionProbing ? '…' : '↻'}
              </button>
            </span>
          );
        })()}
        {accountMeta?.hasCredentials && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setLoginModalOpen(true)}
            title="Re-authenticate via email OTP or password"
          >
            [UNLOCK] Re-auth
          </button>
        )}
      </div>
      {(accountMeta?.lastLoginAt || accountMeta?.sessionExpiry || liveSessionStatus) && (() => {
        const loginAt = accountMeta.lastLoginAt ? new Date(accountMeta.lastLoginAt) : null;
        const refreshedAt = accountMeta.sessionRefreshedAt ? new Date(accountMeta.sessionRefreshedAt) : null;
        const expiresAt = accountMeta.sessionExpiry ? new Date(accountMeta.sessionExpiry) : null;
        const now = new Date();
        const msPerDay = 86400000;
        const ageMs = loginAt ? now - loginAt : null;
        const ttlMs = loginAt && expiresAt ? expiresAt - loginAt : null;
        const remainMs = expiresAt ? expiresAt - now : null;
        const ageDays = ageMs != null ? (ageMs / msPerDay).toFixed(1) : null;
        const ttlDays = ttlMs != null ? (ttlMs / msPerDay).toFixed(0) : null;
        const remainDays = remainMs != null ? (remainMs / msPerDay).toFixed(1) : null;
        const isPast = remainMs != null && remainMs < 0;
        return (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.6 }}>
            {liveSessionStatus && (
              <div style={{ marginBottom: 2 }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Observed by live probe
                </span>
                <span style={{ marginLeft: 6, color: 'var(--text-primary)' }}>
                  session is <strong style={{ color: 'var(--text-secondary)' }}>{liveSessionStatus}</strong> now
                </span>
              </div>
            )}
            {expiresAt && remainMs != null && (
              <div style={{ marginBottom: 3 }}>
                {isPast ? (
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--status-error)' }}>
                    Estimated expiry passed {Math.abs(remainDays)}d ago
                  </span>
                ) : (
                  <span style={{ fontSize: '0.8rem', fontWeight: 700,
                    color: remainMs < msPerDay * 2 ? 'var(--status-warning)' : 'var(--status-success)' }}>
                    Estimated expiry: {remainDays}d remaining
                  </span>
                )}
                <span style={{ marginLeft: 6 }}>
                  ({isPast ? 'expired' : 'expires'} {expiresAt.toLocaleDateString()})
                </span>
              </div>
            )}
            {loginAt && (
              <div>Estimated login: <strong style={{ color: 'var(--text-secondary)' }}>{loginAt.toLocaleDateString()}</strong> · {ageDays}d ago
                {refreshedAt && refreshedAt.getTime() !== loginAt?.getTime() && (
                  <span> · refreshed {refreshedAt.toLocaleDateString()}</span>
                )}
              </div>
            )}
            {ttlDays && <div style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>Estimated TTL from stored session data: {ttlDays}d</div>}
          </div>
        );
      })()}

      {/* Management keys */}
      {(snapshot.managementKeyPreview || managementKeys.length > 0 || managementKeysLoadError || loadingMgmtKeys || managementKeysLoaded) && (
        <div style={{ marginBottom: 'var(--space-md)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Management Keys {managementKeys.length > 0 ? `(${managementKeys.length})` : ''}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={fetchManagementKeys} disabled={loadingMgmtKeys} style={{ fontSize: '0.7rem' }}>
              {loadingMgmtKeys ? '…' : '↻'}
            </button>
          </div>
          {/* Active key preview (from snapshot) */}
          {snapshot.managementKeyPreview && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-tertiary)' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--status-success)', textTransform: 'uppercase' }}>active</span>
              <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', userSelect: 'text', flex: 1 }}>
                {revealedMgmt && mgmtKeyFull ? mgmtKeyFull : snapshot.managementKeyPreview}
              </span>
              <button className="btn btn-ghost" style={{ padding: '2px 4px', minHeight: 'unset', opacity: 0.6 }} onClick={handleRevealMgmtKey} title={revealedMgmt ? 'Hide' : 'Reveal'} disabled={loadingMgmtReveal}>
                {loadingMgmtReveal ? <span style={{ fontSize: '0.65rem' }}>…</span> : revealedMgmt ? <EyeOffIcon size={11} /> : <EyeIcon size={11} />}
              </button>
              <button className="btn btn-ghost" style={{ padding: '2px 4px', minHeight: 'unset', opacity: 0.5 }} onClick={() => copyKey('mgmt', revealedMgmt && mgmtKeyFull ? mgmtKeyFull : snapshot.managementKeyPreview)}>
                {copiedKey === 'mgmt' ? <span style={{ fontSize: '0.65rem', color: 'var(--status-success)' }}>✓</span> : <CopyIcon size={11} />}
              </button>
            </div>
          )}
          {/* All stored management keys */}
          {managementKeys.length > 0 && managementKeys.map((key) => (
            <div key={key.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: 'var(--bg-card)', borderTop: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)', fontWeight: 500 }}>{key.name}</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--status-success)' }}>{key.status}</span>
              <code style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>{key.preview}</code>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>{formatDate(key.createdAt)}</span>
              {key.status === 'active' && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 'auto', color: 'var(--status-error)', fontSize: '0.7rem' }}
                  onClick={() => handleRevokeKey(key.id)}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
          {managementKeysLoadError && (
            <div className="account-detail-inline-status account-detail-inline-status--error">
              <span>Management key list failed to load.</span>
              <span style={{ color: 'var(--text-secondary)' }}>{managementKeysLoadError}</span>
              <button className="btn btn-ghost btn-sm" onClick={fetchManagementKeys} disabled={loadingMgmtKeys} style={{ fontSize: '0.75rem', marginLeft: 'auto' }}>
                {loadingMgmtKeys ? '…' : 'Retry'}
              </button>
            </div>
          )}
          {managementKeysLoaded && !managementKeysLoadError && managementKeys.length === 0 && !loadingMgmtKeys && (
            <div className="account-detail-empty-inline">
              <div>No management keys in Hydra.</div>
              <div style={{ color: 'var(--text-tertiary)' }}>Provision a new one or import an existing key from OpenRouter.</div>
              <button className="btn btn-ghost btn-sm" onClick={fetchManagementKeys} style={{ fontSize: '0.75rem', alignSelf: 'flex-start' }}>
                Reload keys
              </button>
            </div>
          )}
          <div style={{ padding: '6px 10px' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowImport(v => !v)}
              style={{ marginTop: 8 }}
            >
              {showImport ? 'Cancel' : '+ Import existing key'}
            </button>
            {showImport && (
              <form onSubmit={handleImportKey} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="sk-or-v1-..."
                  value={importKey}
                  onChange={e => setImportKey(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  data-1p-ignore
                  disabled={importLoading}
                />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Key name (optional)"
                  value={importName}
                  onChange={e => setImportName(e.target.value)}
                  disabled={importLoading}
                />
                {importError && <p className="field-error">{importError}</p>}
                <button type="submit" className="btn btn-primary btn-sm" disabled={importLoading || !importKey}>
                  {importLoading ? 'Importing…' : 'Import Key'}
                </button>
              </form>
            )}
          </div>
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
            <ScrambleText text={utilizationPct.toFixed(1) + '%'} />
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="flex justify-between mb-sm text-xs text-secondary" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
          <span>Remaining</span>
          <span>{remainingPct.toFixed(1)}%</span>
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
                <th>Name</th>
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
                            ? (key.plaintextKey || key.label || key.hash || '—')
                            : (key.label ? key.label.slice(0, 8) + '••••••' : '—')}
                        </span>
                        {key.hasKeyString && (
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '2px 4px', minHeight: 'unset', opacity: 0.6 }}
                            title={revealedKeys.has(key.hash) ? 'Hide' : 'Show full key'}
                            onClick={() => toggleReveal(key.hash)}
                          >
                            {revealedKeys.has(key.hash) ? <EyeOffIcon size={12} /> : <EyeIcon size={12} />}
                          </button>
                        )}
                        {key.hasKeyString && (
                          <button
                            className="btn btn-ghost"
                            style={{ padding: '2px 4px', minHeight: 'unset' }}
                            title="Copy key"
                            onClick={() => copyKey(key.hash, key.plaintextKey || key.label)}
                          >
                            {copiedKey === key.hash ? <span style={{ fontSize: '0.7rem', color: 'var(--status-success)' }}>✓</span> : <CopyIcon size={12} />}
                          </button>
                        )}
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
                        {key.hasKeyString && (() => {
                          const ts = testKeyStatus[key.hash];
                          return (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleTestKey(key.hash)}
                              disabled={ts?.loading}
                              title="Test key against OpenRouter"
                              style={ts && !ts.loading ? { color: ts.valid ? 'var(--status-success)' : 'var(--status-error)' } : {}}
                            >
                              {ts?.loading ? <><div className="spinner" style={{ width: 10, height: 10 }} /> Testing…</>
                               : ts?.valid ? '✓ Valid'
                               : ts && !ts.valid ? '✗ Invalid'
                               : 'Test'}
                            </button>
                          );
                        })()}
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

      {/* Session Log */}
      {accountMeta?.events && accountMeta.events.length > 0 && (
        <div style={{ marginTop: 'var(--space-xl)' }}>
          <div className="section-header">
            <h3>Session Events</h3>
          </div>
          <div className="table-container" style={{ maxHeight: 250, overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Time</th>
                  <th style={{ width: 180 }}>Type</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {accountMeta.events.map((ev, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--text-tertiary)' }}>{new Date(ev.timestamp).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit'
                    })}</td>
                    <td className="mono" style={{ color: 'var(--text-secondary)' }}>{ev.type}</td>
                    <td style={{ color: 'var(--text-primary)' }}>{ev.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      {loginModalOpen && accountMeta && (
        <LoginAccountModal
          account={accountMeta}
          onClose={() => setLoginModalOpen(false)}
          onDone={async (msg) => {
            addToast(msg, 'success');
            setLoginModalOpen(false);
            await fetchSnapshot();
          }}
        />
      )}

      {deleteKeyConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteKeyConfirm(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Delete key?</div>
            <p className="modal-body">Delete <strong>{deleteKeyConfirm.name}</strong>? This removes it from OpenRouter and the local vault permanently.</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteKeyConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDeleteKeyConfirmed}>Delete key</button>
            </div>
          </div>
        </div>
      )}

      {deleteAccountConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteAccountConfirm(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Remove account from Hydra?</div>
            <p className="modal-body">This only removes the account from Hydra — your OpenRouter account, keys, and credits are not affected.</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteAccountConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDeleteAccountConfirmed}>Remove account</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
