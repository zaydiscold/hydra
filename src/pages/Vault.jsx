import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api';
import LoginAccountModal from '../components/LoginAccountModal';
import { VaultIcon, RefreshIcon, LockIcon, SettingsIcon, ShieldIcon, EditIcon, TrashIcon } from '../components/Icons';
import { accountNeedsSession } from '../utils/accountSession';
import SessionDot from '../components/SessionDot';
import { timeAgo } from '../utils/time';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBalance(n) {
  if (n == null) return '—';
  return `$${Number(n).toFixed(2)}`;
}

function exportAccountsCSV(accounts) {
  const headers = ['id', 'alias', 'email', 'authMethod', 'sessionStatus', 'hasManagementKey', 'lastLoginAt'];
  const rows = accounts.map((a) =>
    headers.map((h) => `"${(a[h] ?? '').toString().replace(/"/g, '""')}"`).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url;
  el.download = `hydra-vault-${new Date().toISOString().slice(0, 10)}.csv`;
  el.click();
  URL.revokeObjectURL(url);
}



// ─── Vault Page ───────────────────────────────────────────────────────────────

export default function Vault({ addToast }) {
  const [accounts, setAccounts] = useState([]);
  const [liveStatuses, setLiveStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [loginModalAccount, setLoginModalAccount] = useState(null);
  const [provisioningId, setProvisioningId] = useState(null);
  const [editModal, setEditModal] = useState(null); // { acc, value }
  const [deleteModal, setDeleteModal] = useState(null); // acc
  const warnedRef = useRef(false);

  // ── Load accounts from dashboard endpoint ──
  const loadAccounts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.getDashboard();
      const accts = res?.data?.accounts ?? [];
      setAccounts(accts);

      // Use server-provided liveStatuses if present
      if (res?.data?.liveStatuses && Object.keys(res.data.liveStatuses).length > 0) {
        setLiveStatuses(res.data.liveStatuses);
      } else {
        // Kick off client-side probe
        probeStatuses(accts);
      }

      // P21 — expiry warning toast (once per load)
      if (!warnedRef.current && addToast) {
        const now = Date.now();
        const expiring = accts.filter((a) => {
          if (!a.sessionExpiry) return false;
          const exp = new Date(a.sessionExpiry).getTime();
          return exp > now && exp - now < 12 * 60 * 60 * 1000;
        });
        if (expiring.length > 0) {
          addToast(
            `⚠ ${expiring.length} session(s) expiring <12h: ${expiring.map((a) => a.alias).join(', ')}`,
            'warning'
          );
          warnedRef.current = true;
        }
      }
    } catch (err) {
      if (addToast) addToast(err.message || 'Failed to load vault', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // ── Concurrency-limited session probe ──
  async function probeStatuses(accts) {
    if (!accts.length) return;
    setProbing(true);
    const results = {};
    const queue = [...accts];
    const CONCURRENCY = 3;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const acct = queue.shift();
        try {
          const r = await api.getSessionStatus(acct.id);
          results[acct.id] = r?.status ?? 'unknown';
        } catch {
          results[acct.id] = 'unknown';
        }
      }
    });
    await Promise.all(workers);
    setLiveStatuses((prev) => ({ ...prev, ...results }));
    setProbing(false);
  }

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // Auto-refresh every 10 minutes while page is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) loadAccounts(true);
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadAccounts]);

  // ── Provision management key ──
  const handleProvision = useCallback(async (acc) => {
    setProvisioningId(acc.id);
    try {
      const res = await api.provisionManagementKey(acc.id);
      if (!res?.data?.key) throw new Error(res?.error?.message || res?.message || 'Provisioning did not return a key');
      if (addToast) addToast(`Key provisioned for ${acc.alias}`, 'success');
      loadAccounts(true);
    } catch (err) {
      if (addToast) addToast(`Provision failed: ${err.message}`, 'error');
    } finally {
      setProvisioningId(null);
    }
  }, [addToast, loadAccounts]);
  
  const handleEdit = useCallback((acc) => {
    setEditModal({ acc, value: acc.alias });
  }, []);

  const commitEdit = useCallback(async () => {
    const { acc, value } = editModal;
    setEditModal(null);
    if (!value || value === acc.alias) return;
    try {
      await api.updateAccount(acc.id, { alias: value });
      addToast('Account alias updated', 'success');
      loadAccounts(true);
    } catch (err) {
      addToast(`Update failed: ${err.message}`, 'error');
    }
  }, [editModal, addToast, loadAccounts]);

  const handleDelete = useCallback((acc) => {
    setDeleteModal(acc);
  }, []);

  const commitDelete = useCallback(async () => {
    const acc = deleteModal;
    setDeleteModal(null);
    try {
      await api.deleteAccount(acc.id);
      addToast('Account deleted', 'success');
      loadAccounts(true);
    } catch (err) {
      addToast(`Delete failed: ${err.message}`, 'error');
    }
  }, [deleteModal, addToast, loadAccounts]);

  const handleRefreshLogin = useCallback(async (acc) => {
    try {
      const res = await api.refreshAccountLogin(acc.id);
      if (res?.data?.recovered) {
        if (addToast) addToast(`✓ ${acc.alias} session recovered silently`, 'success');
        loadAccounts(true);
      } else {
        if (addToast) addToast(`Session cleared for ${acc.alias} — re-auth needed`, 'info');
        setLoginModalAccount(acc);
        loadAccounts(true);
      }
    } catch (err) {
      if (addToast) addToast(`Refresh failed: ${err.message}`, 'error');
    }
  }, [addToast, loadAccounts]);

  // ── Login modal ──
  const handleLoginDone = useCallback((msg) => {
    if (addToast) addToast(msg, 'success');
    setLoginModalAccount(null);
    loadAccounts(true);
  }, [addToast, loadAccounts]);

  // ── Computed totals ──
  const totalBalance = accounts.reduce((s, a) => s + (a.credits?.remaining ?? 0), 0);
  const activeCount = Object.values(liveStatuses).filter((s) => s === 'active').length
    || accounts.filter((a) => a.sessionStatus === 'active').length;
  const expiredCount = accounts.filter((a) => {
    const s = liveStatuses[a.id] ?? a.sessionStatus;
    return s === 'expired';
  }).length;

  if (loading && accounts.length === 0) {
    return (
      <div className="animate-fade-in">
        <div className="page-header">
          <div className="skeleton-shimmer" style={{ width: 260, height: 40, marginBottom: 8 }} />
        </div>
        <div className="card skeleton-shimmer" style={{ height: 400, border: 'none' }} />
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div style={{ color: 'var(--accent-primary)', opacity: 0.9 }}>
            <VaultIcon size={40} />
          </div>
          <div>
            <h2 style={{ margin: 0 }}>Vault</h2>
            <p style={{ margin: 0, marginTop: 2, color: 'var(--text-secondary)' }}>
              All accounts — parallel overview
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {probing && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="spinner-sm" /> probing…
            </span>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => exportAccountsCSV(accounts)}
            disabled={accounts.length === 0}
            title="Download account metadata as CSV (no secrets exported)"
          >
            ↓ Export CSV
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => loadAccounts(true)}
            disabled={loading || probing}
            style={{ gap: 8 }}
          >
            <span className={loading ? 'spin-inline' : ''}>↻</span>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="stats-grid" style={{ marginBottom: 'var(--space-lg)' }}>
        <div className="stat-card stat-card-highlight shine-sweep animate-spring stagger-delay-0">
          <div className="stat-card-label">Total Balance</div>
          <div className="stat-card-value success mono">{fmtBalance(totalBalance)}</div>
          <div className="stat-card-sub">across {accounts.length} accounts</div>
        </div>
        <div className="stat-card shine-sweep animate-spring stagger-delay-50">
          <div className="stat-card-label">Active Sessions</div>
          <div className="stat-card-value success mono">{activeCount}</div>
        </div>
        <div className="stat-card shine-sweep animate-spring stagger-delay-100">
          <div className="stat-card-label">Expired Sessions</div>
          <div className="stat-card-value error mono">{expiredCount}</div>
          {expiredCount > 0 && (
            <div className="stat-card-sub" style={{ color: 'var(--status-error)' }}>needs re-auth</div>
          )}
        </div>
      </div>

      {/* Vault table */}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead>
            <tr style={{ background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-subtle)' }}>
              {['Alias', 'Email / Auth', 'Balance', 'Keys', 'Session', 'Actions'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    padding: '12px 16px',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary)',
                    textAlign: i >= 2 ? 'right' : 'left',
                    ...(i === 4 ? { textAlign: 'center' } : {}),
                    ...(i === 5 ? { textAlign: 'right' } : {}),
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  No accounts in vault.
                </td>
              </tr>
            )}
            {accounts.map((acc) => {
              const sessionStatus = liveStatuses[acc.id] ?? acc.sessionStatus ?? 'none';
              const needsSession = accountNeedsSession(sessionStatus, { hasCredentials: acc.hasCredentials });
              const provisioning = provisioningId === acc.id;
              const canProvision = sessionStatus === 'active' && acc.hasCredentials;

              return (
                <tr
                  key={acc.id}
                  style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  {/* Alias */}
                  <td style={{ padding: '12px 16px', fontWeight: 700, fontFamily: 'monospace', fontSize: '0.9rem' }}>
                    {acc.alias}
                    {acc.hasManagementKey && (
                      <span className="badge badge-info" style={{ marginLeft: 6, fontSize: '0.65rem', padding: '1px 5px' }}>MK</span>
                    )}
                  </td>

                  {/* Email / Auth */}
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{acc.email || '—'}</div>
                    {acc.authMethod && (
                      <span
                        className="badge badge-neutral"
                        style={{ fontSize: '0.65rem', padding: '1px 5px', marginTop: 3, display: 'inline-block' }}
                      >
                        [{acc.authMethod?.toUpperCase()}]
                      </span>
                    )}
                  </td>

                  {/* Balance */}
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                    {acc.status === 'error' ? (
                      <span style={{ color: 'var(--status-error)' }} title={acc.error}>ERR</span>
                    ) : (
                      <>
                        <div style={{ color: 'var(--status-success)' }}>{fmtBalance(acc.credits?.remaining)}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                          / {fmtBalance(acc.credits?.total)}
                        </div>
                      </>
                    )}
                  </td>

                  {/* Keys */}
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: '0.85rem' }}>
                    <div style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                      {acc.keys?.active ?? 0}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>active</div>
                  </td>

                  {/* Session */}
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <SessionDot status={sessionStatus} hasManagementKey={!!acc.hasManagementKey} hasCredentials={!!acc.hasCredentials} />
                      <div style={{ fontSize: '0.8rem' }}>
                        <div style={{ textTransform: 'capitalize', fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {sessionStatus === 'unknown' ? (
                            <><span className="spinner-sm" style={{ width: 10, height: 10 }} /><span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>probing…</span></>
                          ) : sessionStatus}
                        </div>
                        {acc.lastLoginAt && sessionStatus !== 'none' && sessionStatus !== 'unknown' && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                            {timeAgo(acc.lastLoginAt)}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      {needsSession && acc.hasCredentials && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setLoginModalAccount(acc)}
                          title="Authenticate to establish a session"
                          style={{ padding: '4px 10px' }}
                        >
                          <LockIcon size={13} />
                          <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>Unlock</span>
                        </button>
                      )}
                      {!needsSession && acc.hasCredentials && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm btn-icon"
                          onClick={() => handleRefreshLogin(acc)}
                          title="Refresh session (re-auth)"
                        >
                          <RefreshIcon size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm btn-icon"
                        onClick={() => handleEdit(acc)}
                        title="Edit alias"
                      >
                        <EditIcon size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm btn-icon"
                        onClick={() => handleDelete(acc)}
                        title="Delete account"
                        style={{ color: 'var(--status-error)' }}
                      >
                        <TrashIcon size={14} />
                      </button>
                      {canProvision && !acc.hasManagementKey && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleProvision(acc)}
                          disabled={provisioning}
                          title="Provision management key"
                          style={{ padding: '4px 10px' }}
                        >
                          {provisioning ? (
                            <><div className="spinner" style={{ width: 10, height: 10 }} /> Wait…</>
                          ) : (
                            <><SettingsIcon size={13} /><span style={{ fontSize: '0.72rem', fontWeight: 600 }}>Provision</span></>
                          )}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>

          {/* Totals footer */}
          {accounts.length > 0 && (
            <tfoot>
              <tr style={{ background: 'var(--bg-secondary)', borderTop: '2px solid var(--border-subtle)' }}>
                <td
                  colSpan={2}
                  style={{ padding: '10px 16px', fontSize: '0.78rem', color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}
                >
                  <ShieldIcon size={12} style={{ marginRight: 6, opacity: 0.6 }} />
                  {accounts.length} accounts · {activeCount} active · {expiredCount} expired
                </td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--status-success)', fontSize: '0.9rem' }}>
                  {fmtBalance(totalBalance)}
                </td>
                <td colSpan={3} style={{ padding: '10px 16px', fontSize: '0.72rem', color: 'var(--text-tertiary)', textAlign: 'right' }}>
                  total remaining
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {loginModalAccount && (
        <LoginAccountModal
          account={loginModalAccount}
          onClose={() => setLoginModalAccount(null)}
          onDone={handleLoginDone}
        />
      )}

      {/* Inline edit alias modal */}
      {editModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '24px 28px', minWidth: 340, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontWeight: 600 }}>Rename account</div>
            <input
              autoFocus
              value={editModal.value}
              onChange={(e) => setEditModal((m) => ({ ...m, value: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditModal(null); }}
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 10px', color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setEditModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={commitEdit}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Inline delete confirm modal */}
      {deleteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '24px 28px', minWidth: 340, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontWeight: 600 }}>Delete {deleteModal.alias}?</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>This will also remove any stored management keys and pooled API keys. This cannot be undone.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setDeleteModal(null)}>Cancel</button>
              <button className="btn" style={{ background: 'var(--error)', color: '#fff' }} onClick={commitDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
