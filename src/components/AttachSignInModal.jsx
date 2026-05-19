import { useState } from 'react';
import * as api from '../api';

/**
 * Attach email + password or OTP path to a key-import account so LoginAccountModal can run.
 */
export default function AttachSignInModal({ account, onClose, onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  async function handleSubmit(e) {
    e.preventDefault();
    const newErrors = {};
    if (!email.trim()) newErrors.email = 'Email is required';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setLoading(true);
    try {
      const useEmail = email.trim();
      const useAuthMethod = password ? 'password' : 'otp';
      await api.updateAccount(account.id, {
        email: useEmail,
        password: password || undefined,
        authMethod: useAuthMethod,
      });
      onDone(
        useAuthMethod === 'password'
          ? 'Sign-in saved — use Authenticate when you need a session'
          : 'Email saved — use Authenticate (OTP) when you need a session',
      );
      onClose();
    } catch (err) {
      setErrors({ submit: err.message });
    }
    setLoading(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal animate-spring" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Attach email sign-in</h3>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-md)' }}>
          Link an OpenRouter email to <strong>{account.alias}</strong> so Hydra can open the same login flow as credential accounts.
        </p>
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              className={`form-input ${errors.email ? 'error' : ''}`}
              placeholder="account@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors(prev => ({ ...prev, email: null }));
              }}
              spellCheck={false}
              autoComplete="email"
              autoFocus
            />
            {errors.email && <p className="field-error">{errors.email}</p>}
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="Account password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              spellCheck={false}
              autoComplete="new-password"
            />
            <p className="form-hint">Leave blank to use email OTP when you click Authenticate.</p>
          </div>
          <div
            className="info-banner"
            style={{
              background: 'rgba(0, 255, 136, 0.05)',
              border: '1px solid rgba(0, 255, 136, 0.2)',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span
              style={{
                fontWeight: 800,
                color: 'var(--status-success)',
                fontSize: '0.75rem',
                letterSpacing: '0.05em',
              }}
            >
              [VAULT SECURE]
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>AES-256-GCM encrypted locally</span>
          </div>
          {errors.submit && <p className="form-error">{errors.submit}</p>}
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
                'Save'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
