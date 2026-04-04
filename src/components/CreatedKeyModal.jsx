import { useState, useEffect } from 'react';
import { CopyIcon, EyeIcon, EyeOffIcon, KeyIcon, NetworkIcon } from './Icons';

/**
 * Modal displayed after creating a new API key.
 * Shows the key once (one-time reveal) and provides option to auto-add to pool.
 * @param {{ keyData: { hash: string, name: string, key: string }, onClose: () => void, onAddToPool?: () => Promise<void> }} props
 */
export default function CreatedKeyModal({ keyData, onClose, onAddToPool }) {
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [addingToPool, setAddingToPool] = useState(false);
  const [poolAdded, setPoolAdded] = useState(false);

  // Auto-copy to clipboard when modal opens
  useEffect(() => {
    if (keyData?.key) {
      navigator.clipboard.writeText(keyData.key).catch(() => {});
    }
  }, [keyData]);

  if (!keyData) return null;

  const { hash, name, key } = keyData;
  const displayKey = key || '';
  const maskedKey = displayKey.slice(0, 12) + '…' + displayKey.slice(-8);

  function handleCopy() {
    navigator.clipboard.writeText(displayKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleAddToPool() {
    if (!onAddToPool) return;
    setAddingToPool(true);
    try {
      await onAddToPool();
      setPoolAdded(true);
    } catch {
      // Error handled by parent
    } finally {
      setAddingToPool(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal animate-spring" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <KeyIcon size={20} style={{ color: 'var(--status-success)' }} />
            <h3>API Key Created</h3>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={{ padding: 'var(--space-md)' }}>
          {/* Success banner */}
          <div
            style={{
              padding: '12px 16px',
              background: 'rgba(0,255,102,0.08)',
              border: '1px solid var(--status-success)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-md)',
            }}
          >
            <div style={{ fontSize: '0.85rem', color: 'var(--status-success)', fontWeight: 600 }}>
              ✓ Key saved to vault automatically
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              The key is encrypted and stored locally. This is the only time the full key will be displayed.
            </div>
          </div>

          {/* Key name */}
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)', marginBottom: 6 }}>
              Key Name
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {name || 'Unnamed Key'}
            </div>
          </div>

          {/* Key ID (hash) */}
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)', marginBottom: 6 }}>
              Key ID
            </div>
            <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {hash}
            </code>
          </div>

          {/* API Key (the secret) */}
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)', marginBottom: 6 }}>
              API Key (Secret)
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <code
                style={{
                  flex: 1,
                  fontSize: '0.8rem',
                  fontFamily: 'var(--font-mono)',
                  color: showKey ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  wordBreak: 'break-all',
                }}
              >
                {showKey ? displayKey : maskedKey}
              </code>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? 'Hide key' : 'Show key'}
                style={{ padding: '4px 8px' }}
              >
                {showKey ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleCopy}
                style={{ gap: 6, minWidth: 90 }}
              >
                <CopyIcon size={14} />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.4 }}>
              The key has been copied to your clipboard. Store it securely — you won&apos;t see it again.
            </div>
          </div>

          {/* Pool actions */}
          {onAddToPool && !poolAdded && (
            <div
              style={{
                padding: '12px 16px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-md)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <NetworkIcon size={16} style={{ color: 'var(--accent-primary)' }} />
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Add to Pool Router?
                </div>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.4 }}>
                Adding this key to the pool will make it available for API calls through the Hydra proxy endpoint. The key will be used in rotation with other pooled keys.
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleAddToPool}
                disabled={addingToPool}
                style={{ width: '100%' }}
              >
                {addingToPool ? (
                  <>
                    <div className="spinner-sm" style={{ width: 12, height: 12 }} /> Adding to pool…
                  </>
                ) : (
                  <>
                    <NetworkIcon size={14} style={{ marginRight: 6 }} />
                    Add to Pool Router
                  </>
                )}
              </button>
            </div>
          )}

          {poolAdded && (
            <div
              style={{
                padding: '10px 14px',
                background: 'rgba(0,255,102,0.08)',
                border: '1px solid var(--status-success)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-md)',
              }}
            >
              <div style={{ fontSize: '0.8rem', color: 'var(--status-success)', fontWeight: 600 }}>
                ✓ Key added to Pool Router
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                The key is now active in the rotation pool and ready for API calls.
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="modal-footer" style={{ marginTop: 'var(--space-md)' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
