
import { parseEmailEntries } from '../utils/auth';
import DevBackendHint from '../components/DevBackendHint';

export default function EmailLinkTab({
  pasteText,
  setPasteText,
  creating,
  rows,
  logLines,
  localError,
  errorCopyCommand,
  magicLinkCapability,
  onRefreshCapability,
  forceReplace,
  setForceReplace,
  onSend,
  onResend
}) {
  const handleCreate = (e) => {
    e.preventDefault();
    onSend(parseEmailEntries(pasteText));
  };
  const callbackUnavailable = magicLinkCapability?.available === false;
  const callbackChecking = magicLinkCapability?.status === 'checking' || magicLinkCapability?.status === 'refreshing';
  const callbackReady = magicLinkCapability?.available === true;
  const callbackText = callbackReady
    ? `Email Link callback ready: ${magicLinkCapability.callbackOrigin}${magicLinkCapability.callbackPath || '/api/auth/magic-callback'}`
    : magicLinkCapability?.message || 'Checking Email Link callback...';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <section className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>1. Paste emails</h2>
        <div
          data-testid="bulk-auth-email-link-capability"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            marginBottom: 'var(--space-sm)',
            padding: '10px 12px',
            borderRadius: 7,
            border: callbackReady ? '1px solid rgba(0, 255, 136, 0.28)' : '1px solid rgba(255, 189, 66, 0.32)',
            background: callbackReady ? 'rgba(0, 255, 136, 0.06)' : 'rgba(255, 189, 66, 0.08)',
            color: callbackReady ? 'var(--status-success)' : 'var(--text-secondary)',
            fontSize: '0.78rem',
            lineHeight: 1.4,
          }}
        >
          <span>{callbackText}</span>
          {onRefreshCapability && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onRefreshCapability()}
              disabled={callbackChecking}
              style={{ flexShrink: 0 }}
            >
              {callbackChecking ? 'Checking...' : 'Recheck'}
            </button>
          )}
        </div>
        <form onSubmit={handleCreate}>
          <textarea
            data-testid="bulk-auth-email-link-input"
            className="form-input"
            rows={6}
            placeholder="one email per line (or comma-separated)"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            spellCheck={false}
            style={{ fontFamily: 'var(--font-mono)', minHeight: 100 }}
          />
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 'var(--space-sm)',
              color: 'var(--text-secondary)',
              fontSize: '0.82rem',
            }}
          >
            <input
              type="checkbox"
              checked={forceReplace}
              onChange={(e) => setForceReplace(e.target.checked)}
            />
            Force replace matching saved emails
          </label>
          {localError && <DevBackendHint message={localError} copyCommand={errorCopyCommand} />}
          <button
            type="submit"
            data-testid="bulk-auth-send-links"
            className="btn btn-primary"
            style={{ marginTop: 'var(--space-sm)' }}
            disabled={creating || callbackUnavailable}
          >
            {creating ? 'Preparing queue...' : callbackUnavailable ? 'Use OTP instead' : 'Send Magic Links'}
          </button>
        </form>
      </section>

      {rows.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>2. Send status</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map((r) => (
              <div
                key={r.id}
                data-testid={`bulk-auth-row-${r.email}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  background: 'var(--bg-secondary)',
                  borderRadius: 6,
                  borderLeft: `3px solid ${
                    r.status === 'done' ? 'var(--status-success)' :
                    r.status === 'error' ? 'var(--status-error)' :
                    'var(--border-subtle)'
                  }`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: '0.85rem' }}>{r.email}</strong>
                    {r.status === 'sending' && <div className="spinner-sm" />}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 2 }}>{r.message}</div>
                </div>
                {r.status === 'error' && r.canRetry !== false && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onResend(r)}>
                    Retry
                  </button>
                )}
              </div>
            ))}
          </div>
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
