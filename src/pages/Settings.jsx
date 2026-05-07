import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import { LockIcon, NetworkIcon, SettingsIcon, InfoIcon, RefreshIcon, CopyIcon } from '../components/Icons';
import { isElectron, native, tryNative, useNativeInfo } from '../lib/native';

export default function Settings({ addToast }) {
  const navigate = useNavigate();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [lanUrls, setLanUrls] = useState([]);
  const [copied, setCopied] = useState(false);

  // Electron native info — single hook handles in-Electron check + load
  const inElectron = isElectron();
  const { data: nativeInfo, loading: nativeLoading } = useNativeInfo();

  // Privacy + biometric prefs (Electron-only). The Result-type wrapper
  // already hides the "not in Electron" path via tryNative — we just
  // render fallback messages when the descriptors aren't loaded.
  const [prefs, setPrefs] = useState(null);
  const [biometricInfo, setBiometricInfo] = useState(null);
  const [authTokenStatus, setAuthTokenStatus] = useState(null);
  useEffect(() => {
    if (!inElectron) return;
    let mounted = true;
    (async () => {
      const [p, b, tokenStatus] = await Promise.all([
        tryNative(native.prefsGetAll),
        tryNative(native.biometricDescribe),
        tryNative(native.authTokenStatus),
      ]);
      if (!mounted) return;
      setPrefs(p);
      setBiometricInfo(b);
      setAuthTokenStatus(tokenStatus);
    })();
    return () => { mounted = false; };
  }, [inElectron]);

  async function togglePref(key, value) {
    try {
      await native.prefsSet(key, value);
      setPrefs((p) => ({ ...(p || {}), [key]: value }));
      addToast?.(value ? `${key} enabled` : `${key} disabled`, 'success');
    } catch (e) {
      addToast?.(e?.message || 'Failed to update preference', 'error');
    }
  }

  async function tryBiometricPrompt() {
    try {
      await native.biometricPrompt('Test biometric unlock');
      addToast?.('Biometric prompt succeeded', 'success');
    } catch (e) {
      addToast?.(e?.message || 'Biometric prompt failed', 'error');
    }
  }

  // Bug fix: in packaged Electron the server picks a random port at boot,
  // so a hardcoded :3001 fallback would show the user the WRONG URL and
  // any tool they configured against it would fail. Read the live port
  // from the bridge first; only fall back to :3001 in browser-mode dev.
  const [nativeStatus, setNativeStatus] = useState(null);
  useEffect(() => {
    if (!inElectron) return;
    let mounted = true;
    tryNative(native.status).then((s) => { if (mounted) setNativeStatus(s); });
    return () => { mounted = false; };
  }, [inElectron]);
  const fallbackUrl = useMemo(() => {
    if (nativeStatus?.serverUrl) return `${nativeStatus.serverUrl}/v1`;
    if (nativeStatus?.expressPort) return `http://127.0.0.1:${nativeStatus.expressPort}/v1`;
    return `http://${window.location.hostname || 'localhost'}:3001/v1`;
  }, [nativeStatus]);
  const primaryUrl = lanUrls[0] || fallbackUrl;

  useEffect(() => {
    let mounted = true;
    api.getNetworkInfo()
      .then(res => { if (mounted) setLanUrls(Array.isArray(res?.data?.lanUrls) ? res.data.lanUrls : []); })
      .catch((err) => {
        if (mounted) addToast?.(err?.message || 'Failed to load network info', 'error');
      });
    return () => { mounted = false; };
  }, [addToast]);

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
    } catch {
      // Fallback for non-secure contexts (e.g., HTTP in Electron)
      try {
        const ta = document.createElement('textarea');
        ta.value = primaryUrl;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        addToast('Failed to copy to clipboard', 'error');
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      {inElectron && !nativeLoading && nativeInfo && (
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
            {authTokenStatus && (
              <div>
                <span style={{ color: 'var(--text-tertiary)' }}>Unlock Token: </span>
                <span style={{ color: authTokenStatus.present ? 'var(--status-success)' : 'var(--status-warning)' }}>
                  {authTokenStatus.present ? 'stored' : authTokenStatus.expired ? 'expired' : 'not stored'}
                </span>
                {authTokenStatus.expiresAt && (
                  <span style={{ color: 'var(--text-tertiary)' }}> until {new Date(authTokenStatus.expiresAt).toLocaleString()}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Biometric Unlock (#11) ──────────────────────────────────── */}
      {inElectron && biometricInfo && (
        <div className="card" style={{ padding: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <LockIcon size={15} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {biometricInfo.label || 'Biometric'} Unlock
            </span>
            <span style={{
              marginLeft: 'auto', fontSize: '0.65rem', fontFamily: 'var(--font-mono)',
              color: biometricInfo.available ? 'var(--status-success)' : 'var(--text-tertiary)',
            }}>
              {biometricInfo.available ? 'AVAILABLE' : 'UNAVAILABLE'}
            </span>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 10px' }}>
            {biometricInfo.available
              ? `Use ${biometricInfo.label} to unlock the vault on this device. Your password is still required for sensitive operations.`
              : (biometricInfo.reason || `${biometricInfo.label} is not available on this device.`)}
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: biometricInfo.available ? 'pointer' : 'not-allowed', opacity: biometricInfo.available ? 1 : 0.5 }}>
              <input
                type="checkbox"
                disabled={!biometricInfo.available}
                checked={Boolean(prefs?.biometricEnabled)}
                onChange={(e) => togglePref('biometricEnabled', e.target.checked)}
              />
              Require {biometricInfo.label} when unlocking the vault
            </label>
            {biometricInfo.available && (
              <button className="btn btn-secondary btn-sm" onClick={tryBiometricPrompt}>
                Test Prompt
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Crash Telemetry (#9) ───────────────────────────────────── */}
      {inElectron && prefs && (
        <div className="card" style={{ padding: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <InfoIcon size={15} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Crash Reports (Optional)
            </span>
            <span style={{
              marginLeft: 'auto', fontSize: '0.65rem', fontFamily: 'var(--font-mono)',
              color: prefs.telemetryEnabled ? 'var(--status-success)' : 'var(--text-tertiary)',
            }}>
              {prefs.telemetryEnabled ? 'ENABLED' : 'OFF (DEFAULT)'}
            </span>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 10px' }}>
            Help fix bugs by sending anonymized crash reports. <strong>Off by default.</strong>
          </p>
          <details style={{ marginBottom: 12, fontSize: '0.78rem' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', userSelect: 'none' }}>
              What gets sent / what doesn't
            </summary>
            <div style={{ marginTop: 8, paddingLeft: 12, color: 'var(--text-secondary)' }}>
              <p style={{ margin: '6px 0', color: 'var(--status-success)' }}>Sent (when enabled):</p>
              <ul style={{ margin: '0 0 8px 20px', padding: 0 }}>
                <li>Exception type, message, stack trace</li>
                <li>App version, OS, Electron version</li>
                <li>A correlation ID for matching repeat reports</li>
              </ul>
              <p style={{ margin: '6px 0', color: 'var(--status-error)' }}>Never sent:</p>
              <ul style={{ margin: '0 0 0 20px', padding: 0 }}>
                <li>API keys, session cookies, account emails</li>
                <li>Network request bodies or response bodies</li>
                <li>Files or anything from your filesystem</li>
                <li>Anything when this toggle is off</li>
              </ul>
            </div>
          </details>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(prefs.telemetryEnabled)}
              onChange={(e) => togglePref('telemetryEnabled', e.target.checked)}
            />
            Send anonymized crash reports to Hydra
          </label>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', margin: '8px 0 0' }}>
            Toggle takes effect on next launch.
          </p>
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
