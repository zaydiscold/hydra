import { useEffect, useState, useCallback } from 'react';
import * as api from '../api';
import { InfoIcon, NetworkIcon, RefreshIcon, CopyIcon } from '../components/Icons';

export default function Diagnostics({ addToast }) {
  const [health, setHealth] = useState(null);
  const [proxyStatus, setProxyStatus] = useState(null);
  const [nativeInfo, setNativeInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const isElectron = typeof window !== 'undefined' && window.hydraNative;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [healthRes, proxyRes] = await Promise.allSettled([
        api.getSystemHealth(),
        api.getProxyStatus(),
      ]);
      if (healthRes.status === 'fulfilled') {
        setHealth(healthRes.value?.data ?? healthRes.value ?? {});
      }
      if (proxyRes.status === 'fulfilled') {
        setProxyStatus(proxyRes.value?.data ?? proxyRes.value ?? {});
      }
    } catch {
      // fine — show placeholders
    }

    if (isElectron) {
      try {
        const [versionRes, platformRes, pathsRes] = await Promise.allSettled([
          window.hydraNative.appVersion(),
          window.hydraNative.platform(),
          window.hydraNative.appPaths(),
        ]);
        setNativeInfo({
          version: versionRes.status === 'fulfilled' ? versionRes.value?.data : null,
          platform: platformRes.status === 'fulfilled' ? platformRes.value?.data : null,
          paths: pathsRes.status === 'fulfilled' ? pathsRes.value?.data : null,
        });
      } catch {
        // fine
      }
    }
    setLoading(false);
  }, [isElectron]);

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

    // Data dir (Electron)
    if (nativeInfo?.paths?.userData) {
      lines.push(`Data Dir: ${nativeInfo.paths.userData}`);
    }

    // Mode
    const mode = isElectron ? (import.meta.env.PROD ? 'Packaged' : 'Dev (Electron)') : 'Browser';
    lines.push(`Mode: ${mode}`);

    // Proxy status
    if (proxyStatus) {
      lines.push(`Proxy: ${proxyStatus.enabled ? 'Enabled' : 'Disabled'}`);
    }

    // Health
    if (health) {
      lines.push(`Uptime: ${Math.round(health.uptime || 0)}s`);
      if (health.pool) {
        lines.push(`Pool Keys: ${health.pool.pooled ?? '?'} (available: ${health.pool.available ?? '?'})`);
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
    } catch {
      addToast('Failed to copy to clipboard', 'error');
    }
  }, [nativeInfo, proxyStatus, health, isElectron, addToast]);

  const modeLabel = isElectron
    ? (import.meta.env.PROD ? 'Packaged (Electron)' : 'Dev (Electron)')
    : (import.meta.env.PROD ? 'Production' : 'Development');

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <InfoIcon size={28} style={{ color: 'var(--accent-primary)' }} />
          <div>
            <h2 style={{ margin: 0 }}>Diagnostics</h2>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={fetchData} disabled={loading}>
            <RefreshIcon size={14} /> {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleCopyBundle} disabled={loading}>
            <CopyIcon size={14} /> {copied ? 'Copied!' : 'Support Bundle'}
          </button>
        </div>
      </div>

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
            Server Health
          </div>
          {health ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              <div>Uptime: {Math.round(health.uptime || 0)}s</div>
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

        {/* Electron: App Paths */}
        {nativeInfo?.paths && (
          <div className="card" style={{ padding: 'var(--space-md)' }}>
            <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, color: 'var(--text-secondary)' }}>
              App Paths
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
              {nativeInfo.paths.userData && (
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Data: </span>
                  <code style={{ fontSize: '0.72rem', color: 'var(--accent-primary)' }}>{nativeInfo.paths.userData}</code>
                </div>
              )}
              {nativeInfo.paths.logs && (
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Logs: </span>
                  <code style={{ fontSize: '0.72rem', color: 'var(--accent-primary)' }}>{nativeInfo.paths.logs}</code>
                </div>
              )}
              {nativeInfo.paths.home && (
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Home: </span>
                  <code style={{ fontSize: '0.72rem', color: 'var(--accent-primary)' }}>{nativeInfo.paths.home}</code>
                </div>
              )}
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
            {isElectron ? 'Available (bundled)' : 'Browser mode — N/A'}
          </span>
        </div>

        {/* Placeholder: DB info */}
        <div className="card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, color: 'var(--text-secondary)' }}>
            Database
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            SQLite — data/hydra.db
          </span>
        </div>

      </div>
    </>
  );
}
