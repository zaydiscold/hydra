import React from 'react';
import { parseEmails } from '../utils/auth';
import DevBackendHint from '../components/DevBackendHint';

export default function EmailLinkTab({
  pasteText,
  setPasteText,
  creating,
  rows,
  logLines,
  localError,
  errorCopyCommand,
  onSend,
  onResend
}) {
  const handleCreate = (e) => {
    e.preventDefault();
    const emails = parseEmails(pasteText);
    onSend(emails);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <section className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>1. Paste emails</h2>
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
          {localError && <DevBackendHint message={localError} copyCommand={errorCopyCommand} />}
          <button
            type="submit"
            data-testid="bulk-auth-send-links"
            className="btn btn-primary"
            style={{ marginTop: 'var(--space-sm)' }}
            disabled={creating}
          >
            {creating ? 'Creating stubs & sending…' : 'Send all Magic Links'}
          </button>
        </form>
      </section>

      {rows.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>2. Parallel status</h2>
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
                {r.status === 'error' && (
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
