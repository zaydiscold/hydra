/**
 * When API fetch fails in dev, show copyable npm command (browser cannot start Node).
 */
export default function DevBackendHint({ message, copyCommand }) {
  if (!message && !copyCommand) return null;

  async function copy() {
    if (!copyCommand) return;
    try {
      await navigator.clipboard.writeText(copyCommand);
    } catch {
      /* ignore */
    }
  }

  return (
    <div style={{ marginTop: message ? 8 : 0 }}>
      {message ? <p className="form-error" style={{ margin: 0 }}>{message}</p> : null}
      {copyCommand ? (
        <div
          style={{
            marginTop: message ? 10 : 0,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <code
            className="form-input-mono"
            style={{
              fontSize: '0.85rem',
              padding: '6px 10px',
              background: 'var(--surface-raised)',
              borderRadius: 4,
            }}
          >
            {copyCommand}
          </code>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem' }}
            onClick={() => void copy()}
            data-testid="copy-dev-command"
          >
            Copy command
          </button>
        </div>
      ) : null}
    </div>
  );
}
