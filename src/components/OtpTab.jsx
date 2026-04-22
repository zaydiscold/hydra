import React from 'react';
import { parseEmails, clerkErrorHint } from '../utils/auth';
import DevBackendHint from '../components/DevBackendHint';

export default function OtpTab({
  pasteText,
  setPasteText,
  creating,
  stubSummary,
  queue,
  currentIdx,
  logLines,
  signInId,
  otpCode,
  setOtpCode,
  keyName,
  setKeyName,
  provisionEnabled,
  setProvisionEnabled,
  busy,
  mergeBusy,
  fetchingKeys,
  localError,
  errorCopyCommand,
  setCurrentIdx,
  onCreateStubs,
  onSendCode,
  onVerify,
  onProvision,
  onFetchKeys,
  onMergeExisting,
  onSkip,
  resetErrors
}) {
  const current = queue[currentIdx] ?? null;
  const total = queue.length;
  const position = total ? currentIdx + 1 : 0;
  const verifiedCount = queue.filter((q) => q.verified).length;
  const skippedCount = queue.filter((q) => q.skipped).length;
  const errorHint = clerkErrorHint(localError);

  const handleCreateStubs = (e) => {
    e.preventDefault();
    const emails = parseEmails(pasteText);
    onCreateStubs(emails);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <section className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>1. Paste account emails</h2>
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
            {creating ? 'Building queue…' : 'Create queue from pasted emails'}
          </button>
        </form>

        <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--border-subtle)' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
            Already imported accounts that need to be signed in again?
          </p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>
            This pulls saved OTP or email accounts from your vault that do not currently have a live dashboard session, and appends them to this queue for re-authentication.
          </p>
          <button
            type="button"
            data-testid="bulk-auth-merge-existing"
            className="btn btn-ghost"
            onClick={onMergeExisting}
            disabled={mergeBusy || creating}
          >
            {mergeBusy ? 'Finding saved accounts…' : 'Add saved accounts that need re-authentication'}
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
          New <strong>{stubSummary.created}</strong>
          {stubSummary.reused > 0 && <> · Re-auth <strong>{stubSummary.reused}</strong></>}
          {stubSummary.duplicateEmail > 0 && <> · Dup skip <strong>{stubSummary.duplicateEmail}</strong></>}
          {stubSummary.failed > 0 && <> · Errors <strong>{stubSummary.failed}</strong></>}
          <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>({stubSummary.inputLines} unique emails parsed; queue keeps pasted order after dedup)</span>
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
            {queue.some(q => q.provisioning) && (
              <span style={{ color: 'var(--status-warning)', marginLeft: 8, fontSize: '0.75rem', fontWeight: 600 }}>
                [{(queue.filter(q => q.provisioning).length)} provisioning in bg…]
              </span>
            )}
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
                <button type="button" data-testid="bulk-auth-send-code" className="btn btn-primary" onClick={() => onSendCode(current)} disabled={busy}>
                  Send email code
                </button>
                <button type="button" data-testid="bulk-auth-skip" className="btn btn-ghost" onClick={() => onSkip(current)} disabled={busy}>
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

              <button type="button" data-testid="bulk-auth-verify" className="btn btn-primary" onClick={() => onVerify(current, otpCode)} disabled={busy || otpCode.length !== 6 || !signInId}>
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
                    <button type="button" data-testid="bulk-auth-provision" className="btn btn-ghost" onClick={() => onProvision(current)} disabled={busy}>
                      Provision management key
                    </button>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-md)' }}>
                <button type="button" className="btn btn-ghost" onClick={() => { resetErrors(); setCurrentIdx((i) => Math.max(i - 1, 0)); }} disabled={busy || currentIdx === 0}>← Previous</button>
                <button type="button" data-testid="bulk-auth-next" className="btn btn-ghost" onClick={() => { resetErrors(); setCurrentIdx((i) => Math.min(i + 1, total - 1)); }} disabled={busy || currentIdx >= total - 1}>Next account →</button>
              </div>
            </div>
          )}
        </section>
      )}

      {verifiedCount > 0 && (
        <section className="card">
          <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-xs, 4px)' }}>3. Export credentials</h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-sm)' }}>
            After each verification, Hydra attempts to provision a management key. Use <strong>Fetch provisioned keys</strong> to pull keys that completed.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
            <button type="button" data-testid="bulk-auth-fetch-keys" className="btn btn-ghost" onClick={onFetchKeys} disabled={fetchingKeys || busy}>
              {fetchingKeys ? 'Fetching…' : 'Fetch provisioned keys'}
            </button>
            <button
              type="button"
              data-testid="bulk-auth-copy-export"
              className="btn btn-ghost"
              onClick={() => {
                const lines = queue.filter((item) => item.verified && item.managementKey).map((item) => `${item.email}:${item.managementKey}`).join('\n');
                if (!lines) return;
                navigator.clipboard?.writeText(lines);
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
