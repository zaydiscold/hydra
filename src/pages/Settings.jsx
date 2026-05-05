import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import { LockIcon, NetworkIcon, SettingsIcon, InfoIcon, RefreshIcon, CopyIcon } from '../components/Icons';

export default function Settings({ addToast }) {
  const navigate = useNavigate();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [lanUrls, setLanUrls] = useState([]);
  const [copied, setCopied] = useState(false);

  // Electron native info
  const [nativeInfo, setNativeInfo] = useState(null);
  const [nativeLoading, setNativeLoading] = useState(true);
  const isElectron = typeof window !== 'undefined' && window.hydraNative;

  const fallbackUrl = useMemo(
    () => `http://${window.location.hostname || 'localhost'}:3001/v1`,
    []
  );
  const primaryUrl = lanUrls[0] || fallbackUrl;

  useEffect(() => {
    let mounted = true;
    api.getNetworkInfo()
      .then(res => { if (mounted) setLanUrls(Array.isArray(res?.data?.lanUrls) ? res.data.lanUrls : []); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!isElectron) {
      setNativeLoading(false);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const [versionRes, platformRes, pathsRes] = await Promise.allSettled([
          window.hydraNative.appVersion(),
          window.hydraNative.platform(),
          window.hydraNative.appPaths(),
        ]);
        if (mounted) {
          setNativeInfo({
            version: versionRes.status === 'fulfilled' ? versionRes.value?.data : null,
            platform: platformRes.status === 'fulfilled' ? platformRes.value?.data : null,
            paths: pathsRes.status === 'fulfilled' ? pathsRes.value?.data : null,
          });
        }
      } catch { /* fine */ }
      if (mounted) setNativeLoading(false);
    })();
    return () => { mounted = false; };
  }, [isElectron]);

  async function handleChangePassword(e) {
    e.preventDefault();
    const newErrors = {};
    if (!oldPassword) newErrors.oldPassword = 'Current password is required';
    if (!newPassword) {
      newErrors.newPassword = 'New password is required';
    } else if (newPassword.length < 4) {
      newErrors.newPassword = 'Minimum 4 characters';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setLoading(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      addToast('Password updated', 'success');
      setOldPassword('');
      setNewPassword('');
    } catch (err) {
      addToast(err.message, 'error');
      setErrors({ submit: err.message });
    }
    setLoading(false);
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(primaryUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast('Failed to copy to clipboard', 'error');
    }
  }

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SettingsIcon size={28} style={{ color: 'var(--accent-primary)' }} />
          <div>
            <h2 style={{ margin: 0 }}>Settings</h2>
          </div>
        </div>
        {/* Inline status strip */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
          <span>v{import.meta.env.VITE_APP_VERSION ?? 'dev'}</span>
          <span>AES-256-GCM</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--status-success)' }}>
            <span className="status-dot success" style={{ width: 6, height: 6 }} />
            ACTIVE
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-md)', alignItems: 'start' }}>

        {/* Endpoint */}
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <NetworkIcon size={15} style={{ color: 'var(--status-success)' }} />
            <span style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Endpoint</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--status-success)', fontFamily: 'var(--font-mono)' }}>LAN ACTIVE</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ flex: 1, fontSize: '0.8rem', color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all', background: 'var(--bg-secondary)', padding: '6px 10px', borderRadius: 4 }}>
              {primaryUrl}
            </code>
            <button className="btn btn-secondary btn-sm" onClick={copyUrl} style={{ flexShrink: 0 }}>
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
          {lanUrls.length > 1 && (
            <div style={{ marginTop: 8, fontSize: '0.7rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {lanUrls.slice(1).map(u => <div key={u}>{u}</div>)}
            </div>
          )}
        </div>

        {/* Password */}
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <LockIcon size={15} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Password</span>
          </div>
          <form onSubmit={handleChangePassword} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="form-group-compact">
              <input
                type="password"
                className={`form-input ${errors.oldPassword ? 'error' : ''}`}
                placeholder="Current password"
                value={oldPassword}
                onChange={e => {
                  setOldPassword(e.target.value);
                  if (errors.oldPassword) setErrors(prev => ({ ...prev, oldPassword: null }));
                }}
                style={{ fontSize: '0.85rem', padding: '6px 10px' }}
              />
              {errors.oldPassword && <p className="field-error">{errors.oldPassword}</p>}
            </div>
            <div className="form-group-compact">
              <input
                type="password"
                className={`form-input ${errors.newPassword ? 'error' : ''}`}
                placeholder="New password"
                value={newPassword}
                onChange={e => {
                  setNewPassword(e.target.value);
                  if (errors.newPassword) setErrors(prev => ({ ...prev, newPassword: null }));
                }}
                style={{ fontSize: '0.85rem', padding: '6px 10px' }}
              />
              {errors.newPassword && <p className="field-error">{errors.newPassword}</p>}
            </div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={loading} style={{ alignSelf: 'flex-start', marginTop: 2 }}>
              {loading ? <><div className="spinner-sm" /> Updating…</> : 'Update Password'}
            </button>
            <p style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
              Changing password signs out your current session.
            </p>
          </form>
        </div>

      </div>

      {/* Electron Native Info */}
      {isElectron && !nativeLoading && nativeInfo && (
        <div className="card" style={{ padding: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <NetworkIcon size={15} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>System Info</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {nativeInfo.version && (
              <div><span style={{ color: 'var(--text-tertiary)' }}>Version: </span>{nativeInfo.version}</div>
            )}
            {nativeInfo.platform && (
              <div><span style={{ color: 'var(--text-tertiary)' }}>Platform: </span>{nativeInfo.platform}</div>
            )}
            {nativeInfo.paths?.userData && (
              <div><span style={{ color: 'var(--text-tertiary)' }}>Data Dir: </span><code style={{ fontSize: '0.75rem', color: 'var(--accent-primary)' }}>{nativeInfo.paths.userData}</code></div>
            )}
            {nativeInfo.paths?.logs && (
              <div><span style={{ color: 'var(--text-tertiary)' }}>Logs Dir: </span><code style={{ fontSize: '0.75rem', color: 'var(--accent-primary)' }}>{nativeInfo.paths.logs}</code></div>
            )}
          </div>
        </div>
      )}

      {/* Diagnostics link */}
      <div style={{ marginTop: 'var(--space-lg)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--border-subtle)' }}>
        <button
          className="btn btn-ghost"
          onClick={() => navigate('/diagnostics')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-secondary)' }}
        >
          <InfoIcon size={14} />
          View Diagnostics &amp; Support Bundle
        </button>
      </div>
    </>
  );
}
