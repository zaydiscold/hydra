import { useState } from 'react';
import * as api from '../api';

/**
 * Paste an OpenRouter key (`sk-or-mgmt-…`, `sk-or-v1-…`, or other `sk-or-…` prefixes) into the vault for an existing account.
 * Server validates non-empty only; OpenRouter is authoritative if the key is wrong for management API calls.
 * @param {{ account: { id: string; alias: string }; onClose: () => void; onDone: (message: string) => void }} props
 */
export default function PasteManagementKeyModal({ account, onClose, onDone }) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Paste your OpenRouter key');
      return;
    }
    if (!trimmed.startsWith('sk-or-')) {
      setError('OpenRouter keys start with sk-or-');
      return;
    }
    setLoading(true);
    try {
      await api.updateAccount(account.id, { managementKey: trimmed });
      onDone('OpenRouter key saved');
      onClose();
    } catch (err) {
      setError(api.formatApiErrorMessage(err));
    }
    setLoading(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal animate-spring" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Paste OpenRouter key</h3>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-md)' }}>
            For <strong>{account.alias}</strong>. Copy a management key from{' '}
            <a href="https://openrouter.ai/settings/management-keys" target="_blank" rel="noreferrer">
              OpenRouter → Management keys
            </a>
            . Use a management key for account control. Normal model API keys are for AI requests only and may not allow Hydra to create, disable, or delete other keys. Stored encrypted in Hydra.
          </p>
          <div className="form-group">
            <label style={{ color: error ? 'var(--status-error)' : 'inherit' }}>
              OpenRouter key
            </label>
            <textarea
              className={`form-input ${error ? 'error' : ''}`}
              style={{ minHeight: 88, fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}
              placeholder="sk-or-mgmt-… or sk-or-v1-…"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError('');
              }}
              spellCheck={false}
              autoComplete="off"
              autoFocus
            />
            {error && <p className="field-error">{error}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? (
                <>
                  <div className="spinner-sm" /> Saving…
                </>
              ) : (
                'Save key'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
