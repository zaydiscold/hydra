import { useEffect, useMemo, useState, useCallback } from 'react';
import * as api from '../api';
import { LockIcon, NetworkIcon, SettingsIcon, CopyIcon, InfoIcon, PowerIcon } from '../components/Icons';

export default function Settings({ addToast, onLogout }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [lanUrls, setLanUrls] = useState([]);
  const [copied, setCopied] = useState(false);
  const [nativeInfo, setNativeInfo] = useState(null);
  const [proxyEnabled, setProxyEnabled] = useState(null);
  const [healthData, setHealthData] = useState(null);
  const [supportBundleCopied, setSupportBundleCopied] = useState(false);

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
    // Load native info if running under Electron
    if (window.hydraNative?.appVersion) {
      Promise.all([
        window.hydraNative.appVersion(),
        window.hydraNative.appPaths(),
        window.hydraNative.platform(),
      ])
        .then(([verRes, pathsRes, platRes]) => {
          if (!mounted) return;
          setNativeInfo({
            version: verRes?.ok ? verRes.data : null,
            paths: pathsRes?.ok ? pathsRes.data : null,
            platform: platRes?.ok ? platRes.data : null,
          });
        })
        .catch(() => {});
    }
    // Load proxy status
    api.getProxyStatus()
      .then(res => { if (mounted) setProxyEnabled(res?.data?.enabled ?? res?.enabled ?? null); })
      .catch(() => {});
    // Load system health for db/log paths
    api.getSystemHealth()
      .then(res => { if (mounted) setHealthData(res?.data ?? res ?? null); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

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
    } catch { /* noop */ }
  }

  async function handleCopySupportBundle() {
    try {
      const lines = [];
      lines.push('=== Hydra Support Bundle ===');
      lines.push(`Version: ${nativeInfo?.version || import.meta.env.VITE_APP_VERSION || 'dev'}`);
      lines.push(`Platform: ${nativeInfo?.platform || navigator.platform}`);
      lines.push(`Mode: ${import.meta.env.PROD ? 'Packaged' : 'Dev'}`);
      if (nativeInfo?.paths) {
        const p = nativeInfo.paths;
        lines.push(`User Data: ${p.userData || '—'}`);
        lines.push(`Log Path: ${p.logs || '—'}`);
        lines.push(`DB Path: ${healthData?.dbPath || '—'}`);
      } else {
        lines.push(`DB Path: ${healthData?.dbPath || '—'}`);
        lines.push(`Log Path: ${healthData?.logPath || '—'}`);
      }
      lines.push(`Proxy: ${proxyEnabled === true ? 'Enabled' : proxyEnabled === false ? 'Disabled' : 'Unknown'}`);
      lines.push(`User-Agent: ${navigator.userAgent}`);
      lines.push(`URL: ${window.location.href}`);
      const text = lines.join('\n');
      await navigator.clipboard.writeText(text);
      setSupportBundleCopied(true);
      setTimeout(() => setSupportBundleCopied(false), 2500);
      addToast('Support bundle copied', 'success');
    } catch {
      addToast('Failed to copy support bundle', 'error');
    }
  }

  const handleLockVault = useCallback(() => {
    if (onLogout) onLogout();
  }, [onLogout]);

  const handleQuitApp = useCallback(async () => {
    if (window.hydraNative?.quitApp) {
      try { await window.hydraNative.quitApp(); } catch { /* fall through */ }
    }
  }, []);

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
          <span>v{nativeInfo?.version || (import.meta.env.VITE_APP_VERSION ?? 'dev')}</span>
          {nativeInfo?.platform && <span>{nativeInfo.platform}</span>}
          {window.hydraNative && <span style={{ color: 'var(--accent-primary)' }}>Electron</span>}
          {import.meta.env.PROD && <span>PACKAGED</span>}
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

        {/* Diagnostics */}
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <InfoIcon size={15} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Diagnostics</span>
          </div>
          <div style={{ fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-mono)' }}>
            {healthData?.dbPath && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>DB Path</span>
                <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all', textAlign: 'right', maxWidth: '60%' }}>{healthData.dbPath}</span>
              </div>
            )}
            {nativeInfo?.paths?.logs && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Log Path</span>
                <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all', textAlign: 'right', maxWidth: '60%' }}>{nativeInfo.paths.logs}</span>
              </div>
            )}
            {!nativeInfo?.paths?.logs && healthData?.logPath && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Log Path</span>
                <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all', textAlign: 'right', maxWidth: '60%' }}>{healthData.logPath}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Proxy</span>
              <span style={{
                color: proxyEnabled === true ? 'var(--status-success)' : proxyEnabled === false ? 'var(--status-error)' : 'var(--text-tertiary)',
              }}>
                {proxyEnabled === true ? 'ENABLED' : proxyEnabled === false ? 'DISABLED' : 'Unknown'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: 'var(--text-tertiary)' }}>Mode</span>
              <span style={{ color: 'var(--text-secondary)' }}>
                {import.meta.env.PROD ? 'Packaged' : 'Dev'}
              </span>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={handleCopySupportBundle} style={{ flex: 1 }}>
              <CopyIcon size={12} style={{ marginRight: 4 }} />
              {supportBundleCopied ? 'Copied!' : 'Copy Support Bundle'}
            </button>
          </div>
        </div>

        {/* Electron Actions — only shown when running under Electron */}
        {window.hydraNative && (
          <div className="card" style={{ padding: 'var(--space-md)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <PowerIcon size={15} style={{ color: 'var(--accent-primary)' }} />
              <span style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Application</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={handleLockVault} style={{ justifyContent: 'center' }}>
                <LockIcon size={14} style={{ marginRight: 6 }} />
                Lock Vault
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleQuitApp} style={{ justifyContent: 'center' }}>
                <PowerIcon size={14} style={{ marginRight: 6 }} />
                Quit App
              </button>
            </div>
            {nativeInfo?.paths?.userData && (
              <p style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: 10, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                {nativeInfo.paths.userData}
              </p>
            )}
          </div>
        )}

      </div>
    </>
  );
}
