import React, { useState, useRef, useEffect } from 'react';

export default function RegisterKeyModal({ hash, name, onClose, onConfirm }) {
  const [pasteVal, setPasteVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pasteHint, setPasteHint] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!hash) return;

    async function tryPaste() {
        try {
            const text = await navigator.clipboard.readText();
            if (text.trim()) setPasteVal(text.trim());
        } catch (err) {
            console.warn('[REGISTER-KEY] Clipboard read failed:', err.message);
            setPasteHint('Clipboard unavailable; paste the key manually.');
        }
    }

    tryPaste();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [hash]);

  async function handleSave() {
    setError('');
    const trimmed = pasteVal.trim();
    if (!trimmed) {
      setError('Key string is required');
      return;
    }
    if (!trimmed.startsWith('sk-or-')) {
      setError('Key must start with sk-or-');
      return;
    }

    setSaving(true);
    try {
      await onConfirm(hash, trimmed);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save key');
    } finally {
      setSaving(false);
    }
  }

  if (!hash) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Register Key String</div>
        <p className="modal-body" style={{ marginBottom: 'var(--space-md)' }}>
          Paste the <code>sk-or-v1-...</code> key string for <strong>{name || 'Unnamed Key'}</strong>.
        </p>
        <div className="form-group">
          <label style={{ color: error ? 'var(--status-error)' : 'inherit' }}>
            Key String
          </label>
          <input
            ref={inputRef}
            type="password"
            className={`form-input ${error ? 'error' : ''}`}
            placeholder="sk-or-v1-..."
            value={pasteVal}
            onChange={(e) => {
              setPasteVal(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') onClose();
            }}
          />
          {error && <p className="field-error">{error}</p>}
          {pasteHint && !error && <p className="field-hint">{pasteHint}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Key'}
          </button>
        </div>
      </div>
    </div>
  );
}
