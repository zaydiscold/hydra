import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FixedSizeGrid as Grid } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import * as api from '../api';
import ScrambleText from '../components/ScrambleText';
import LoginAccountModal from '../components/LoginAccountModal';
import { accountNeedsSession } from '../utils/accountSession';
import { getAccountDashboardCardState } from '../utils/accountDashboardCard';
import { 
  WalletIcon, 
  CreditsIcon, 
  DatabaseIcon, 
  PlusIcon, 
  ShieldIcon,
  LockIcon,
  KeyIcon,
  HydraIcon
} from '../components/Icons';

// ─── Memoized Auth Method Badge ──────────────────────────────────────────────
const AuthBadge = memo(function AuthBadge({ method, hasManagementKey, hasCredentials }) {
  const keyOnly =
    hasManagementKey &&
    !hasCredentials &&
    (method == null || method === '' || method === 'unknown');
  if (keyOnly) {
    return (
      <span
        className="badge badge-info"
        title="Imported with management key only — no email/password or OTP on file"
      >
        [MGMT]
      </span>
    );
  }
  if (method === 'oauth') return <span className="badge badge-neutral">[OAUTH]</span>;
  if (method === 'api') return <span className="badge badge-info">[API]</span>;
  if (method === 'email' || method === 'otp') return <span className="badge badge-neutral">[EMAIL]</span>;
  if (method === 'unknown' || method == null || method === '') {
    return <span className="badge badge-neutral">[UNKNOWN]</span>;
  }
  return <span className="badge badge-success">[PASSWORD]</span>;
});

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
      label: 'Session state unclear — re-authenticate if you use password login',
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

// ─── Add Account Modal (memoized) ────────────────────────────────────────────
const AddAccountModal = memo(function AddAccountModal({ onClose, onAdded }) {
  const [addMethod, setAddMethod] = useState('credentials');
  const [alias, setAlias] = useState('');
  const [managementKey, setManagementKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (addMethod === 'key') {
        await api.addAccount(alias.trim(), managementKey.trim());
        onAdded('Account added successfully');
      } else if (addMethod === 'credentials') {
        const useEmail = email.trim();
        const useAlias = alias.trim();
        const useAuthMethod = password ? 'password' : 'otp';
        await api.addAccountWithCredentials(useAlias, useEmail, password, useAuthMethod);
        onAdded(
          useAuthMethod === 'password'
            ? 'Account added — session can auto-refresh when needed'
            : 'Account added — click [UNLOCK] Authenticate, then [AUTO] Provision Key'
        );
      } else if (addMethod === 'bulk') {
        const lines = bulkText.trim().split('\n')
          .map(l => l.trim())
          .filter(Boolean);

        if (lines.length === 0) { 
          setError('No valid lines entered. Try alias:email:pass or raw session cookies.'); 
          setLoading(false); 
          return; 
        }
        const res = await api.bulkAddAccounts(lines);
        const bulkRows = Array.isArray(res.data?.data) ? res.data.data : [];
        const succeeded = bulkRows.filter((r) => r.success).length;
        onAdded(`Bulk import: ${succeeded}/${lines.length} accounts added`);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [addMethod, alias, managementKey, email, password, bulkText, onAdded, onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg animate-spring" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Add OpenRouter Account</h3>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem', marginTop: 2 }}>
              Connect accounts to start managing them
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>

        <div className="method-tabs" style={{ marginBottom: 'var(--space-lg)' }}>
          {[
            { id: 'credentials', icon: <LockIcon size={24} />, title: 'Email + Pass', sub: 'Password or OTP + provision' },
            { id: 'bulk',        icon: <DatabaseIcon size={24} />, title: 'Bulk Import', sub: 'Batch paste' },
            { id: 'key',         icon: <KeyIcon size={24} />, title: 'Static Key',   sub: 'Existing keys' },
          ].map(m => (
            <button
              key={m.id}
              className={`method-tab ${addMethod === m.id ? 'active' : ''}`}
              onClick={() => setAddMethod(m.id)}
              type="button"
            >
              <span style={{ marginBottom: 4, display: 'block' }}>{m.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '0.85rem', textTransform: 'uppercase' }}>{m.title}</div>
                <div style={{ fontSize: '0.7rem', opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.sub}</div>
              </div>
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {addMethod === 'key' && (
            <>
              <div className="form-group">
                <label>Account Alias</label>
                <input type="text" className="form-input" placeholder="e.g., Personal, Burner-1..."
                  value={alias} onChange={(e) => setAlias(e.target.value)} required autoFocus spellCheck={false} />
              </div>
              <div className="form-group">
                <label>Management API Key</label>
                <input type="password" className="form-input form-input-mono" placeholder="sk-or-mgmt-..."
                  value={managementKey} onChange={(e) => setManagementKey(e.target.value)} required spellCheck={false} />
                <p className="form-hint">Import existing API or management keys. Balances readable; no auto-refresh.</p>
              </div>
            </>
          )}

          {addMethod === 'credentials' && (
            <>
              <div className="form-group">
                <label>Account Alias</label>
                <input type="text" className="form-input" placeholder="e.g., Account-1, Main..."
                  value={alias} onChange={(e) => setAlias(e.target.value)} required autoFocus spellCheck={false} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" className="form-input" placeholder="account@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} required spellCheck={false} autoComplete="email" />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input type="password" className="form-input" placeholder="Account password"
                  value={password} onChange={(e) => setPassword(e.target.value)} spellCheck={false} autoComplete="new-password" />
                <p className="form-hint">Leave blank to use email OTP authentication (you'll authenticate in-dashboard)</p>
              </div>

              <div className="info-banner" style={{ background: 'rgba(0, 255, 136, 0.05)', border: '1px solid rgba(0, 255, 136, 0.2)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 800, color: 'var(--status-success)', fontSize: '0.75rem', letterSpacing: '0.05em' }}>[VAULT SECURE]</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>AES-256-GCM encrypted locally</span>
              </div>
            </>
          )}

          {addMethod === 'bulk' && (
            <div className="form-group">
              <label>Account List</label>
              <textarea
                className="form-input form-input-mono"
                style={{ height: 200, resize: 'vertical' }}
                placeholder={"alias:email@example.com:password\nalias2:email2@example.com:password2\n\nOr just email:pass (alias = email)"}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                spellCheck={false}
                required
                autoFocus
              />
              <p className="form-hint">Format: alias:email:pass or email:pass (one per line). Session cookies also accepted.</p>
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><div className="spinner" /> Processing...</> : 'Add Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatCurrency(amount) {
  if (amount === undefined || amount === null) return '$0.00';
  return `$${Number(amount).toFixed(2)}`;
}

function getBalanceStatus(credits) {
  if (!credits) return 'ok';
  const pct = credits.total > 0 ? (credits.remaining / credits.total) * 100 : 0;
  if (pct <= 0) return 'depleted';
  if (pct <= 15) return 'low';
  return 'ok';
}

// ─── Memoized Account Card with Intersection Observer ────────────────────────
const AccountCard = memo(function AccountCard({ 
  data,
  columnIndex,
  rowIndex,
  style 
}) {
  const { accounts, columnCount, onSelect, onProvision, onLogin, provisioningIds, liveStatuses } = data;
  
  // Calculate the account index based on grid position
  const index = rowIndex * columnCount + columnIndex;
  const account = accounts[index];
  
  // Intersection Observer for lazy animation trigger
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef(null);
  
  useEffect(() => {
    if (!cardRef.current) return;
    
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '50px' }
    );
    
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);
  
  // Use live-probed status when available, fall back to sync heuristic
  const sessionStatus = (liveStatuses && liveStatuses[account.id]) || account.sessionStatus || 'none';

  const balStatus = account.status === 'error' ? 'error' : getBalanceStatus(account.credits);
  const pct = account.credits?.total > 0
    ? Math.max(0, (account.credits.remaining / account.credits.total) * 100)
    : 0;
  const provisioning = provisioningIds.has(account.id);
  const needsKey = !account.hasManagementKey;
  const needsSession = accountNeedsSession(sessionStatus, {
    hasCredentials: account.hasCredentials,
  });
  const cardState = getAccountDashboardCardState(account);
  const showCardActions =
    (needsSession && account.hasCredentials)
    || (needsKey && account.hasCredentials && !needsSession);
  
  // Stable event handlers
  const handleClick = useCallback(() => {
    onSelect(account.id);
  }, [onSelect, account.id]);
  
  const handleProvision = useCallback((e) => {
    e.stopPropagation();
    onProvision(account.id);
  }, [onProvision, account.id]);
  
  const handleLogin = useCallback((e) => {
    e.stopPropagation();
    onLogin(account);
  }, [onLogin, account]);

  // If no account at this position, render empty cell
  if (!account) {
    return <div style={style} />;
  }

  return (
    <div style={{ ...style, padding: '8px' }}>
      <div
        ref={cardRef}
        className={`card card-clickable account-card ${isVisible ? 'animate-spring' : ''}`}
        style={{ 
          animationDelay: `${Math.min(index * 30, 500)}ms`,
          borderColor: balStatus === 'depleted' ? 'var(--status-error)' : 'var(--border-subtle)',
          height: '100%'
        }}
        onClick={handleClick}
      >
      <div className="account-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SessionDot
            status={sessionStatus}
            hasManagementKey={!!account.hasManagementKey}
            hasCredentials={!!account.hasCredentials}
          />
          <span className="account-card-alias">{account.alias}</span>
        </div>
        <div className={`account-card-status ${cardState.badgeVariant}`}>
          <ShieldIcon size={14} />
          <span>{cardState.badgeLabel}</span>
        </div>
      </div>

      {account.email && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>
          {account.email}
        </div>
      )}

      <div className="account-card-balance">
        <div className="account-card-balance-label">Remaining Balance</div>
        <div className={`account-card-balance-value mono ${balStatus === 'low' ? 'low' : ''} ${balStatus === 'depleted' ? 'depleted' : ''}`}>
          {account.status === 'error' ? '—' : formatCurrency(account.credits?.remaining)}
        </div>
      </div>

      <div className="balance-bar">
        <div
          className={`balance-bar-fill ${balStatus === 'low' ? 'low' : ''} ${balStatus === 'depleted' ? 'depleted' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="account-card-footer">
        <div className="account-card-meta account-card-meta-row mono">
          <span>[KEYS] <strong>{account.keys?.active || 0}</strong></span>
          <span>[USED] <strong>{formatCurrency(account.credits?.used)}</strong></span>
        </div>
        <div className="account-card-auth-wrap">
          <AuthBadge
            method={account.authMethod}
            hasManagementKey={!!account.hasManagementKey}
            hasCredentials={!!account.hasCredentials}
          />
        </div>
      </div>

      {showCardActions && (
        <div className="account-card-actions" onClick={(e) => e.stopPropagation()}>
          {needsSession && account.hasCredentials && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleLogin}
            >
              [UNLOCK] Authenticate
            </button>
          )}
          {needsKey && account.hasCredentials && !needsSession && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={provisioning}
              onClick={handleProvision}
            >
              {provisioning ? <><div className="spinner" style={{ width: 10, height: 10 }} /> [WAIT] Provisioning...</> : '[AUTO] Provision Key'}
            </button>
          )}
        </div>
      )}

      {account.status === 'error' && (
        <p className="account-card-error">{account.error}</p>
      )}
      </div>
    </div>
  );
});

// ─── Dashboard Page ──────────────────────────────────────────────────────────
export default function Dashboard({ onSelectAccount, addToast }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [loginModalAccount, setLoginModalAccount] = useState(null);
  const [provisioningIds, setProvisioningIds] = useState(new Set());
  const [liveStatuses, setLiveStatuses] = useState({}); // accountId → live-probed status
  const didInitialLoadRef = useRef(false);

  const fetchDashboard = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const res = await api.getDashboard();
      setData(res.data);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    fetchDashboard();
  }, [fetchDashboard]);

  // Live session probe: after accounts load, confirm real Clerk status for each account.
  // The dashboard bulk-list uses a sync heuristic; this fires the actual Clerk API check.
  // Max 3 concurrent to avoid hammering Clerk.
  useEffect(() => {
    const accounts = data?.accounts;
    if (!accounts?.length) return;
    let cancelled = false;

    async function probeAll() {
      const CONCURRENCY = 3;
      let active = 0;
      let idx = 0;
      const results = {};

      await new Promise((resolve) => {
        function next() {
          while (active < CONCURRENCY && idx < accounts.length) {
            const acct = accounts[idx++];
            active++;
            api.getSessionStatus(acct.id)
              .then((res) => {
                if (!cancelled) results[acct.id] = res?.data?.status || res?.data;
              })
              .catch(() => { /* network error — keep existing status */ })
              .finally(() => {
                active--;
                if (idx < accounts.length) next();
                else if (active === 0) resolve();
              });
          }
          if (idx >= accounts.length && active === 0) resolve();
        }
        next();
      });

      if (!cancelled) setLiveStatuses(results);
    }

    probeAll();
    return () => { cancelled = true; };
  }, [data?.accounts]);

  // Auto-refresh every 5 minutes while page is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) fetchDashboard(true);
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const handleAccountAdded = useCallback((msg) => {
    addToast(msg || 'Account added', 'success');
    fetchDashboard(true);
  }, [addToast, fetchDashboard]);

  const handleProvision = useCallback(async (accountId) => {
    setProvisioningIds(prev => new Set(prev).add(accountId));
    try {
      const res = await api.provisionManagementKey(accountId);
      if (!res?.data?.key) {
        throw new Error(res?.data?.message || 'Provisioning did not return a management key');
      }
      addToast(`Management key provisioned via ${api.formatProvisionSourceForUi(res.data.source)}`, 'success');
      fetchDashboard(true);
    } catch (err) {
      console.error('[DASHBOARD] Provision failed:', err.message);
      addToast(`Provision failed: ${api.formatApiErrorMessage(err)}`, 'error');
    }
    setProvisioningIds(prev => { const s = new Set(prev); s.delete(accountId); return s; });
  }, [addToast, fetchDashboard]);
  
  const handleLogin = useCallback((account) => {
    setLoginModalAccount(account);
  }, []);
  
  const handleSelect = useCallback((accountId) => {
    onSelectAccount(accountId);
  }, [onSelectAccount]);
  
  const handleCloseModal = useCallback(() => {
    setShowAddModal(false);
  }, []);
  
  const handleCloseLogin = useCallback(() => {
    setLoginModalAccount(null);
  }, []);
  
  const handleLoginDone = useCallback((msg) => {
    addToast(msg, 'success');
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
  const syncedCount = accounts.filter((a) => getAccountDashboardCardState(a).isReady).length;
  const attentionCount = accounts.length - syncedCount;

  return (
    <>
      {/* Header */}
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

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card stat-card-highlight shine-sweep animate-spring stagger-delay-0">
          <div className="stat-card-header">
            <div className="stat-card-label">Total Balance</div>
            <WalletIcon className="stat-icon" />
          </div>
          <div className="stat-card-value success mono">
            <ScrambleText text={formatCurrency(totals.totalRemaining)} />
          </div>
          <div className="stat-card-sub">across {accounts.length} accounts</div>
        </div>
        <div className="stat-card shine-sweep animate-spring stagger-delay-50">
          <div className="stat-card-header">
            <div className="stat-card-label">Total Credits</div>
            <CreditsIcon className="stat-icon" />
          </div>
          <div className="stat-card-value accent mono">
            <ScrambleText text={formatCurrency(totals.totalCredits)} />
          </div>
        </div>
        <div className="stat-card shine-sweep animate-spring stagger-delay-100">
          <div className="stat-card-header">
            <div className="stat-card-label">Used</div>
            <DatabaseIcon className="stat-icon" />
          </div>
          <div className="stat-card-value warning mono">
            <ScrambleText text={formatCurrency(totals.totalUsed)} />
          </div>
        </div>
        <div className="stat-card shine-sweep animate-spring stagger-delay-150">
          <div className="stat-card-label">Accounts</div>
          <div className="stat-card-value info mono">{accounts.length}</div>
          <div className="stat-card-sub">
            {syncedCount} synced
            {attentionCount > 0 ? ` · ${attentionCount} need attention` : ''}
          </div>
        </div>
        <div className="stat-card shine-sweep animate-spring stagger-delay-200">
          <div className="stat-card-label">Active Keys</div>
          <div className="stat-card-value accent mono">{totals.totalActiveKeys || 0}</div>
        </div>
      </div>

      {/* Account Grid */}
      <div className="section-header">
        <h3>Accounts</h3>
        <div className="section-count">{accounts.length}</div>
      </div>
      {accounts.length > 0 && (
        <p
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
            margin: '0 0 var(--space-md)',
            maxWidth: '52rem',
            lineHeight: 1.45,
          }}
        >
          Dot: <strong>green</strong> = Clerk session active; <strong>yellow</strong> = expiring soon or credentials on file but no session saved yet; <strong>cyan</strong> = key-only (mgmt key works, no session); <strong>red</strong> = expired or vault decrypt error; <strong>grey</strong> = no key and no session.
          Shield (e.g. SYNCED) is the <strong>OpenRouter snapshot</strong> — independent of the dot.
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
            <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', margin: 0, textAlign: 'center' }}>
              Bulk import (management keys) lives in Add Account. Bulk OTP is for many email-only sign-ins.
            </p>
          </div>
        </div>
      ) : (
        <div className="accounts-grid-container" style={{ height: 'calc(100vh - 400px)', minHeight: '400px' }}>
          <AutoSizer>
            {({ height, width }) => {
              const COLUMN_WIDTH = 320;
              const ROW_HEIGHT = 220;
              const GAP = 16;
              const columnCount = Math.max(1, Math.floor(width / (COLUMN_WIDTH + GAP)));
              const rowCount = Math.ceil(accounts.length / columnCount);
              
              // Memoized grid data — liveStatuses is included so cards update when probes return
              const itemData = {
                accounts,
                columnCount,
                onSelect: handleSelect,
                onProvision: handleProvision,
                onLogin: handleLogin,
                provisioningIds,
                liveStatuses,
              };
              
              return (
                <Grid
                  columnCount={columnCount}
                  columnWidth={COLUMN_WIDTH + GAP}
                  height={height}
                  rowCount={rowCount}
                  rowHeight={ROW_HEIGHT + GAP}
                  width={width}
                  itemData={itemData}
                  overscanRowCount={2}
                >
                  {AccountCard}
                </Grid>
              );
            }}
          </AutoSizer>
        </div>
      )}

      {showAddModal && (
        <AddAccountModal
          onClose={handleCloseModal}
          onAdded={handleAccountAdded}
        />
      )}

      {loginModalAccount && (
        <LoginAccountModal
          account={loginModalAccount}
          onClose={handleCloseLogin}
          onDone={handleLoginDone}
        />
      )}
    </>
  );
}
