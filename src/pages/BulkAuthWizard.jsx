import { useState, useCallback, useEffect, useRef } from 'react';
import * as api from '../api';
import DevBackendHint from '../components/DevBackendHint';
import { accountNeedsSession } from '../utils/accountSession';

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseEmails(text) {
  return [
    ...new Set(
      text
        .split(/[\n,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.includes('@')),
    ),
  ];
}

function clerkErrorHint(message) {
  if (!message) return '';
  const m = message.toLowerCase();
  if (m.includes('rate') || m.includes('429')) return 'Too many OTP requests send from this IP — wait 5-10 min.';
  if (m.includes('email_code') || m.includes('strategy') || m.includes('not available'))
    return 'Clerk may not offer email_code for this address. Try the Email Link tab instead.';
  return '';
}

const POLL_INTERVAL = 5000; // 5s polling for magic link completion

// ─── Email Link Tab ───────────────────────────────────────────────────────────

function EmailLinkTab({ addToast }) {
  const [pasteText, setPasteText] = useState('');
  // rows: { email, id(accountId), signInId, status: 'idle'|'sending'|'sent'|'done'|'error', message }
  const [rows, setRows] = useState([]);
  const [logLines, setLogLines] = useState([]);
  const [creating, setCreating] = useState(false);
  const [localError, setLocalError] = useState('');
  const pollRefs = useRef({});
  const unmountedRef = useRef(false);

  function appendLog(msg) {
    setLogLines((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 100));
  }

  function updateRow(email, patch) {
    setRows((prev) => prev.map((r) => (r.email === email ? { ...r, ...patch } : r)));
  }

  // Poll a single signInId until done/expired
  function startPolling(email, accountId, signInId) {
    if (unmountedRef.current) return;
    // clear any existing
    if (pollRefs.current[email]) clearInterval(pollRefs.current[email]);
    pollRefs.current[email] = setInterval(async () => {
      if (unmountedRef.current) { clearInterval(pollRefs.current[email]); return; }
      try {
        const res = await api.getMagicLinkStatus(accountId, signInId);
        const st = res?.data?.status ?? res?.status;
        if (st === 'completed_or_expired') {
          clearInterval(pollRefs.current[email]);
          delete pollRefs.current[email];
          // If server says gone it was claimed — check account session
          const accs = await api.getAccounts();
          const list = Array.isArray(accs?.data) ? accs.data : [];
          const acc = list.find((a) => a.id === accountId);
          if (acc && acc.sessionStatus === 'active') {
            updateRow(email, { status: 'done', message: '✓ Signed in' });
            appendLog(`✓ magic link claimed → ${email}`);
            addToast?.(`${email} signed in via magic link`, 'success');
          } else {
            updateRow(email, { status: 'sent', message: 'Waiting for click…' });
          }
        }
      } catch { /* poll errors are non-fatal */ }
    }, POLL_INTERVAL);
  }

  // Instant-detect via window.opener.postMessage (fires when user clicks magic link)
  // Falls back to 5s polling if same-origin message can't reach us
  useEffect(() => {
    function onMessage(evt) {
      if (!evt.data || evt.data.type !== 'hydra:magic-link-done') return;
      const { email, signInId: doneSignInId } = evt.data;
      if (!email) return;
      // Clear the fallback poller for this email
      if (doneSignInId && pollRefs.current[email]) {
        clearInterval(pollRefs.current[email]);
        delete pollRefs.current[email];
      }
      updateRow(email, { status: 'done', message: '✓ Signed in (instant)' });
      appendLog(`✓ postMessage received — magic link claimed → ${email}`);
      addToast?.(`${email} signed in via magic link`, 'success');
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [addToast]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup fallback pollers on unmount
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      for (const t of Object.values(pollRefs.current)) clearInterval(t);
    };
  }, []);

  async function handleCreateAndSend(e) {
    e.preventDefault();
    const emails = parseEmails(pasteText);
    if (!emails.length) { setLocalError('Paste at least one email.'); return; }
    setLocalError('');
    setCreating(true);

    // Create OTP stubs first (same as OTP tab — same DB row)
    let stubResults = [];
    try {
      const res = await api.bulkOtpStubs(emails);
      stubResults = Array.isArray(res?.data) ? res.data : [];
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
      setCreating(false);
      return;
    }

    // Build row list — skip dupes that already exist in DB
    const newRows = [];
    for (const r of stubResults) {
      if (r.account) {
        newRows.push({ email: r.account.email, id: r.account.id, signInId: null, status: 'idle', message: '' });
      }
    }

    if (!newRows.length) {
      setLocalError('No new accounts created — all emails may already exist.');
      setCreating(false);
      return;
    }

    setRows(newRows);
    appendLog(`Created ${newRows.length} account stub(s) — sending magic links in parallel (400ms stagger)…`);

    // Staggered parallel send — 400ms between each to avoid Clerk burst fingerprinting
    // Open all tabs concurrently so user just clicks each one
    await Promise.all(
      newRows.map((row, idx) =>
        new Promise((resolve) => setTimeout(resolve, idx * 400)).then(async () => {
          updateRow(row.email, { status: 'sending', message: 'Sending…' });
          try {
            const res = await api.sendMagicLink(row.id, row.email);
            const signInId = res?.data?.signInId ?? res?.signInId;
            updateRow(row.email, { status: 'sent', signInId, message: '📧 Check inbox — click the link' });
            appendLog(`magic link sent → ${row.email}`);
            if (signInId) startPolling(row.email, row.id, signInId);
          } catch (err) {
            const errMsg = api.formatApiErrorMessage(err);
            updateRow(row.email, { status: 'error', message: errMsg });
            appendLog(`✗ magic link failed → ${row.email}: ${errMsg}`);
          }
        })
      )
    );

    addToast?.(`Sent magic links to ${newRows.length} account(s)`, 'info');
    setCreating(false);
  }


  async function handleResend(row) {
    updateRow(row.email, { status: 'sending', message: 'Re-sending…' });
    try {
      const res = await api.sendMagicLink(row.id, row.email);
      const signInId = res?.data?.signInId ?? res?.signInId;
      updateRow(row.email, { status: 'sent', signInId, message: '📧 Check inbox — click the link' });
      appendLog(`magic link re-sent → ${row.email}`);
      startPolling(row.email, row.id, signInId);
    } catch (err) {
      updateRow(row.email, { status: 'error', message: api.formatApiErrorMessage(err) });
    }
  }

  const statusColors = {
    idle: 'var(--text-tertiary)',
    sending: 'var(--text-secondary)',
    sent: '#f59e0b',
    done: 'var(--status-success)',
    error: 'var(--status-error)',
  };
  const statusIcons = { idle: '○', sending: '⟳', sent: '◉', done: '✓', error: '✗' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <div
        style={{
          background: 'rgba(96, 165, 250, 0.06)',
          border: '1px solid rgba(96, 165, 250, 0.2)',
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: '0.82rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: '#60a5fa' }}>How it works:</strong> Paste emails → Hydra creates account stubs and
        sends a <em>magic link</em> to each inbox. Click the link in your email → Hydra captures the session
        automatically. No 6-digit codes needed.
        <br />
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
          Requires that Clerk's <code>email_link</code> strategy is enabled for OpenRouter accounts.
          Falls back to OTP tab if not supported.
        </span>
      </div>

      <section className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>1. Paste emails</h2>
        <form onSubmit={handleCreateAndSend}>
          <textarea
            className="form-input"
            rows={6}
            placeholder="one email per line (or comma-separated)"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            spellCheck={false}
            style={{ fontFamily: 'var(--font-mono)', minHeight: 100 }}
          />
          {localError && <DevBackendHint message={localError} />}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ marginTop: 'var(--space-sm)' }}
            disabled={creating}
          >
            {creating ? 'Sending magic links…' : 'Create & send magic links'}
          </button>
        </form>
      </section>

      {rows.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>2. Status</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: 'var(--space-sm)' }}>
            Hydra polls every 5s. Once you click the magic link the status turns green.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map((row) => (
              <div
                key={row.email}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 6,
                  fontSize: '0.82rem',
                }}
              >
                <span style={{ color: statusColors[row.status], fontWeight: 700, minWidth: 14, textAlign: 'center' }}>
                  {statusIcons[row.status]}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', flex: 1 }}>{row.email}</span>
                <span style={{ color: statusColors[row.status], fontSize: '0.78rem' }}>{row.message}</span>
                {(row.status === 'sent' || row.status === 'error') && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                    onClick={() => handleResend(row)}
                  >
                    Resend
                  </button>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 'var(--space-sm)', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
            {rows.filter((r) => r.status === 'done').length} / {rows.length} signed in
          </div>
        </section>
      )}

      {logLines.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>Activity log</h2>
          <pre
            style={{
              margin: 0, maxHeight: 160, overflow: 'auto', fontSize: '0.73rem',
              color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}
          >
            {logLines.join('\n')}
          </pre>
        </section>
      )}
    </div>
  );
}

// ─── OTP Tab (existing BulkAuthWizard logic, refactored to sub-component) ────

function OtpTab({ addToast }) {
  const [pasteText, setPasteText] = useState('');
  const [creating, setCreating] = useState(false);
  const [stubSummary, setStubSummary] = useState(null);
  const [queue, setQueue] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [logLines, setLogLines] = useState([]);
  const [signInId, setSignInId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [keyName, setKeyName] = useState('hydra-bulk');
  const [provisionEnabled, setProvisionEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [fetchingKeys, setFetchingKeys] = useState(false);
  const [localError, setLocalError] = useState('');
  const [errorCopyCommand, setErrorCopyCommand] = useState('');

  const current = queue[currentIdx] ?? null;

  function appendLog(msg) {
    setLogLines((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 100));
  }
  function resetErrors() { setLocalError(''); setErrorCopyCommand(''); }

  async function handleCreateStubs(e) {
    e.preventDefault();
    const emails = parseEmails(pasteText);
    if (!emails.length) { setLocalError('Add at least one email.'); return; }
    setLocalError('');
    setCreating(true);
    try {
      const res = await api.bulkOtpStubs(emails);
      const results = Array.isArray(res?.data) ? res.data : [];
      let created = 0, dup = 0, failed = 0;
      const nextQueue = [];
      for (const row of results) {
        if (row.account) {
          created++;
          nextQueue.push({ id: row.account.id, alias: row.account.alias, email: row.account.email, verified: false, skipped: false, managementKey: null });
        } else {
          if (row.skipped === 'duplicate_email') dup++;
          else failed++;
          appendLog(`stub skip/fail ${row.email}: ${row.error || row.skipped || 'unknown'}`);
        }
      }
      setQueue(nextQueue);
      setCurrentIdx(0);
      setStubSummary({ created, duplicateEmail: dup, failed, inputLines: emails.length, resultRows: results.length });
      appendLog(`Stubs: ${created} created, ${dup} duplicate, ${failed} errors`);
      if (nextQueue.length) addToast?.(`Created ${nextQueue.length} OTP row(s)`, 'success');
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
      setErrorCopyCommand(err.hydraCopyCommand ?? '');
    }
    setCreating(false);
  }

  async function handleSendCode() {
    if (!current) return;
    resetErrors();
    setBusy(true);
    try {
      const res = await api.startOTP(current.id, current.email);
      setSignInId(res?.data?.signInId ?? res?.signInId ?? '');
      appendLog(`OTP sent → ${current.email}`);
      addToast?.('Check email for the 6-digit code', 'info');
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
      setErrorCopyCommand(err.hydraCopyCommand ?? '');
    }
    setBusy(false);
  }

  async function handleVerify() {
    if (!current || otpCode.length !== 6) return;
    resetErrors();
    setBusy(true);
    try {
      await api.verifyOTP(current.id, signInId, otpCode);
      appendLog(`verified → ${current.email}`);
      setQueue((q) => q.map((item, i) => (i === currentIdx ? { ...item, verified: true } : item)));
      addToast?.(`${current.email} verified`, 'success');
      setSignInId('');
      setOtpCode('');
      if (provisionEnabled) await handleProvision(true);
      
      // Auto-advance index after success
      setCurrentIdx((i) => {
        const next = Math.min(i + 1, queue.length - 1);
        return next === i ? i : next;
      });
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
      setErrorCopyCommand(err.hydraCopyCommand ?? '');
    }
    setBusy(false);
  }

  async function handleProvision(silent = false) {
    if (!current) return;
    if (!silent) { resetErrors(); setBusy(true); }
    try {
      const res = await api.provisionManagementKey(current.id, keyName);
      const key = res?.data?.key ?? res?.key;
      if (key) {
        setQueue((q) => q.map((item, i) => (i === currentIdx ? { ...item, managementKey: key } : item)));
        appendLog(`provisioned key → ${current.email}`);
      }
    } catch (err) {
      appendLog(`provision failed → ${current.email}: ${err.message}`);
    }
    if (!silent) setBusy(false);
  }

  async function handleFetchKeys() {
    setFetchingKeys(true);
    let fetched = 0, missing = 0;
    for (const item of queue.filter((i) => i.verified)) {
      try {
        const res = await api.getAccountManagementKey(item.id);
        const key = res?.data?.key ?? res?.key;
        if (key) {
          fetched++;
          setQueue((q) => q.map((qi) => (qi.id === item.id ? { ...qi, managementKey: key } : qi)));
          appendLog(`key fetched → ${item.email}`);
        } else {
          missing++;
        }
      } catch { missing++; }
    }
    addToast?.(fetched ? `Fetched ${fetched} key(s)` : `${missing} account(s) not yet provisioned`, fetched ? 'success' : 'warning');
    setFetchingKeys(false);
  }

  async function handleMergeExisting() {
    resetErrors();
    setMergeBusy(true);
    try {
      const res = await api.getAccounts();
      const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      const candidates = list.filter(
        (a) => a.email && (a.authMethod === 'otp' || a.authMethod === 'email') && accountNeedsSession(a.sessionStatus, { hasCredentials: a.hasCredentials })
      );
      let mergedLen = 0;
      setQueue((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        const merged = candidates.filter((a) => !ids.has(a.id)).map((a) => ({
          id: a.id, alias: a.alias, email: a.email, verified: false, skipped: false, fromExisting: true, managementKey: null,
        }));
        mergedLen = merged.length;
        return merged.length ? [...prev, ...merged] : prev;
      });
      if (mergedLen) {
        appendLog(`queue +${mergedLen} existing OTP account(s)`);
        addToast?.(`Added ${mergedLen} existing account(s) to queue`, 'info');
      } else {
        addToast?.('No extra OTP rows need a session', 'info');
      }
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
    }
    setMergeBusy(false);
  }

  function handleSkip() {
    appendLog(`skipped → ${current?.email}`);
    setQueue((q) => q.map((item, i) => (i === currentIdx ? { ...item, skipped: true } : item)));
    setSignInId(''); setOtpCode(''); resetErrors();
    setCurrentIdx((i) => Math.min(i + 1, Math.max(queue.length - 1, 0)));
  }

  const total = queue.length;
  const position = total ? currentIdx + 1 : 0;
  const verifiedCount = queue.filter((q) => q.verified).length;
  const skippedCount = queue.filter((q) => q.skipped).length;
  const errorHint = clerkErrorHint(localError);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <section className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>1. Paste emails</h2>
        <form onSubmit={handleCreateStubs}>
          <textarea
            data-testid="bulk-auth-email-input"
            className="form-input"
            rows={6}
            placeholder="one email per line (or comma-separated)"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            spellCheck={false}
            style={{ fontFamily: 'var(--font-mono)', minHeight: 100 }}
          />
          {localError && !queue.length && <DevBackendHint message={localError} copyCommand={errorCopyCommand} />}
          <button
            type="submit"
            data-testid="bulk-auth-create-stubs"
            className="btn btn-primary"
            style={{ marginTop: 'var(--space-sm)' }}
            disabled={creating}
          >
            {creating ? 'Creating…' : 'Create OTP stubs'}
          </button>
        </form>

        <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--border-subtle)' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
            Already have OTP rows in the vault with no session?
          </p>
          <button
            type="button"
            data-testid="bulk-auth-merge-existing"
            className="btn btn-ghost"
            onClick={() => void handleMergeExisting()}
            disabled={mergeBusy || creating}
          >
            {mergeBusy ? 'Loading…' : 'Add existing OTP accounts (no session)'}
          </button>
        </div>
      </section>

      {stubSummary && (
        <div
          data-testid="bulk-auth-stub-summary"
          style={{
            background: 'rgba(0, 255, 136, 0.06)',
            border: '1px solid rgba(0, 255, 136, 0.25)',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
          }}
        >
          <span style={{ fontWeight: 800, color: 'var(--status-success)', marginRight: 8 }}>[STUB RUN]</span>
          Created <strong>{stubSummary.created}</strong> · Duplicate <strong>{stubSummary.duplicateEmail}</strong> · Errors <strong>{stubSummary.failed}</strong>
          <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>({stubSummary.inputLines} pasted / {stubSummary.resultRows} results)</span>
        </div>
      )}

      {total > 0 && (
        <section className="card">
          <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>2. Sequential auth</h2>
          <p data-testid="bulk-auth-progress" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 4 }}>
            Account {position} of {total}
            {current && (
              <>
                {' — '}
                <strong data-testid="bulk-auth-current-email">{current.email}</strong>
                <span style={{ color: 'var(--text-tertiary)' }}> ({current.alias})</span>
                {current.fromExisting && <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>[existing row]</span>}
              </>
            )}
          </p>
          <p
            data-testid="bulk-auth-completion-progress"
            style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', marginBottom: 'var(--space-md)' }}
          >
            <strong>{verifiedCount}</strong> / {total} verified
            {skippedCount > 0 && <> · <strong>{skippedCount}</strong> skipped</>}
          </p>

          {current && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {localError && (
                <div>
                  <DevBackendHint message={localError} copyCommand={errorCopyCommand} />
                  {errorHint && <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 6 }}>{errorHint}</p>}
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" data-testid="bulk-auth-send-code" className="btn btn-primary" onClick={handleSendCode} disabled={busy}>
                  Send email code
                </button>
                <button type="button" data-testid="bulk-auth-skip" className="btn btn-ghost" onClick={handleSkip} disabled={busy}>
                  Skip this account
                </button>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>6-digit code</label>
                <input
                  data-testid="bulk-auth-otp-input"
                  className="form-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  spellCheck={false}
                  style={{ maxWidth: 160, fontFamily: 'var(--font-mono)', letterSpacing: '0.2em' }}
                />
              </div>

              <button type="button" data-testid="bulk-auth-verify" className="btn btn-primary" onClick={handleVerify} disabled={busy || otpCode.length !== 6 || !signInId}>
                Verify code
              </button>
              {!signInId && <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>Send the code first — then enter the digits from your inbox.</p>}

              <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 'var(--space-sm)', fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    data-testid="bulk-auth-provision-enabled"
                    checked={provisionEnabled}
                    onChange={(e) => setProvisionEnabled(e.target.checked)}
                  />
                  Auto-provision management key (after verify)
                </label>
                {provisionEnabled && (
                  <>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label>Key label</label>
                      <input
                        data-testid="bulk-auth-provision-key-name"
                        className="form-input"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                        spellCheck={false}
                        style={{ maxWidth: 280 }}
                      />
                    </div>
                    <button type="button" data-testid="bulk-auth-provision" className="btn btn-ghost" onClick={() => handleProvision(false)} disabled={busy}>
                      Provision management key
                    </button>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-md)' }}>
                <button type="button" className="btn btn-ghost" onClick={() => { setSignInId(''); setOtpCode(''); resetErrors(); setCurrentIdx((i) => Math.max(i - 1, 0)); }} disabled={busy || currentIdx === 0}>← Previous</button>
                <button type="button" data-testid="bulk-auth-next" className="btn btn-ghost" onClick={() => { setSignInId(''); setOtpCode(''); resetErrors(); setCurrentIdx((i) => Math.min(i + 1, total - 1)); }} disabled={busy || currentIdx >= total - 1}>Next account →</button>
              </div>
            </div>
          )}
        </section>
      )}

      {verifiedCount > 0 && (
        <section className="card">
          <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-xs, 4px)' }}>3. Export credentials</h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-sm)' }}>
            Hydra auto-provisions in background. Click <strong>Fetch provisioned keys</strong> to pull any that are ready.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
            <button type="button" data-testid="bulk-auth-fetch-keys" className="btn btn-ghost" onClick={() => void handleFetchKeys()} disabled={fetchingKeys || busy}>
              {fetchingKeys ? 'Fetching…' : 'Fetch provisioned keys'}
            </button>
            <button
              type="button"
              data-testid="bulk-auth-copy-export"
              className="btn btn-ghost"
              onClick={() => {
                const lines = queue.filter((item) => item.verified && item.managementKey).map((item) => `${item.email}:${item.managementKey}`).join('\n');
                if (!lines) { addToast?.('No keys captured yet — fetch first', 'warning'); return; }
                navigator.clipboard?.writeText(lines).then(() => addToast?.('Copied to clipboard', 'success'), () => addToast?.('Clipboard unavailable', 'warning'));
              }}
              disabled={!queue.some((item) => item.verified && item.managementKey)}
            >
              Copy all to clipboard
            </button>
          </div>
          <textarea
            data-testid="bulk-auth-export-textarea"
            className="form-input"
            readOnly
            rows={Math.min(Math.max(queue.filter((item) => item.verified).length, 3), 12)}
            value={queue.filter((item) => item.verified).map((item) => item.managementKey ? `${item.email}:${item.managementKey}` : `${item.email}:(no key yet)`).join('\n')}
            spellCheck={false}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-secondary)', minHeight: 80, resize: 'vertical' }}
          />
          <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 6 }}>
            {queue.filter((item) => item.verified && item.managementKey).length} / {verifiedCount} keys captured
            {queue.some((item) => item.verified && !item.managementKey) ? ' — some pending (retry in a few seconds)' : ''}
          </p>
        </section>
      )}

      <section className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>Activity log</h2>
        <pre
          data-testid="bulk-auth-log"
          style={{
            margin: 0, maxHeight: 200, overflow: 'auto', fontSize: '0.75rem',
            color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}
        >
          {logLines.length ? logLines.join('\n') : 'No events yet.'}
        </pre>
      </section>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'otp', label: '# OTP', subtitle: 'Enter 6-digit code' },
  { id: 'email-link', label: '✉ Email Link', subtitle: 'One click link' },
];

export default function BulkAuthWizard({ addToast }) {
  const [activeTab, setActiveTab] = useState('otp');

  return (
    <div className="page-container" style={{ maxWidth: 740 }}>
      <header className="page-header page-header--intro" style={{ marginBottom: 'var(--space-lg)' }}>
        <div>
          <h2 style={{ margin: 0 }}>Bulk Account Import</h2>
          <p className="page-header__lede">
            Import OpenRouter accounts into Hydra. Choose <strong>Email Link</strong> for a one-click sign-in (no
            code needed), or <strong>OTP</strong> to enter a 6-digit code per account.
          </p>
        </div>
      </header>

      {/* Tab switcher */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 'var(--space-lg)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 10,
          padding: 4,
        }}
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '10px 16px',
                borderRadius: 7,
                border: 'none',
                cursor: 'pointer',
                background: active ? 'var(--accent-primary)' : 'transparent',
                color: active ? '#000' : 'var(--text-secondary)',
                fontWeight: active ? 700 : 400,
                fontSize: '0.9rem',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
              <span style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: 2, fontWeight: 400 }}>{tab.subtitle}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'email-link' && <EmailLinkTab addToast={addToast} />}
      {activeTab === 'otp' && <OtpTab addToast={addToast} />}
    </div>
  );
}
