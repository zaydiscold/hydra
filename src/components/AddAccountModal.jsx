import { useState, useCallback, memo } from 'react';
import * as api from '../api';
import { LockIcon, DatabaseIcon, KeyIcon } from './Icons';

const AddAccountModal = memo(function AddAccountModal({ onClose, onAdded }) {
  const [addMethod, setAddMethod] = useState('credentials');
  const [alias, setAlias] = useState('');
  const [managementKey, setManagementKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({}); // Field-specific errors

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    const newErrors = {};

    // Custom validation
    if (addMethod === 'key') {
      if (!alias.trim()) newErrors.alias = 'Alias is required';
      if (!managementKey.trim()) newErrors.managementKey = 'Management key is required';
    } else if (addMethod === 'credentials') {
      if (!alias.trim()) newErrors.alias = 'Alias is required';
      if (!email.trim()) newErrors.email = 'Email is required';
      // password optional for OTP
    } else if (addMethod === 'bulk') {
      if (!bulkText.trim()) newErrors.bulkText = 'Account list is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    setErrors({});
    try {
      if (addMethod === 'key') {
        await api.addAccount(alias.trim(), managementKey.trim());
        onAdded('Account added successfully');
      } else if (addMethod === 'credentials') {
        const useEmail = email.trim();
        const useAlias = alias.trim();
        const useAuthMethod = password ? 'password' : 'otp';
        await api.addAccountWithCredentials(useAlias, useEmail, password, useAuthMethod);
        onAdded(
          useAuthMethod === 'password'
            ? 'Account added — session can auto-refresh when needed'
            : 'Account added — click [UNLOCK] Authenticate, then [AUTO] Provision Key'
        );
      } else if (addMethod === 'bulk') {
        const lines = bulkText.trim().split('\n')
          .map(l => l.trim())
          .filter(Boolean);

        if (lines.length === 0) { 
          setError('No valid lines entered. Try alias:email:pass or raw session cookies.'); 
          setLoading(false); 
          return; 
        }
        const res = await api.bulkAddAccounts(lines);
        const created = res.data?.created ?? 0;
        const skipped = res.data?.skipped ?? 0;
        const failed  = res.data?.failed  ?? 0;
        const parts = [`${created} added`];
        if (skipped > 0) parts.push(`${skipped} already existed (skipped)`);
        if (failed  > 0) parts.push(`${failed} failed`);
        onAdded(`Bulk import: ${parts.join(', ')}`);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [addMethod, alias, managementKey, email, password, bulkText, onAdded, onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg animate-spring" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Add OpenRouter Account</h3>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem', marginTop: 2 }}>
              Connect accounts to start managing them
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>

        <div className="method-tabs" style={{ marginBottom: 'var(--space-lg)' }}>
          {[
            { id: 'credentials', icon: <LockIcon size={24} />, title: 'Email + Pass', sub: 'Sign in, then provision control' },
            { id: 'bulk',        icon: <DatabaseIcon size={24} />, title: 'Bulk Import', sub: 'Batch paste' },
            { id: 'key',         icon: <KeyIcon size={24} />, title: 'Control Key',   sub: 'Existing management key' },
          ].map(m => (
            <button
              key={m.id}
              className={`method-tab ${addMethod === m.id ? 'active' : ''}`}
              onClick={() => setAddMethod(m.id)}
              type="button"
            >
              <span style={{ marginBottom: 4, display: 'block' }}>{m.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '0.85rem', textTransform: 'uppercase' }}>{m.title}</div>
                <div style={{ fontSize: '0.7rem', opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.sub}</div>
              </div>
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {addMethod === 'key' && (
            <>
              <div className="form-group">
                <label style={{ color: errors.alias ? 'var(--status-error)' : 'inherit' }}>
                  Account Alias
                </label>
                <input 
                  type="text" 
                  className={`form-input ${errors.alias ? 'error' : ''}`} 
                  placeholder="e.g., Personal, Burner-1..."
                  value={alias} 
                  onChange={(e) => {
                    setAlias(e.target.value);
                    if (errors.alias) setErrors(prev => ({ ...prev, alias: null }));
                  }} 
                  autoFocus 
                  spellCheck={false} 
                />
                {errors.alias && <p className="field-error">{errors.alias}</p>}
              </div>
              <div className="form-group">
                <label style={{ color: errors.managementKey ? 'var(--status-error)' : 'inherit' }}>
                  Management Key
                </label>
                <input 
                  type="password" 
                  className={`form-input form-input-mono ${errors.managementKey ? 'error' : ''}`} 
                  placeholder="sk-or-mgmt-..."
                  value={managementKey} 
                  onChange={(e) => {
                    setManagementKey(e.target.value);
                    if (errors.managementKey) setErrors(prev => ({ ...prev, managementKey: null }));
                  }} 
                  spellCheck={false} 
                />
                {errors.managementKey && <p className="field-error">{errors.managementKey}</p>}
                <p className="form-hint">Use a management key for full account control: balances plus creating, disabling, and deleting model API keys. A normal model API key only grants AI request access and cannot manage the account.</p>
              </div>
            </>
          )}

          {addMethod === 'credentials' && (
            <>
              <div className="form-group">
                <label style={{ color: errors.alias ? 'var(--status-error)' : 'inherit' }}>
                  Account Alias
                </label>
                <input 
                  type="text" 
                  className={`form-input ${errors.alias ? 'error' : ''}`} 
                  placeholder="e.g., Account-1, Main..."
                  value={alias} 
                  onChange={(e) => {
                    setAlias(e.target.value);
                    if (errors.alias) setErrors(prev => ({ ...prev, alias: null }));
                  }} 
                  autoFocus 
                  spellCheck={false} 
                />
                {errors.alias && <p className="field-error">{errors.alias}</p>}
              </div>
              <div className="form-group">
                <label style={{ color: errors.email ? 'var(--status-error)' : 'inherit' }}>
                  Email
                </label>
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
                />
                {errors.email && <p className="field-error">{errors.email}</p>}
              </div>
              <div className="form-group">
                <label>Password</label>
                <input type="password" className="form-input" placeholder="Account password"
                  value={password} onChange={(e) => setPassword(e.target.value)} spellCheck={false} autoComplete="new-password" />
                <p className="form-hint">Leave blank to use email OTP authentication (you'll authenticate in-dashboard)</p>
              </div>

              <div className="info-banner" style={{ background: 'rgba(0, 255, 136, 0.05)', border: '1px solid rgba(0, 255, 136, 0.2)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 800, color: 'var(--status-success)', fontSize: '0.75rem', letterSpacing: '0.05em' }}>[VAULT SECURE]</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>AES-256-GCM encrypted locally</span>
              </div>
            </>
          )}

          {addMethod === 'bulk' && (
            <div className="form-group">
              <label style={{ color: errors.bulkText ? 'var(--status-error)' : 'inherit' }}>
                Account List
              </label>
              <textarea
                className={`form-input form-input-mono ${errors.bulkText ? 'error' : ''}`}
                style={{ height: 200, resize: 'vertical' }}
                placeholder={"alias:email@example.com:password\nalias2:email2@example.com:password2\n\nOr just email:pass (alias = email)"}
                value={bulkText}
                onChange={(e) => {
                  setBulkText(e.target.value);
                  if (errors.bulkText) setErrors(prev => ({ ...prev, bulkText: null }));
                }}
                spellCheck={false}
                autoFocus
              />
              {errors.bulkText && <p className="field-error">{errors.bulkText}</p>}
              <p className="form-hint">Format: alias:email:pass or email:pass (one per line). Session cookies also accepted.</p>
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><div className="spinner" /> Processing...</> : 'Add Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

export default AddAccountModal;
