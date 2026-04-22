import React from 'react';

export default function DeleteKeyModal({ hash, onClose, onConfirm }) {
  if (!hash) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Delete key?</div>
        <p className="modal-body" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
          {hash.slice(0, 20)}…
        </p>
        <p className="modal-body">This removes the key from OpenRouter and the local vault. This cannot be undone.</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm}>Delete key</button>
        </div>
      </div>
    </div>
  );
}
