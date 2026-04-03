import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api';
import ScrambleText from '../components/ScrambleText';
import {
  NetworkIcon,
  CopyIcon,
  RefreshIcon,
  AlertIcon,
  KeyIcon,
  ShieldIcon,
  EyeIcon,
  InfoIcon,
} from '../components/Icons';

/** OpenRouter account Keys page — users can reveal/copy sk-or-v1 in the browser (not available via management API). */
const OPENROUTER_KEYS_URL = 'https://openrouter.ai/settings/keys';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeAccountKeys(keys) {
  if (Array.isArray(keys)) return keys;
  if (keys && Array.isArray(keys.list)) return keys.list;
  return [];
}

function formatModelCacheSubtitle(modelCache) {
  if (!modelCache || (modelCache.count ?? 0) === 0) {
    return 'Not cached — use Refresh Models to populate the client picker list.';
  }
  const when = modelCache.updatedAt
    ? new Date(modelCache.updatedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : 'unknown';
  return `${modelCache.count} model(s) · updated ${when}`;
}

function StatusDot({ pooled, hasKey }) {
  let title = 'Not pooled';
  if (pooled && hasKey) { title = 'Active in pool'; }
  else if (pooled && !hasKey) { title = 'Pooled — key string missing'; }
  
  const statusClass = (pooled && hasKey) ? 'success' : (pooled && !hasKey) ? 'warning' : 'pending';
  
  return (
    <span
      title={title}
      className={`status-dot ${statusClass}`}
      style={{ marginTop: 2 }}
    />
  );
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* noop */ }
  }
  return (
    <button
      className="btn btn-secondary btn-sm"
      onClick={handleCopy}
      style={{ gap: 6, minWidth: 100 }}
      title={`Copy ${label}`}
    >
      <CopyIcon size={14} />
      {copied ? '✓ Copied' : `Copy ${label}`}
    </button>
  );
}

function ProxyStatusBadge({ status, stats }) {
  const isOnline = status === 'online';
  const isLoading = status === 'loading';
  const label = isLoading ? 'Checking…' : isOnline ? 'Proxy online' : 'Proxy offline';

  const title = stats
    ? `${label} · pooled ${stats.pooled ?? 0} · available ${stats.available ?? 0} · cooldowns ${stats.cooldowns ?? 0} · uptime ${stats.uptime ?? 0}s`
    : label;

  return (
    <span className={`badge ${isOnline ? 'badge-success' : isLoading ? 'badge-neutral' : 'badge-error'}`} title={title} style={{ gap: 8 }}>
      <span className={`status-dot ${isOnline ? 'success' : isLoading ? 'loading' : 'error'}`} />
      {label}
    </span>
  );
}

// ─── Key Row ─────────────────────────────────────────────────────────────────

function KeyRow({ keyData, onToggle, onRegister }) {
  const [showPaste, setShowPaste] = useState(false);
  const [pasteVal, setPasteVal] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  const {
    hash, name, enabled, isPooled, hasKeyString, plaintextKey, isProvisioningKey,
    usage
  } = keyData;

  const [showPlaintext, setShowPlaintext] = useState(false);

  async function handleSaveKey() {
    if (!pasteVal.trim()) return;
    setSaving(true);
    try {
      await onRegister(hash, pasteVal.trim());
      setShowPaste(false);
      setPasteVal('');
    } finally {
      setSaving(false);
    }
  }

  async function openPastePanel() {
    setPasteVal('');
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) setPasteVal(text.trim());
    } catch { /* user types manually */ }
    setShowPaste(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const canPool = hasKeyString;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '28px 1fr auto auto auto',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        background: isPooled ? 'rgba(0,255,102,0.03)' : 'transparent',
        borderLeft: isPooled ? '2px solid var(--status-success)' : '2px solid transparent',
        transition: 'all 150ms',
      }}
    >
      {/* Checkbox */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={isPooled}
          disabled={!canPool}
          onChange={(e) => onToggle(hash, e.target.checked)}
          title={canPool ? (isPooled ? 'Remove from pool' : 'Add to pool') : 'Paste key string first'}
          style={{ width: 16, height: 16, accentColor: 'var(--status-success)', cursor: canPool ? 'pointer' : 'not-allowed' }}
        />
      </div>

      {/* Key info */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot pooled={isPooled} hasKey={hasKeyString} />
          <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
            {name || 'Unnamed'}
          </span>
          {isProvisioningKey && (
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', border: '1px solid var(--accent-secondary)', color: 'var(--accent-secondary)', fontFamily: 'var(--font-mono)' }}>
              MGMT
            </span>
          )}
        </div>
        <code style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all', display: 'block', maxWidth: '100%', cursor: plaintextKey ? 'pointer' : 'default' }} onClick={() => plaintextKey && setShowPlaintext(!showPlaintext)}>
          {showPlaintext && plaintextKey ? (
            <span style={{ color: 'var(--accent-primary)' }}>{plaintextKey}</span>
          ) : (
            <ScrambleText text={hash ? hash.slice(0, 12) + '…' : '—'} duration={300} />
          )}
        </code>

        {/* Paste key panel */}
        {showPaste && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              ref={inputRef}
              type="password"
              className="form-input"
              placeholder="sk-or-v1-…"
              value={pasteVal}
              onChange={(e) => setPasteVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey(); if (e.key === 'Escape') setShowPaste(false); }}
              style={{ fontSize: '0.8rem', padding: '4px 10px', height: 32, flex: 1 }}
            />
            <button className="btn btn-primary btn-sm" onClick={handleSaveKey} disabled={saving || !pasteVal.trim()}>
              {saving ? <><div className="spinner-sm" /> Saving…</> : (hasKeyString ? 'Replace' : 'Save')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowPaste(false)}>✕</button>
          </div>
        )}
      </div>

      {/* Usage */}
      <div style={{ textAlign: 'right', minWidth: 60 }}>
        {usage != null ? (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            ${Number(usage).toFixed(2)}
          </span>
        ) : (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>—</span>
        )}
      </div>

      {/* No-key-string warning / paste button */}
      <div style={{ minWidth: 100, textAlign: 'right' }}>
        {!hasKeyString ? (
          <button
            className="btn btn-sm"
            onClick={openPastePanel}
            style={{
              color: 'var(--status-warning)',
              border: '1px solid var(--status-warning)',
              background: 'rgba(255,238,0,0.05)',
              gap: 4,
              fontSize: '0.72rem',
            }}
          >
            <AlertIcon size={12} /> Paste Key
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--status-success)', fontFamily: 'var(--font-mono)' }}>
              ✓ Stored
            </span>
            {plaintextKey && (
              <button 
                className={`btn btn-ghost btn-sm ${showPlaintext ? 'active' : ''}`} 
                style={{ padding: '2px 4px', height: 20 }} 
                onClick={() => setShowPlaintext(!showPlaintext)}
                title={showPlaintext ? 'Hide Key' : 'Show Key'}
              >
                <EyeIcon size={12} />
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={openPastePanel}
              title="Paste a new sk-or-v1-… if you rotated this key on OpenRouter or need to fix a bad paste"
              style={{ fontSize: '0.72rem', padding: '2px 8px', height: 24 }}
            >
              Replace
            </button>
          </div>
        )}
      </div>

      {/* Status dot */}
      <div>
        <span
          style={{
            fontSize: '0.72rem',
            color: enabled ? 'var(--status-success)' : 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {enabled ? '● ON' : '○ OFF'}
        </span>
      </div>
    </div>
  );
}

// ─── Account Row (collapsible) ────────────────────────────────────────────────

function AccountRow({ account, onToggleKey, onToggleAccount, onRegister }) {
  const [expanded, setExpanded] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);

  const keyList = normalizeAccountKeys(account.keys);

  const eligibleKeys = keyList.filter(k => k.hasKeyString);
  const pooledEligible = eligibleKeys.filter(k => k.isPooled);
  const allPooled = eligibleKeys.length > 0 && pooledEligible.length === eligibleKeys.length;
  const somePooled = pooledEligible.length > 0;

  const missingCount = keyList.filter(k => !k.hasKeyString).length;

  async function handleBulkToggle(val) {
    setBulkLoading(true);
    await onToggleAccount(account.id, val);
    setBulkLoading(false);
  }

  return (
    <div style={{ border: '2px solid var(--border-subtle)', marginBottom: 12 }}>
      {/* Account header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: 'var(--bg-tertiary)',
          cursor: 'pointer',
          borderBottom: expanded ? '2px solid var(--border-subtle)' : 'none',
        }}
      >
        {/* Bulk checkbox */}
        <input
          type="checkbox"
          checked={allPooled}
          ref={(el) => {
            if (el) el.indeterminate = somePooled && !allPooled;
          }}
          disabled={eligibleKeys.length === 0 || bulkLoading}
          onChange={(e) => handleBulkToggle(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          style={{ width: 16, height: 16, accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
          title="Toggle all keys in account"
        />

        {/* Expand toggle */}
        <div onClick={() => setExpanded(v => !v)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>{expanded ? '▼' : '▶'}</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
              {account.alias}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {account.email || 'No email'} · {keyList.length} key{keyList.length !== 1 ? 's' : ''}
              {missingCount > 0 && (
                <span style={{ color: 'var(--status-warning)', marginLeft: 8 }}>
                  ⚠ {missingCount} need key string
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: 'var(--status-success)' }}>{pooledEligible.length}</span>
            <span style={{ color: 'var(--text-tertiary)' }}>/{keyList.length} pooled</span>
          </div>
        </div>

        {account.error && (
          <span style={{ fontSize: '0.72rem', color: 'var(--status-error)', border: '1px solid var(--status-error)', padding: '2px 6px' }}>
            {account.error}
          </span>
        )}
      </div>

      {/* Key list */}
      {expanded && keyList.length > 0 && (
        <div>
          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '28px 1fr auto auto auto',
            gap: 10,
            padding: '4px 12px',
            fontSize: '0.65rem',
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <span />
            <span>Key</span>
            <span style={{ textAlign: 'right' }}>Usage</span>
            <span style={{ textAlign: 'right' }}>String</span>
            <span>Status</span>
          </div>
          {keyList.map(k => (
          <KeyRow
            key={k.hash}
            keyData={k}
            onToggle={(hash, val) => onToggleKey(hash, val)}
            onRegister={onRegister}
          />
          ))}
        </div>
      )}

      {expanded && keyList.length === 0 && !account.error && (
        <div style={{ padding: '16px', color: 'var(--text-tertiary)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
          No keys found for this account.
        </div>
      )}
    </div>
  );
}

// ─── Master Endpoint Card ─────────────────────────────────────────────────────

function EndpointCard({ masterKey, endpoint, modelCache }) {
  if (!masterKey) return (
    <div className="card" style={{ padding: 'var(--space-lg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="spinner-sm" />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading endpoint…</span>
      </div>
    </div>
  );

  return (
    <div className="card" style={{
      padding: 'var(--space-lg)',
      border: '2px solid var(--accent-primary)',
      boxShadow: '4px 4px 0 var(--accent-primary)',
    }}>
      <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        Master Endpoint
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 4 }}>Base URL</div>
        <code style={{ fontSize: '0.8rem', color: 'var(--accent-secondary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
          {endpoint}
        </code>
        <div style={{ marginTop: 6 }}>
          <CopyButton text={endpoint} label="URL" />
        </div>
      </div>

      <div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 4 }}>Bearer Token</div>
        <code style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', wordBreak: 'break-all' }}>
          {masterKey}
        </code>
        <div style={{ marginTop: 6 }}>
          <CopyButton text={masterKey} label="Key" />
        </div>
      </div>

      <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', fontSize: '0.68rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 4 }}>Model list cache</span>
        {formatModelCacheSubtitle(modelCache)}
      </div>

      <div style={{ marginTop: 16, padding: '8px 10px', background: 'rgba(0,204,255,0.05)', border: '1px solid var(--status-info)', fontSize: '0.7rem', color: 'var(--status-info)', lineHeight: 1.5 }}>
        Use with any OpenAI-compatible client (Cursor, Open WebUI, etc).
      </div>
      <div style={{ marginTop: 8, fontSize: '0.68rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        Key reveal in this page is local-only and intended for self-hosted workflows.
      </div>
    </div>
  );
}

// ─── Pool Manager Page ────────────────────────────────────────────────────────

export default function PoolManager({ addToast }) {
  const [accounts, setAccounts] = useState([]);
  const [poolStats, setPoolStats] = useState(null);
  const [masterKey, setMasterKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [proxyStatus, setProxyStatus] = useState('loading');
  const [proxyStatusStats, setProxyStatusStats] = useState(null);
  const [reloadingPool, setReloadingPool] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [modelCache, setModelCache] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpWrapRef = useRef(null);
  const didInitialLoadRef = useRef(false);

  useEffect(() => {
    if (!helpOpen) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') setHelpOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [helpOpen]);

  useEffect(() => {
    if (!helpOpen) return;
    function onPointerDown(e) {
      if (helpWrapRef.current && !helpWrapRef.current.contains(e.target)) {
        setHelpOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [helpOpen]);

  const loadPoolData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const [poolRes, keyRes] = await Promise.all([api.getPoolData(), api.getMasterKey()]);
      const rawAccounts = poolRes.data?.accounts ?? [];
      setAccounts(rawAccounts.map((a) => ({ ...a, keys: normalizeAccountKeys(a.keys) })));
      setPoolStats(poolRes.data?.poolStats ?? null);
      setModelCache(poolRes.data?.modelCache ?? null);
      setMasterKey(keyRes.data?.masterKey ?? '');
      setEndpoint(keyRes.data?.endpoint ?? '');
    } catch (err) {
      addToast(err.message, 'error');
    }
    setLoading(false);
    setRefreshing(false);
  }, [addToast]);

  const loadProxyStatus = useCallback(async () => {
    try {
      const res = await api.getPoolStatus();
      const data = res.data ?? {};
      setProxyStatus(data.proxy === 'online' ? 'online' : 'offline');
      setProxyStatusStats({
        pooled: data.pooled ?? 0,
        available: data.available ?? 0,
        cooldowns: data.cooldowns ?? 0,
        uptime: data.uptime ?? 0,
      });
    } catch {
      setProxyStatus('offline');
      setProxyStatusStats(null);
    }
  }, []);

  const load = useCallback(async (quiet = false) => {
    await Promise.all([loadPoolData(quiet), loadProxyStatus()]);
  }, [loadPoolData, loadProxyStatus]);

  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    load();
  }, [load]);

  async function handleToggleKey(hash, isPooled) {
    try {
      await api.toggleKeyPooled(hash, isPooled);
      addToast(`Key ${isPooled ? 'added to' : 'removed from'} pool`, 'success');
      await load(true);
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  async function handleToggleAccount(accountId, isPooled) {
    try {
      const res = await api.toggleAccountPooled(accountId, isPooled);
      addToast(`${res.data?.updated ?? 0} key(s) ${isPooled ? 'added to' : 'removed from'} pool`, 'success');
      await load(true);
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  async function handleRegister(hash, keyString) {
    try {
      await api.registerKeyString(hash, keyString);
      addToast('Key string saved and encrypted locally', 'success');
      await load(true);
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  async function handleReloadPool() {
    setReloadingPool(true);
    try {
      await api.reloadPool();
      addToast('Pool reloaded', 'success');
      await load(true);
    } catch (err) {
      addToast(err.message, 'error');
      await loadProxyStatus();
    } finally {
      setReloadingPool(false);
    }
  }

  const totalPooled = poolStats?.pooledCount ?? 0;
  const totalReady = poolStats?.poolReadyCount ?? 0;
  const totalKeys = poolStats?.totalKeys ?? 0;
  const cooldowns = poolStats?.activeCooldowns ?? 0;

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <NetworkIcon size={32} style={{ color: 'var(--accent-primary)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ width: '100%', minWidth: 0 }}>
              <div ref={helpWrapRef} style={{ position: 'relative', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h2>Pool Router</h2>
                  <ProxyStatusBadge status={proxyStatus} stats={proxyStatusStats} />
                  <button
                    type="button"
                    className="pool-help-trigger"
                    aria-expanded={helpOpen}
                    aria-controls="pool-keys-help"
                    id="pool-keys-help-trigger"
                    onClick={() => setHelpOpen((o) => !o)}
                  >
                    <InfoIcon size={16} aria-hidden />
                    <span>About keys</span>
                  </button>
                </div>
                {helpOpen && (
                  <div
                    id="pool-keys-help"
                    className="pool-help-panel"
                    role="dialog"
                    aria-labelledby="pool-keys-help-trigger"
                  >
                    <ul>
                      <li>
                        <strong>Management keys</strong> can <em>list</em> keys via the OpenRouter API—they never receive existing standard-key secrets.
                      </li>
                      <li>
                        A new <code>sk-or-v1-…</code> appears in API responses only when a key is <em>created</em> in that call. Keys created in Hydra are stored automatically.
                      </li>
                      <li>
                        Keys created on the site: open{' '}
                        <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noopener noreferrer">
                          Keys in OpenRouter
                        </a>
                        , use <strong>Reveal / Copy</strong>, then <strong>Paste Key</strong> or <strong>Replace</strong> here.
                      </li>
                    </ul>
                  </div>
                )}
              </div>
              <p>Aggregate & rotate keys through a single local endpoint</p>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => load(true)}
              disabled={refreshing || loading}
              style={{ gap: 8, minWidth: 160 }}
              title="Reload key list and pool stats from OpenRouter (live /keys per account)."
            >
              <RefreshIcon size={14} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
              {refreshing ? 'Syncing…' : 'Sync from OpenRouter'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleReloadPool}
              disabled={reloadingPool || loading || refreshing}
              style={{ gap: 8, minWidth: 140 }}
              title="Rebuild in-memory rotation state from the database (after toggling keys)."
            >
              <RefreshIcon size={14} style={{ animation: reloadingPool ? 'spin 0.8s linear infinite' : 'none' }} />
              {reloadingPool ? 'Reloading…' : 'Reload Pool'}
            </button>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              setRefreshingModels(true);
              try {
                const res = await api.refreshModels();
                const n = res?.data?.count ?? 0;
                addToast(`Model list cache updated (${n} models)`, 'success');
                await load(true);
              } catch (err) {
                addToast(err.message, 'error');
              } finally {
                setRefreshingModels(false);
              }
            }}
            disabled={loading || refreshing || refreshingModels}
            style={{ gap: 8, width: '100%' }}
            title="Fetch the OpenRouter model catalog and store it locally for GET /v1/models (Cursor, Open WebUI, etc.). Uses a pooled key if available, otherwise any pasted standard key."
          >
            <RefreshIcon size={14} style={{ animation: refreshingModels ? 'spin 0.8s linear infinite' : 'none' }} />
            {refreshingModels ? 'Refreshing…' : 'Refresh Models'}
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-grid" style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="stat-card stat-card-highlight shine-sweep animate-spring stagger-delay-0">
          <div className="stat-card-header">
            <span className="stat-card-label">Active in Pool</span>
            <NetworkIcon className="stat-icon" />
          </div>
          <div className={`stat-card-value mono ${totalReady > 0 ? 'success' : 'error'}`}>{totalReady}</div>
          <div className="stat-card-sub">of {totalPooled} checked / {totalKeys} total</div>
        </div>

        <div className="stat-card shine-sweep animate-spring stagger-delay-50">
          <div className="stat-card-header">
            <span className="stat-card-label">Cooling Down</span>
            <AlertIcon className="stat-icon" />
          </div>
          <div className={`stat-card-value mono ${cooldowns > 0 ? 'warning' : ''}`}>{cooldowns}</div>
          <div className="stat-card-sub">keys on circuit-breaker cooldown</div>
        </div>

        <div className="stat-card shine-sweep animate-spring stagger-delay-100">
          <div className="stat-card-header">
            <span className="stat-card-label">Need Key String</span>
            <KeyIcon className="stat-icon" />
          </div>
          <div className={`stat-card-value mono ${(poolStats?.missingStringCount ?? 0) > 0 ? 'warning' : ''}`}>
            {poolStats?.missingStringCount ?? 0}
          </div>
          <div className="stat-card-sub">paste raw sk-or-v1 once per key</div>
        </div>

        <div className="stat-card shine-sweep animate-spring stagger-delay-150">
          <div className="stat-card-header">
            <span className="stat-card-label">Accounts</span>
            <ShieldIcon className="stat-icon" />
          </div>
          <div className="stat-card-value mono">{accounts.length}</div>
          <div className="stat-card-sub">connected OpenRouter accounts</div>
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 'var(--space-xl)', alignItems: 'start' }}>

        {/* Left: Key tree */}
        <div>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1, 2, 3].map(i => (
                <div key={i} className="skeleton" style={{ height: 60 }} />
              ))}
            </div>
          ) : accounts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon pulsar">[POOL]</div>
              <h3>No accounts found</h3>
              <p>Add accounts in the Dashboard, then sync them here.</p>
            </div>
          ) : (
            accounts.map((account, index) => (
              <div key={account.id} className="animate-spring" style={{ animationDelay: `${(index + 3) * 50}ms` }}>
                <AccountRow
                  account={account}
                  onToggleKey={handleToggleKey}
                  onToggleAccount={handleToggleAccount}
                  onRegister={handleRegister}
                />
              </div>
            ))
          )}
        </div>

        {/* Right: Endpoint card + legend */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
          <EndpointCard masterKey={masterKey} endpoint={endpoint} modelCache={modelCache} />

          <div className="card" style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Legend
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--status-success)', boxShadow: '0 0 6px var(--status-success)', flexShrink: 0 }} />
                Active in rotation pool
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--status-warning)', flexShrink: 0 }} />
                Checked — key string missing
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-tertiary)', flexShrink: 0 }} />
                Not in pool
              </div>
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border-subtle)', fontSize: '0.68rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                Management keys can&apos;t fetch <code style={{ fontSize: '0.65rem' }}>sk-or-v1</code> secrets over the API—use <strong>About keys</strong> in the header for the full story.
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '10px 12px', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Rotation Logic
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <div>→ <strong>Round-robin</strong> across active keys</div>
              <div>→ <strong>429</strong> → 60s cooldown</div>
              <div>→ <strong>402</strong> → 10min cooldown</div>
              <div>→ <strong>401</strong> → permanent eviction</div>
              <div>→ Up to <strong>3</strong> failover retries</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
