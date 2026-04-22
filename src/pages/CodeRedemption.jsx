import { useState, useEffect, useMemo, useRef } from 'react';
import * as api from '../api';

const STATUS = {
  idle: null,
  pending: 'pending',
  success: 'success',
  error: 'error',
};

function StatusCell({ status, error, errorCode, result }) {
  if (!status) return <span className="text-secondary mono">—</span>;
  
  if (status === 'pending') {
    return (
      <div className="status-cell">
        <div className="status-dot warning" />
        <span className="mono" style={{ color: 'var(--status-info)' }}>Running</span>
      </div>
    );
  }
  
  if (status === 'success') {
    const credits = result?.result?.credits ?? result?.credits;
    const delta =
      result?.creditsBefore != null && result?.creditsAfter != null
        ? Number(result.creditsAfter.total) - Number(result.creditsBefore.total)
        : null;
    let label = 'OK';
    if (credits != null && credits !== '') label = `+$${credits}`;
    else if (delta != null && !Number.isNaN(delta) && delta > 0) label = `+${delta} cr`;
    const tip = [result?.message, result?.verification && `verify: ${result.verification}`, result?.uiFeedback]
      .filter(Boolean)
      .join('\n');
    return (
      <div className="status-cell">
        <div className="status-dot success" />
        <span className="mono" style={{ color: 'var(--status-success)', cursor: tip ? 'help' : undefined }} title={tip || undefined}>
          {label}
        </span>
      </div>
    );
  }
  
  if (status === 'error') {
    const short = error?.length > 32 ? error.slice(0, 32) + '…' : error;
    const code = errorCode ?? result?.errorCode;
    const uiFeedback = result?.uiFeedback;
    const tip = [code ? `${code}: ${error}` : error, uiFeedback].filter(Boolean).join('\n\n');
    return (
      <div className="status-cell">
        <div className="status-dot error" />
        <span className="mono" style={{ color: 'var(--status-error)', fontSize: '0.75rem', cursor: 'help' }} title={tip}>
          {short}
        </span>
      </div>
    );
  }
  return null;
}

export default function CodeRedemption({ addToast }) {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);
  const [codes, setCodes] = useState('');
  const [results, setResults] = useState({});  // { `${ci}_${accountId}`: { status, error, result } }
  const [running, setRunning] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [sessionPreflight, setSessionPreflight] = useState({
    loading: false,
    allReady: true,
    blocked: [],
    ready: [],
    error: null,
  });
  const didInitialLoadRef = useRef(false);
  const [historyLogs, setHistoryLogs] = useState([]);

  function fetchHistory() {
    api.getRedemptionLogs()
      .then(res => setHistoryLogs(Array.isArray(res?.data) ? res.data : []))
      .catch(() => {}); // non-fatal
  }

  const blockedAccountIds = useMemo(
    () => new Set((sessionPreflight.blocked || []).map((b) => b.accountId)),
    [sessionPreflight.blocked]
  );

  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    api.getAccounts()
      .then(res => {
        const accs = Array.isArray(res.data) ? res.data : [];
        setAccounts(accs);
        // Default select all
        setSelectedAccountIds(accs.map(a => a.id));
        setSelectAll(true);
      })
      .catch(err => addToast(err.message, 'error'));
    fetchHistory();
  }, [addToast]);

  useEffect(() => {
    if (selectedAccountIds.length === 0) {
      setSessionPreflight({
        loading: false,
        allReady: true,
        blocked: [],
        ready: [],
        error: null,
      });
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setSessionPreflight((p) => ({ ...p, loading: true, error: null }));
      const ids = [...selectedAccountIds];
      api
        .preflightRedeemAccounts(ids)
        .then((res) => {
          if (cancelled) return;
          const d = res.data;
          setSessionPreflight({
            loading: false,
            allReady: Boolean(d?.allReady),
            blocked: d?.blocked || [],
            ready: d?.ready || [],
            error: null,
          });
        })
        .catch((err) => {
          if (cancelled) return;
          setSessionPreflight({
            loading: false,
            allReady: true,
            blocked: [],
            ready: [],
            error: err.message || 'Preflight failed',
          });
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [selectedAccountIds]);

  function toggleAccount(id) {
    setSelectedAccountIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function toggleAll() {
    if (selectAll) {
      setSelectedAccountIds([]);
      setSelectAll(false);
    } else {
      setSelectedAccountIds(accounts.map(a => a.id));
      setSelectAll(true);
    }
  }

  const codeList = useMemo(() => {
    return codes.split('\n').map(c => c.trim()).filter(Boolean);
  }, [codes]);

  function resultKey(code, accountId) {
    return `${code}_${accountId}`;
  }

  async function handleRun() {
    if (codeList.length === 0) return addToast('Enter at least one code', 'error');
    if (selectedAccountIds.length === 0) return addToast('Select at least one account', 'error');

    const codesToRun = [...codeList];
    const accountIdsToRun = [...selectedAccountIds];

    try {
      const pfRes = await api.preflightRedeemAccounts(accountIdsToRun);
      const pf = pfRes.data;
      if (!pf?.allReady) {
        const blocked = pf?.blocked || [];
        const names = blocked.map((b) => b.alias || String(b.accountId).slice(0, 8)).join(', ');
        addToast(
          `${blocked.length} account(s) cannot redeem: no dashboard session or stored password (management keys are not enough). ${names ? `Blocked: ${names}` : ''}`,
          'error'
        );
        return;
      }
    } catch (err) {
      addToast(err.message || 'Session check failed', 'error');
      return;
    }

    setRunning(true);
    setResults({});
    const newResults = {};

    const assignments = [];
    const buckets = new Map();
    for (let ci = 0; ci < codesToRun.length; ci++) {
      const code = codesToRun[ci];
      for (const accountId of accountIdsToRun) {
        const key = resultKey(code, accountId);
        const pendingResult = { status: STATUS.pending };
        newResults[key] = pendingResult;
        const bucketKey = `${accountId}::${code}`;
        const bucket = buckets.get(bucketKey) || [];
        bucket.push(key);
        buckets.set(bucketKey, bucket);
        assignments.push({ accountId, code });
      }
    }

    setResults(newResults);

    try {
      const res = await api.bulkMatrixRedeem(assignments);
      const payload = res?.data ?? res ?? [];
      const batch = Array.isArray(payload) ? payload : (payload?.data ?? payload?.results ?? []);
      if (!batch.length && payload?.error) addToast(payload.error, 'error');
      if (!Array.isArray(batch)) throw new Error('Bulk redeem returned an invalid response');

      for (const item of batch) {
        const bucketKey = `${item.accountId}::${item.code}`;
        const bucket = buckets.get(bucketKey);
        if (!bucket || bucket.length === 0) continue;
        const key = bucket.shift();
        const isFailure = item.success === false;
        newResults[key] = isFailure
          ? {
              status: STATUS.error,
              error: item.message || item.error || 'Redemption failed',
              errorCode: item.errorCode,
              result: item,
            }
          : { status: STATUS.success, result: item };
      }

      for (const bucket of buckets.values()) {
        while (bucket.length > 0) {
          const key = bucket.shift();
          newResults[key] = { status: STATUS.error, error: 'No response from bulk redeem' };
        }
      }
    } catch (err) {
      const errorMessage = err.message || 'Bulk redeem failed';
      for (const assignment of assignments) {
        const key = resultKey(assignment.code, assignment.accountId);
        newResults[key] = { status: STATUS.error, error: errorMessage };
      }
      addToast(errorMessage, 'error');
    }

    setResults({ ...newResults });
    setRunning(false);
    const successCount = Object.values(newResults).filter(v => v.status === STATUS.success).length;
    const total = Object.keys(newResults).length;
    addToast(`Done: ${successCount}/${total} redeemed`, successCount > 0 ? 'success' : 'error');
    // Refresh history after a run
    setTimeout(fetchHistory, 400);
  }

  function clearAll() {
    setCodes('');
    setResults({});
  }

  const hasResults = Object.keys(results).length > 0;
  const successCount = Object.values(results).filter(v => v.status === STATUS.success).length;
  const errorCount = Object.values(results).filter(v => v.status === STATUS.error).length;
  const pendingCount = Object.values(results).filter(v => v.status === STATUS.pending).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Code Redeemer</h2>
        </div>
      </div>

      {sessionPreflight.loading && selectedAccountIds.length > 0 && (
        <p className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 'var(--space-sm)' }}>
          Checking dashboard sessions for selected accounts…
        </p>
      )}
      {sessionPreflight.error && (
        <p style={{ fontSize: '0.78rem', color: 'var(--status-warning)', marginBottom: 'var(--space-sm)' }}>
          Could not verify sessions: {sessionPreflight.error} — you can still try Run; it will re-check.
        </p>
      )}
      {sessionPreflight.blocked?.length > 0 && !sessionPreflight.loading && (
        <div style={{ marginBottom: 'var(--space-sm)', fontSize: '0.78rem', color: 'var(--status-error)', fontFamily: 'var(--font-mono)' }}>
          ✕ {sessionPreflight.blocked.length} blocked: {sessionPreflight.blocked.map(b => b.alias || b.accountId.slice(0, 8)).join(', ')} — no session or password on file
        </div>
      )}

      {/* Run summary */}
      {hasResults && (
        <div className="stats-grid stats-grid-compact">
          <div className="stat-card stat-card-sm shine-sweep animate-spring stagger-delay-0">
            <div className="stat-card-label">Succeeded</div>
            <div className="stat-card-value success mono">{successCount}</div>
          </div>
          <div className="stat-card stat-card-sm shine-sweep animate-spring stagger-delay-50">
            <div className="stat-card-label">Failed</div>
            <div className="stat-card-value error mono">{errorCount}</div>
          </div>
          <div className="stat-card stat-card-sm shine-sweep animate-spring stagger-delay-100">
            <div className="stat-card-label">Pending</div>
            <div className="stat-card-value warning mono">{pendingCount}</div>
          </div>
          <div className="stat-card stat-card-sm shine-sweep animate-spring stagger-delay-150">
            <div className="stat-card-label">Total</div>
            <div className="stat-card-value accent mono">{codeList.length * selectedAccountIds.length}</div>
          </div>
        </div>
      )}

      {/* Progress Bar (Visible during and after run) */}
      {hasResults && (
        <div className="card animate-spring stagger-delay-200" style={{ marginBottom: 'var(--space-lg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            <span>Progress</span>
            <span>{Math.round(((codeList.length * selectedAccountIds.length - pendingCount) / (codeList.length * selectedAccountIds.length)) * 100)}%</span>
          </div>
          <div className="balance-bar balance-bar-mini">
            <div
              className={`balance-bar-fill ${running ? 'pulse-anim' : ''}`}
              style={{ width: `${((codeList.length * selectedAccountIds.length - pendingCount) / (codeList.length * selectedAccountIds.length)) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 'var(--space-md)' }}>
        {/* Left: Account selector */}
        <div className="col-sidebar" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)' }}>Accounts</span>
            <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', minHeight: 'unset', fontSize: '0.68rem' }} onClick={toggleAll} disabled={running}>
              {selectAll ? 'Clear' : 'All'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {accounts.length === 0 ? (
              <p className="text-muted" style={{ fontSize: '0.85rem' }}>No accounts. Add accounts first.</p>
            ) : (
              accounts.map((account) => {
                const accountSuffix = `_${account.id}`;
                const accSuccesses = Object.entries(results).filter(
                  ([k, v]) => k.endsWith(accountSuffix) && v.status === STATUS.success
                ).length;
                const accErrors = Object.entries(results).filter(
                  ([k, v]) => k.endsWith(accountSuffix) && v.status === STATUS.error
                ).length;

                return (
                  <div
                    key={account.id}
                    className={`account-item ${selectedAccountIds.includes(account.id) ? 'selected' : ''} ${blockedAccountIds.has(account.id) ? 'account-item-preflight-warn' : ''}`}
                    style={{ padding: '5px 8px', gap: 6 }}
                    onClick={() => !running && toggleAccount(account.id)}
                  >
                    <div className="account-item-checkbox" style={{ width: 14, height: 14, flexShrink: 0 }} />
                    <div className="account-item-content" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.alias}</div>
                    </div>
                    {hasResults && (
                      <div style={{ display: 'flex', gap: 3, flexShrink: 0, marginLeft: 'auto' }}>
                        {accSuccesses > 0 && <span style={{ fontSize: '0.6rem', color: 'var(--status-success)', fontWeight: 700 }}>{accSuccesses}✓</span>}
                        {accErrors > 0 && <span style={{ fontSize: '0.6rem', color: 'var(--status-error)', fontWeight: 700 }}>{accErrors}✕</span>}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', marginTop: 'auto', padding: '12px 0' }}>
            {selectedAccountIds.length} of {accounts.length} SELECTED
          </div>
        </div>

        {/* Right: Code input */}
        <div className="col-main" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)' }}>Promo Codes</span>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {codeList.length > 0 ? `${codeList.length} code${codeList.length > 1 ? 's' : ''}` : ''}
            </span>
          </div>
          <textarea
            className="code-textarea-neo"
            style={{ minHeight: 180, resize: 'vertical' }}
            placeholder={"One code per line:\n\nHYDRA-XXXX-YYYY\nCREDIT100-XYZ"}
            value={codes}
            onChange={(e) => setCodes(e.target.value)}
            disabled={running}
            spellCheck={false}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {codeList.length * selectedAccountIds.length > 0
                ? `${codeList.length} × ${selectedAccountIds.length} = ${codeList.length * selectedAccountIds.length} redemption${codeList.length * selectedAccountIds.length !== 1 ? 's' : ''}`
                : ''}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {hasResults && (
                <button className="btn btn-secondary btn-sm" onClick={clearAll} disabled={running}>Clear</button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleRun}
                disabled={
                  running ||
                  sessionPreflight.loading ||
                  codeList.length === 0 ||
                  selectedAccountIds.length === 0 ||
                  (sessionPreflight.blocked?.length > 0 && !sessionPreflight.error)
                }
              >
                {running
                  ? <><div className="spinner-sm" /> Running ({pendingCount} left)…</>
                  : `Run ${codeList.length > 0 && selectedAccountIds.length > 0 ? `(${codeList.length} × ${selectedAccountIds.length})` : ''}`
                }
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Results matrix */}
      {hasResults && codeList.length > 0 && selectedAccountIds.length > 0 && (
        <div style={{ marginTop: 'var(--space-xl)' }}>
          <div className="section-header">
            <h3>Results Matrix</h3>
            <span className="section-count">{successCount} succeeded</span>
          </div>
          <div className="table-container animate-spring stagger-delay-250">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  {selectedAccountIds.map(id => {
                    const acc = accounts.find(a => a.id === id);
                    return <th key={id}>{acc?.alias || id.slice(0, 8)}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {codeList.map((code) => (
                  <tr key={code}>
                    <td><code style={{ fontSize: '0.78rem' }}>{code}</code></td>
                    {selectedAccountIds.map(accountId => {
                      const key = resultKey(code, accountId);
                      const r = results[key] || {};
                      return (
                        <td key={accountId}>
                          <StatusCell
                            status={r.status}
                            error={r.error}
                            errorCode={r.errorCode}
                            result={r.result}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Redemption History — P16 */}
      {historyLogs.length > 0 && (
        <div style={{ marginTop: 'var(--space-xl)' }}>
          <div className="section-header">
            <h3>Recent Redemptions</h3>
            <span className="section-count">{historyLogs.length}</span>
          </div>
          <div className="table-container animate-spring" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Account</th>
                  <th>Result</th>
                  <th style={{ textAlign: 'right' }}>When</th>
                </tr>
              </thead>
              <tbody>
                {historyLogs.map((log, i) => (
                  <tr key={i}>
                    <td><code style={{ fontSize: '0.78rem' }}>{log.codePreview}</code></td>
                    <td style={{ fontSize: '0.82rem' }}>{log.accountAlias}</td>
                    <td>
                      {log.success
                        ? <span style={{ color: 'var(--status-success)', fontWeight: 700, fontSize: '0.82rem' }}>
                            ✓ {log.creditsAdded != null ? `+$${log.creditsAdded}` : 'OK'}
                          </span>
                        : <span style={{ color: 'var(--status-error)', fontSize: '0.78rem' }} title={log.message}>
                            ✕ {log.message?.slice(0, 28) || 'Failed'}
                          </span>
                      }
                    </td>
                    <td style={{ textAlign: 'right', fontSize: '0.72rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                      {log.at ? new Date(log.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
