import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import ScrambleText from '../components/ScrambleText';
import { 
  ShieldIcon, 
  LockIcon, 
  InfoIcon, 
  HelpIcon, 
  PowerIcon,
  SettingsIcon,
  NetworkIcon
} from '../components/Icons';

export default function Settings({ addToast }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [networkLoading, setNetworkLoading] = useState(true);
  const [lanUrls, setLanUrls] = useState([]);

  const fallbackUrl = useMemo(
    () => `http://${window.location.hostname || 'localhost'}:3001/v1`,
    []
  );
  const primaryUrl = lanUrls[0] || fallbackUrl;

  useEffect(() => {
    let mounted = true;
    async function loadNetworkInfo() {
      setNetworkLoading(true);
      try {
        const res = await api.getNetworkInfo();
        if (!mounted) return;
        setLanUrls(Array.isArray(res?.data?.lanUrls) ? res.data.lanUrls : []);
      } catch (err) {
        if (mounted) addToast(err.message, 'error');
      } finally {
        if (mounted) setNetworkLoading(false);
      }
    }
    loadNetworkInfo();
    return () => {
      mounted = false;
    };
  }, [addToast]);

  async function handleChangePassword(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      addToast('Password changed successfully!', 'success');
      setOldPassword('');
      setNewPassword('');
    } catch (err) {
      addToast(err.message, 'error');
    }
    setLoading(false);
  }

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SettingsIcon size={32} style={{ color: 'var(--accent-primary)' }} />
          <div>
            <h2>Settings</h2>
            <p>Configure your Hydra instance, login security, and local proxy access</p>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div className="card shine-sweep animate-spring stagger-delay-0" style={{ maxWidth: '600px', marginBottom: 'var(--space-xl)', borderLeft: '6px solid var(--accent-primary)' }}>
        <h3 style={{ marginBottom: 'var(--space-md)', fontSize: '1.05rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 10 }}>
          <LockIcon size={18} style={{ color: 'var(--accent-primary)' }} />
          <span>Login Security</span>
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 'var(--space-lg)', fontFamily: 'var(--font-mono)' }}>
          Change the password used to access this local Hydra instance.
        </p>
        <form onSubmit={handleChangePassword}>
          <div className="form-group">
            <label>Current Password</label>
            <input
              type="password"
              className="form-input"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>New Password</label>
            <input
              type="password"
              className="form-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={4}
            />
          </div>
          <div className="info-banner" style={{ marginBottom: 'var(--space-md)', background: 'rgba(255, 184, 0, 0.05)', border: '1px solid rgba(255, 184, 0, 0.2)' }}>
            <span style={{ fontWeight: 800, color: 'var(--status-warning)' }}>⚠ CAUTION</span>
            <p style={{ fontSize: '0.75rem', marginTop: 4 }}>
              Changing your password will <strong>sign out your current Hydra session</strong>.
              You will need to log in again in this browser, but your existing <code>sk-hydra-...</code> proxy key will stay the same.
            </p>
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? <><div className="spinner" /> Updating...</> : 'Update Password'}
          </button>
        </form>
      </div>

      {/* Network Overview */}
      <div className="card shine-sweep animate-spring stagger-delay-50" style={{ maxWidth: '600px', marginBottom: 'var(--space-xl)', borderLeft: '6px solid var(--status-success)' }}>
        <h3 style={{ marginBottom: 'var(--space-md)', fontSize: '1.05rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 10 }}>
          <NetworkIcon size={18} style={{ color: 'var(--status-success)' }} />
          <span>Network configuration</span>
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 'var(--space-md)', fontFamily: 'var(--font-mono)' }}>
          Hydra exposes your API Pool via a local proxy. By default, it is bound to <code>0.0.0.0</code> and accessible across your Local Area Network.
        </p>

        <div style={{ background: 'var(--bg-card-hover)', padding: 'var(--space-md)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
          <div style={{ marginBottom: 4, color: 'var(--text-tertiary)' }}>Recommended Base URL:</div>
          <div className="mono" style={{ color: 'var(--status-success)' }}>{primaryUrl}</div>

          {!networkLoading && lanUrls.length > 1 && (
            <>
              <div style={{ marginTop: 'var(--space-md)', marginBottom: 4, color: 'var(--text-tertiary)' }}>Other LAN URLs:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {lanUrls.slice(1).map((url) => (
                  <div key={url} className="mono" style={{ color: 'var(--text-secondary)' }}>{url}</div>
                ))}
              </div>
            </>
          )}
          
          <div style={{ marginTop: 'var(--space-md)', marginBottom: 4, color: 'var(--text-tertiary)' }}>Cursor / Cline Setup:</div>
          <div style={{ color: 'var(--text-secondary)' }}>1. Set Base URL to the value above.</div>
          <div style={{ color: 'var(--text-secondary)' }}>2. Provide any <code className="mono" style={{ color: 'var(--accent-primary)' }}>sk-hydra-...</code> key generated in the Pool Manager.</div>
        </div>

        <div className="info-banner" style={{ marginTop: 'var(--space-md)', background: 'rgba(0, 255, 136, 0.05)', border: '1px solid rgba(0, 255, 136, 0.2)' }}>
          <span style={{ fontWeight: 800, color: 'var(--status-success)' }}>[LAN EXPOSURE ACTIVE]</span>
          <p style={{ fontSize: '0.75rem', marginTop: 4 }}>
            Only endpoints starting with <code>/v1/</code> are exposed without master authentication. All backend proxy requests still require a valid <code>sk-hydra-</code> token.
          </p>
        </div>
      </div>

      {/* About */}
      <div className="card shine-sweep animate-spring stagger-delay-100" style={{ maxWidth: '600px', marginBottom: 'var(--space-xl)', borderLeft: '6px solid var(--status-info)' }}>
        <h3 style={{ marginBottom: 'var(--space-md)', fontSize: '1.05rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 10 }}>
          <InfoIcon size={18} style={{ color: 'var(--status-info)' }} />
          <span>System Overview</span>
        </h3>
        <div style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
          <div style={{ marginBottom: 'var(--space-md)', padding: '12px 14px', background: 'var(--bg-card-hover)', borderLeft: '3px solid var(--accent-primary)', fontSize: '0.85rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            Hydra is a machine-isolated management layer for large-scale OpenRouter automation.
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-xl)', marginBottom: 'var(--space-lg)', padding: 'var(--space-md)', background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
              <div>
                <p><strong>VERSION</strong></p>
                <div className="mono" style={{ fontSize: '0.9rem' }}>
                  <ScrambleText text="v1.2.4-stable" duration={600} />
                </div>
              </div>
              <div>
                <p><strong>ENCRYPTION</strong></p>
                <div className="mono" style={{ fontSize: '0.9rem' }}>
                  <ScrambleText text="AES-256-GCM" duration={800} />
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <p><strong>STATUS</strong></p>
                <div className="vault-indicator" style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                  <div className="status-dot success" />
                  <span className="mono" style={{ fontSize: '0.8rem', fontWeight: 800 }}>ACTIVE</span>
                </div>
              </div>
          </div>
          
          <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--space-sm) 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
               <ShieldIcon size={16} style={{ color: 'var(--status-success)', marginTop: 4 }} /> 
               <span>Credentials are encrypted at rest on this machine to reduce accidental local exposure.</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
               <ShieldIcon size={16} style={{ color: 'var(--status-success)', marginTop: 4 }} /> 
               <span>API traffic is routed directly to OpenRouter endpoints.</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
               <ShieldIcon size={16} style={{ color: 'var(--status-success)', marginTop: 4 }} /> 
               <span>Zero telemetry. No external logs or tracking.</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Setup Guide */}
      <div className="card shine-sweep animate-spring stagger-delay-150" style={{ maxWidth: '600px', borderLeft: '6px solid var(--status-warning)' }}>
        <h3 style={{ marginBottom: 'var(--space-md)', fontSize: '1.05rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 10 }}>
          <HelpIcon size={18} style={{ color: 'var(--status-warning)' }} />
          <span>Provisioning Steps</span>
        </h3>
        <div style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p>To register a new local account profile in Hydra:</p>
          <ol style={{ paddingLeft: '20px', marginTop: 'var(--space-sm)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>Navigate to <strong>Account Settings</strong> on the OpenRouter dashboard.</li>
            <li>Generate a massive <strong>Management Key</strong> (NOT a normal API key).</li>
            <li>Copy the restricted-use management key string.</li>
            <li>Use the <strong>"Add Account"</strong> action on the Hydra Dashboard.</li>
            <li>Hydra will verify and encrypt your key immediately.</li>
          </ol>
          <div style={{ marginTop: 'var(--space-lg)', padding: 'var(--space-md)', background: 'rgba(255, 184, 0, 0.05)', border: '1px solid rgba(255, 184, 0, 0.2)', borderRadius: 4 }}>
            <p style={{ color: 'var(--status-warning)', fontWeight: 600, fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 8 }}>
               <PowerIcon size={14} style={{ color: 'var(--status-warning)' }} /> 
               CAUTION: MANAGEMENT KEYS ARE HIGH-PRIVILEGE
            </p>
            <p style={{ fontSize: '0.75rem', marginTop: 4 }}>
              Management keys grant permission to create/delete API keys and manage billing. Hydra stores them encrypted on disk for local safety, but never share them externally.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
