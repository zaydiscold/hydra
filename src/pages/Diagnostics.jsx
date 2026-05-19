import { useEffect, useState, useCallback } from 'react';
import * as api from '../api';
import AnimeText from '../components/AnimeText';
import { InfoIcon, NetworkIcon, RefreshIcon, CopyIcon } from '../components/Icons';
import { isElectron, native, tryNative } from '../lib/native';

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  if (minutes || hours || days) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

export function DiagnosticsPanel({ addToast, embedded = false }) {
  const [health, setHealth] = useState(null);
  const [proxyStatus, setProxyStatus] = useState(null);
  const [nativeInfo, setNativeInfo] = useState(null);
  const [authTokenStatus, setAuthTokenStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [diagnosticsError, setDiagnosticsError] = useState('');

  const inElectron = isElectron();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setDiagnosticsError('');
    try {
      const [healthRes, proxyRes] = await Promise.allSettled([
        api.getSystemHealth(),
        api.getProxyStatus(),
      ]);
      if (healthRes.status === 'fulfilled') {
        setHealth(healthRes.value?.data ?? healthRes.value ?? {});
      } else {
        const message = healthRes.reason?.message || 'System health request failed';
        console.warn('[DIAGNOSTICS] System health request failed:', message);
        setDiagnosticsError((prev) => [prev, `Health: ${message}`].filter(Boolean).join(' | '));
      }
      if (proxyRes.status === 'fulfilled') {
        setProxyStatus(proxyRes.value?.data ?? proxyRes.value ?? {});
      } else {
        const message = proxyRes.reason?.message || 'Proxy status request failed';
        console.warn('[DIAGNOSTICS] Proxy status request failed:', message);
        setDiagnosticsError((prev) => [prev, `Proxy: ${message}`].filter(Boolean).join(' | '));
      }
      setLastRefreshedAt(new Date());
    } catch (err) {
      const message = err.message || 'Diagnostics refresh failed';
      console.warn('[DIAGNOSTICS] Refresh failed:', message);
      setDiagnosticsError(message);
      addToast?.(message, 'warning');
    }

    if (inElectron) {
      // tryNative returns null on failure (already logs to console) — that's
      // exactly what we want for a diagnostics page: graceful degradation
      // with no UI explosion if a single bridge method is broken.
      const [version, platform, paths, tokenStatus] = await Promise.all([
        tryNative(native.appVersion),
        tryNative(native.platform),
        tryNative(native.appPaths),
        tryNative(native.authTokenStatus),
      ]);
      setNativeInfo({ version, platform, paths });
      setAuthTokenStatus(tokenStatus);
    }
    setLoading(false);
  }, [addToast, inElectron]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCopyBundle = useCallback(async () => {
    const lines = [];
    lines.push('=== Hydra Support Bundle ===');
    lines.push('');

    // Version
    const ver = nativeInfo?.version || import.meta.env.VITE_APP_VERSION || 'dev';
    lines.push(`Version: ${ver}`);

    // OS
    const platform = nativeInfo?.platform || navigator.platform || 'unknown';
    lines.push(`OS: ${platform}`);

    if (nativeInfo?.paths?.userData) lines.push('Data Dir: redacted; open from Settings or Help menu');
    if (nativeInfo?.paths?.logs) lines.push('Logs Dir: redacted; open from Settings or Help menu');
    if (authTokenStatus) {
      lines.push(`Unlock Token: ${authTokenStatus.present ? 'stored' : authTokenStatus.expired ? 'expired' : 'not stored'}`);
      if (authTokenStatus.expiresAt) lines.push(`Unlock Token Expires: ${authTokenStatus.expiresAt}`);
      lines.push(`Biometric Gate: ${authTokenStatus.biometricGate ? 'enabled' : 'disabled'}`);
    }

    // Mode
    const mode = inElectron ? (import.meta.env.PROD ? 'Packaged' : 'Dev (Electron)') : 'Browser';
    lines.push(`Mode: ${mode}`);

    // Proxy status
    if (proxyStatus) {
      lines.push(`Proxy: ${proxyStatus.enabled ? 'Enabled' : 'Disabled'}`);
    }

    // Health
    if (health) {
      lines.push(`Server Process Uptime: ${formatUptime(health.uptime)}`);
      if (health.startedAt) lines.push(`Server Started At: ${health.startedAt}`);
      if (health.serverNow) lines.push(`Server Clock: ${health.serverNow}`);
      if (health.pid) lines.push(`Server PID: ${health.pid}`);
      if (health.pool) {
        lines.push(`Pool Keys: ${health.pool.pooled ?? '?'} (available: ${health.pool.available ?? '?'})`);
      }
      if (health.upstream) {
        lines.push(`OpenRouter Upstream: ${health.upstream.status || 'unknown'}`);
        if (health.upstream.lastError) lines.push(`OpenRouter Upstream Error: ${health.upstream.lastError}`);
      }
    }

    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      addToast('Support bundle copied to clipboard', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('[DIAGNOSTICS] Support bundle copy failed:', err.message);
      addToast(`Failed to copy to clipboard: ${err.message || 'permission denied'}`, 'error');
    }
  }, [nativeInfo, authTokenStatus, proxyStatus, health, inElectron, addToast]);

  const openAppLocation = useCallback(async (location, label) => {
    try {
      await native.openAppLocation(location);
      addToast?.(`${label} opened`, 'success');
    } catch (err) {
      console.warn('[DIAGNOSTICS] Open app location failed:', location, err.message);
      addToast?.(`Failed to open ${label}: ${err.message}`, 'error');
    }
  }, [addToast]);

  const modeLabel = inElectron
    ? (import.meta.env.PROD ? 'Packaged (Electron)' : 'Dev (Electron)')
    : (import.meta.env.PROD ? 'Production' : 'Development');

  const header = (
    <div className={embedded ? '' : 'page-header'} style={embedded ? { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <InfoIcon size={embedded ? 20 : 28} style={{ color: 'var(--accent-primary)' }} />
        <div>
          {embedded ? (
            <>
              <AnimeText as="h3" mode="words" variant="scanline" delay={28} style={{ margin: 0 }}>Diagnostics</AnimeText>
              <p style={{ margin: '4px 0 0', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
                Live runtime facts from the active Hydra server and Electron shell.
              </p>
            </>
          ) : (
            <AnimeText as="h2" mode="words" variant="scanline" delay={28} style={{ margin: 0 }}>Diagnostics</AnimeText>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {lastRefreshedAt && (
          <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            refreshed {lastRefreshedAt.toLocaleTimeString()}
          </span>
        )}
        <button className="btn btn-secondary btn-sm" onClick={fetchData} disabled={loading}>
          <RefreshIcon size={14} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleCopyBundle} disabled={loading}>
          <CopyIcon size={14} /> {copied ? 'Copied!' : 'Support Bundle'}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {header}

      {diagnosticsError && (
        <div className="error-banner" role="status" aria-live="polite" style={{ marginBottom: 'var(--space-md)' }}>
          Diagnostics refresh incomplete: {diagnosticsError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-md)', alignItems: 'start' }}>

        {/* Hydra Version */}
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, color: 'var(--text-secondary)' }}>
            Version
          </div>
          <code style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
            {nativeInfo?.version || import.meta.env.VITE_APP_VERSION || 'dev'}
          </code>
        </div>

        {/* Mode */}
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, color: 'var(--text-secondary)' }}>
            Runtime Mode
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="status-dot success" style={{ width: 6, height: 6 }} />
            <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {modeLabel}
            </span>
          </div>
        </div>

        {/* Proxy Status */}
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, color: 'var(--text-secondary)' }}>
            Proxy
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="status-dot"
              style={{
                width: 6,
                height: 6,
                backgroundColor: proxyStatus?.enabled ? 'var(--status-success)' : 'var(--text-tertiary)',
              }}
            />
            <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {proxyStatus ? (proxyStatus.enabled ? 'Enabled' : 'Disabled') : 'Loading…'}
            </span>
          </div>
        </div>

        {/* Server Health */}
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, color: 'var(--text-secondary)' }}>
            Server Process Health
          </div>
          {health ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              <div>Uptime: {formatUptime(health.uptime)}</div>
              {health.startedAt && <div>Started: {new Date(health.startedAt).toLocaleString()}</div>}
              {health.serverNow && <div>Server clock: {new Date(health.serverNow).toLocaleString()}</div>}
              {health.pid && <div>PID: {health.pid}</div>}
              {health.pool && (
                <>
                  <div>Pooled keys: {health.pool.pooled ?? '?'}</div>
                  <div>Available: {health.pool.available ?? '?'}</div>
                  <div>Cooldowns: {health.pool.cooldowns ?? '?'}</div>
                </>
              )}
            </div>
          ) : (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {loading ? 'Loading…' : 'Unavailable'}
            </span>
          )}
        </div>

        {/* OpenRouter Upstream */}
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, color: 'var(--text-secondary)' }}>
            OpenRouter Upstream
          </div>
          {health?.upstream ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className="status-dot"
                  style={{
                    width: 6,
                    height: 6,
                    backgroundColor:
                      health.upstream.status === 'online'
                        ? 'var(--status-success)'
                        : health.upstream.status === 'offline'
                          ? 'var(--status-error)'
                          : 'var(--status-warning)',
                  }}
                />
                <span>{health.upstream.status || 'unknown'}</span>
              </div>
              {health.upstream.checkedAt && <div>Checked: {new Date(health.upstream.checkedAt).toLocaleString()}</div>}
              {health.upstream.consecutiveFailures > 0 && <div>Failures: {health.upstream.consecutiveFailures}</div>}
              {health.upstream.lastError && <div style={{ color: 'var(--status-error)', whiteSpace: 'pre-wrap' }}>{health.upstream.lastError}</div>}
            </div>
          ) : (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {loading ? 'Loading…' : 'No pings yet'}
            </span>
          )}
        </div>

        {/* Electron: App Locations */}
        {nativeInfo?.paths && (
          <div className="card" style={{ padding: 'var(--space-md)' }}>
            <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, color: 'var(--text-secondary)' }}>
              App Locations
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {nativeInfo.paths.userData && (
                <button className="btn btn-secondary btn-sm" onClick={() => void openAppLocation('userData', 'Data Folder')}>
                  Open Data Folder
                </button>
              )}
              {nativeInfo.paths.logs && (
                <button className="btn btn-secondary btn-sm" onClick={() => void openAppLocation('logs', 'Logs Folder')}>
                  Open Logs Folder
                </button>
              )}
            </div>
          </div>
        )}

        {/* Electron: 24h unlock token */}
        {authTokenStatus && (
          <div className="card" style={{ padding: 'var(--space-md)' }}>
            <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, color: 'var(--text-secondary)' }}>
              Unlock Token
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              <div>Status: <span style={{ color: authTokenStatus.present ? 'var(--status-success)' : 'var(--status-warning)' }}>{authTokenStatus.present ? 'stored' : authTokenStatus.expired ? 'expired' : 'not stored'}</span></div>
              {authTokenStatus.expiresAt && <div>Expires: {new Date(authTokenStatus.expiresAt).toLocaleString()}</div>}
              <div>Biometric gate: {authTokenStatus.biometricGate ? 'enabled' : 'disabled'}</div>
            </div>
          </div>
        )}

        {/* Prisma Engine */}
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, color: 'var(--text-secondary)' }}>
            Prisma Engine
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            SQLite (bundled)
          </span>
        </div>

        {/* Chromium / Playwright */}
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, color: 'var(--text-secondary)' }}>
            Chromium / Playwright
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {inElectron
              ? (import.meta.env.PROD ? 'Available (bundled)' : 'Available (dev runtime)')
              : 'Browser mode - N/A'}
          </span>
        </div>

        {/* Database */}
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, color: 'var(--text-secondary)' }}>
            Database
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {inElectron ? 'SQLite — Electron userData/hydra.db' : 'SQLite — active server DATABASE_URL'}
          </span>
        </div>

      </div>
    </>
  );
}

export default function Diagnostics({ addToast }) {
  return <DiagnosticsPanel addToast={addToast} />;
}
