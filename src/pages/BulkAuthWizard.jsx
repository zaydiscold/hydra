import { useState, useCallback } from 'react';
import * as api from '../api';
import DevBackendHint from '../components/DevBackendHint';
import { accountNeedsSession } from '../utils/accountSession';

function parseEmails(text) {
  const parts = text
    .split(/[\n,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const e of parts) {
    if (!seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

function clerkErrorHint(message) {
  if (!message || typeof message !== 'string') return null;
  const m = message.toLowerCase();
  if (m.includes('oauth') || m.includes('social') || m.includes('google'))
    return 'This address may be OAuth-only on OpenRouter. Skip this row and sign in with password or paste a session cookie via Monitor → Bulk Import.';
  if (m.includes('email_code') || m.includes('strategy') || m.includes('not available'))
    return 'Clerk may not offer email code for this address. Try password auth from Monitor, or import a session cookie.';
  return null;
}

/**
 * Paste many OpenRouter emails → create OTP stubs → authenticate one at a time (Clerk email code).
 * External automation should target data-testid attributes on this page, not openrouter.ai.
 */
export default function BulkAuthWizard({ addToast }) {
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
  const [localError, setLocalError] = useState('');
  const [errorCopyCommand, setErrorCopyCommand] = useState('');

  const resetErrors = useCallback(() => {
    setLocalError('');
    setErrorCopyCommand('');
  }, []);

  const appendLog = useCallback((line) => {
    setLogLines((prev) => [...prev.slice(-80), `${new Date().toISOString().slice(11, 19)} ${line}`]);
  }, []);

  const current = queue[currentIdx] ?? null;

  async function handleCreateStubs(e) {
    e?.preventDefault?.();
    const emails = parseEmails(pasteText);
    if (!emails.length) {
      setLocalError('Add at least one email.');
      setErrorCopyCommand('');
      return;
    }
    resetErrors();
    setCreating(true);
    try {
      const res = await api.bulkOtpStubs(emails);
      const payload = res?.data ?? res ?? {};
      const results = payload.results ?? [];
      let created = 0;
      let dup = 0;
      let failed = 0;
      const nextQueue = [];
      for (const row of results) {
        if (row.success && row.account?.id) {
          created += 1;
          nextQueue.push({
            id: row.account.id,
            alias: row.account.alias,
            email: row.account.email,
            verified: false,
            skipped: false,
          });
        } else {
          if (row.skipped === 'duplicate_email') dup += 1;
          else failed += 1;
          appendLog(`stub skip/fail ${row.email}: ${row.error || row.skipped || 'unknown'}`);
        }
      }
      setStubSummary({
        created,
        duplicateEmail: dup,
        failed,
        inputLines: emails.length,
        resultRows: results.length,
      });
      setQueue(nextQueue);
      setCurrentIdx(0);
      setSignInId('');
      setOtpCode('');
      appendLog(`Stubs: ${created} created, ${dup} duplicate email, ${failed} other errors (${emails.length} unique emails pasted).`);
      if (nextQueue.length) addToast?.(`Created ${nextQueue.length} OTP account row(s)`, 'success');
      else addToast?.('No new stubs — check duplicates or errors in the log', 'warning');
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
      setErrorCopyCommand(err.hydraCopyCommand ?? '');
      addToast?.(err.message, 'error');
    }
    setCreating(false);
  }

  async function handleSendCode() {
    if (!current) return;
    resetErrors();
    setBusy(true);
    try {
      const res = await api.startOTP(current.id, current.email);
      const sid = res?.data?.signInId ?? res?.signInId ?? '';
      setSignInId(sid);
      appendLog(`OTP sent → ${current.email}`);
      addToast?.('Check email for the 6-digit code', 'info');
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
      setErrorCopyCommand(err.hydraCopyCommand ?? '');
      addToast?.(err.message, 'error');
    }
    setBusy(false);
  }

  async function handleVerify() {
    if (!current || !signInId || otpCode.length !== 6) {
      setLocalError('Enter the 6-digit code from email.');
      setErrorCopyCommand('');
      return;
    }
    resetErrors();
    setBusy(true);
    try {
      await api.verifyOTP(current.id, signInId, otpCode);
      appendLog(`verified → ${current.email}`);
      addToast?.(`Session active: ${current.alias}`, 'success');
      setQueue((q) =>
        q.map((item, i) => (i === currentIdx ? { ...item, verified: true } : item)),
      );
      setOtpCode('');
      setSignInId('');
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
      setErrorCopyCommand(err.hydraCopyCommand ?? '');
      addToast?.(err.message, 'error');
    }
    setBusy(false);
  }

  async function handleProvision() {
    if (!current || !provisionEnabled) return;
    resetErrors();
    setBusy(true);
    try {
      await api.provisionManagementKey(current.id, keyName.trim() || 'hydra-bulk');
      appendLog(`provisioned key → ${current.email}`);
      addToast?.('Management key saved', 'success');
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
      setErrorCopyCommand(err.hydraCopyCommand ?? '');
      addToast?.(err.message, 'error');
    }
    setBusy(false);
  }

  function handleSkipAccount() {
    if (!current) return;
    appendLog(`skipped → ${current.email}`);
    setQueue((q) =>
      q.map((item, i) => (i === currentIdx ? { ...item, skipped: true } : item)),
    );
    setSignInId('');
    setOtpCode('');
    resetErrors();
    setCurrentIdx((i) => Math.min(i + 1, Math.max(queue.length - 1, 0)));
  }

  async function handleMergeExistingOtp() {
    resetErrors();
    setMergeBusy(true);
    try {
      const res = await api.getAccounts();
      const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      const candidates = list.filter(
        (a) =>
          a.email &&
          (a.authMethod === 'otp' || a.authMethod === 'email') &&
          accountNeedsSession(a.sessionStatus, { hasCredentials: a.hasCredentials }),
      );
      let mergedLen = 0;
      setQueue((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        const merged = [];
        for (const a of candidates) {
          if (ids.has(a.id)) continue;
          ids.add(a.id);
          merged.push({
            id: a.id,
            alias: a.alias,
            email: a.email,
            verified: false,
            skipped: false,
            fromExisting: true,
          });
        }
        mergedLen = merged.length;
        return merged.length ? [...prev, ...merged] : prev;
      });
      if (mergedLen) {
        appendLog(`queue +${mergedLen} existing OTP account(s) with no active session`);
        addToast?.(`Added ${mergedLen} existing account(s) to queue`, 'info');
      } else {
        addToast?.('No extra OTP rows need a session', 'info');
      }
    } catch (err) {
      setLocalError(api.formatApiErrorMessage(err));
      setErrorCopyCommand(err.hydraCopyCommand ?? '');
      addToast?.(err.message, 'error');
    }
    setMergeBusy(false);
  }

  function handleNext() {
    setSignInId('');
    setOtpCode('');
    resetErrors();
    setCurrentIdx((i) => Math.min(i + 1, Math.max(queue.length - 1, 0)));
  }

  function handlePrev() {
    setSignInId('');
    setOtpCode('');
    resetErrors();
    setCurrentIdx((i) => Math.max(i - 1, 0));
  }

  const total = queue.length;
  const position = total ? currentIdx + 1 : 0;
  const verifiedCount = queue.filter((q) => q.verified).length;
  const skippedCount = queue.filter((q) => q.skipped).length;
  const errorHint = clerkErrorHint(localError);

  return (
    <div className="page-container" style={{ maxWidth: 720 }}>
      <header className="page-header page-header--intro" style={{ marginBottom: 'var(--space-lg)' }}>
        <div>
          <h2 style={{ margin: 0 }}>Bulk OTP sign-in</h2>
          <p className="page-header__lede">
            Paste OpenRouter account emails. Hydra creates local OTP rows (no Clerk calls yet). Then work through each
            account: send code → enter 6 digits → verify → optionally provision a management key → next.
          </p>
          <p className="page-header__lede page-header__lede--note">
            Magic-link-only accounts: paste a{' '}
            <code className="form-input-mono" style={{ fontSize: '0.8em', padding: '1px 4px' }}>__session</code> cookie
            via Monitor → Bulk Import instead.
          </p>
        </div>
      </header>

      <section className="card" style={{ marginBottom: 'var(--space-md)' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>1. Emails</h2>
        <form onSubmit={handleCreateStubs}>
          <textarea
            data-testid="bulk-auth-email-input"
            className="form-input"
            rows={8}
            placeholder="one email per line (or comma-separated)"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            spellCheck={false}
            style={{ fontFamily: 'var(--font-mono)', minHeight: 140 }}
          />
          {localError && !queue.length && (
            <DevBackendHint message={localError} copyCommand={errorCopyCommand} />
          )}
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
            Already have OTP rows in the vault with no session? Append them to the queue without re-pasting emails.
          </p>
          <button
            type="button"
            data-testid="bulk-auth-merge-existing"
            className="btn btn-ghost"
            onClick={() => void handleMergeExistingOtp()}
            disabled={mergeBusy || creating}
          >
            {mergeBusy ? 'Loading…' : 'Add existing OTP accounts (no session)'}
          </button>
        </div>
      </section>

      {stubSummary && (
        <div
          data-testid="bulk-auth-stub-summary"
          className="info-banner"
          style={{
            marginBottom: 'var(--space-md)',
            background: 'rgba(0, 255, 136, 0.06)',
            border: '1px solid rgba(0, 255, 136, 0.25)',
            padding: '10px 14px',
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
          }}
        >
          <span style={{ fontWeight: 800, color: 'var(--status-success)', marginRight: 8 }}>[STUB RUN]</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            Created <strong>{stubSummary.created}</strong>
            {' · '}
            Duplicate email (skipped) <strong>{stubSummary.duplicateEmail}</strong>
            {' · '}
            Other errors <strong>{stubSummary.failed}</strong>
            {' · '}
            <span style={{ color: 'var(--text-tertiary)' }}>
              {stubSummary.inputLines} unique pasted / {stubSummary.resultRows} server results
            </span>
          </div>
        </div>
      )}

      {total > 0 && (
        <section className="card" style={{ marginBottom: 'var(--space-md)' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>2. Sequential auth</h2>
          <p data-testid="bulk-auth-progress" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 4 }}>
            Account {position} of {total}
            {current && (
              <>
                {' — '}
                <strong data-testid="bulk-auth-current-email">{current.email}</strong>
                <span style={{ color: 'var(--text-tertiary)' }}> ({current.alias})</span>
                {current.fromExisting ? (
                  <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>[existing row]</span>
                ) : null}
              </>
            )}
          </p>
          <p
            data-testid="bulk-auth-completion-progress"
            style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', marginBottom: 'var(--space-md)' }}
          >
            <strong>{verifiedCount}</strong> / {total} verified
            {skippedCount > 0 ? (
              <>
                {' · '}
                <strong>{skippedCount}</strong> skipped
              </>
            ) : null}
          </p>

          {current && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', margin: 0 }}>
                Sending a code updates the Clerk device cookie; Hydra keeps any existing stored dashboard session until verification succeeds.
              </p>
              {localError && (
                <div>
                  <DevBackendHint message={localError} copyCommand={errorCopyCommand} />
                  {errorHint && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 6 }}>{errorHint}</p>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  data-testid="bulk-auth-send-code"
                  className="btn btn-primary"
                  onClick={handleSendCode}
                  disabled={busy}
                >
                  Send email code
                </button>
                <button
                  type="button"
                  data-testid="bulk-auth-skip"
                  className="btn btn-ghost"
                  onClick={handleSkipAccount}
                  disabled={busy}
                >
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

              <button
                type="button"
                data-testid="bulk-auth-verify"
                className="btn btn-primary"
                onClick={handleVerify}
                disabled={busy || otpCode.length !== 6 || !signInId}
              >
                Verify code
              </button>
              {!signInId && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>Send the code first — then enter the digits from your inbox.</p>
              )}

              <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 'var(--space-sm)', fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    data-testid="bulk-auth-provision-enabled"
                    checked={provisionEnabled}
                    onChange={(e) => setProvisionEnabled(e.target.checked)}
                  />
                  Offer provision management key (after verify)
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
                    <button
                      type="button"
                      data-testid="bulk-auth-provision"
                      className="btn btn-ghost"
                      onClick={handleProvision}
                      disabled={busy}
                    >
                      Provision management key
                    </button>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-md)' }}>
                <button type="button" className="btn btn-ghost" onClick={handlePrev} disabled={busy || currentIdx === 0}>
                  ← Previous
                </button>
                <button type="button" data-testid="bulk-auth-next" className="btn btn-ghost" onClick={handleNext} disabled={busy || currentIdx >= total - 1}>
                  Next account →
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>Activity log</h2>
        <pre
          data-testid="bulk-auth-log"
          style={{
            margin: 0,
            maxHeight: 200,
            overflow: 'auto',
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {logLines.length ? logLines.join('\n') : 'No events yet.'}
        </pre>
      </section>
    </div>
  );
}
