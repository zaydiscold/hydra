import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePools } from '../hooks/usePools';
import DeleteKeyModal from '../components/DeleteKeyModal';
import RegisterKeyModal from '../components/RegisterKeyModal';
import AccountRow from '../components/AccountRow';
import {
  RefreshIcon,
  CopyIcon,
  SearchIcon,
  DatabaseIcon,
  AlertIcon,
} from '../components/Icons';
import { timeAgo } from '../utils/time';

/* --- Helper: Format model cache subtitle --- */
function formatModelCacheSubtitle(modelCache) {
  if (!modelCache) return 'No local model catalog found. Refresh to fetch from OpenRouter.';
  const updatedAt = modelCache.updatedAt ?? modelCache.timestamp;
  const ageStr = timeAgo(updatedAt);
  const updatedLabel = ageStr ? ` · Updated ${ageStr}` : ' · Refresh to update timestamps';
  return `${modelCache.count} models available${updatedLabel}`;
}

/* --- Sub-component: CopyButton --- */
function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="btn btn-ghost btn-sm" onClick={handleCopy} style={{ fontSize: '0.65rem', padding: '2px 6px', gap: 4 }}>
      <CopyIcon size={12} /> {copied ? 'Copied!' : `Copy ${label}`}
    </button>
  );
}

/* --- Sub-component: EndpointCard --- */
function EndpointCard({
  masterKey,
  endpoint,
  modelCache,
  onRefreshModels,
  refreshingModels,
  onRotateKey,
  rotatingKey,
  models
}) {
  const [modelsOpen, setModelsOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);

  const maskedKey = masterKey
    ? masterKey.slice(0, 10) + '••••••••••••••••••••••••' + masterKey.slice(-4)
    : '';

  const filteredModels = useMemo(() => {
    return (models ?? []).filter(m =>
      !modelFilter ||
      m.id.toLowerCase().includes(modelFilter.toLowerCase()) ||
      m.name.toLowerCase().includes(modelFilter.toLowerCase())
    );
  }, [models, modelFilter]);

  if (!masterKey) return (
    <div className="card" style={{ padding: 'var(--space-lg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="spinner-sm" />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading endpoint…</span>
      </div>
    </div>
  );

  return (
    <div className="card" style={{ padding: 'var(--space-lg)' }}>
      <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
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
        <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Bearer Token</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setKeyVisible(v => !v)}
              style={{ fontSize: '0.6rem', padding: '1px 6px' }}
              title={keyVisible ? 'Hide key' : 'Reveal key'}
            >
              {keyVisible ? '◉ Hide' : '○ Show'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title="Rotate master key — generates a new sk-hydra-* key. Update your clients after rotating."
              onClick={onRotateKey}
              disabled={rotatingKey}
              style={{ fontSize: '0.6rem', padding: '1px 6px', color: 'var(--status-warning)', border: '1px solid currentColor', borderRadius: 3, opacity: rotatingKey ? 0.5 : 1 }}
            >
              {rotatingKey ? <div className="spinner" style={{ width: 8, height: 8 }} /> : '↺'} Rotate
            </button>
          </div>
        </div>
        <code style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', wordBreak: 'break-all', userSelect: keyVisible ? 'text' : 'none' }}>
          {keyVisible ? masterKey : maskedKey}
        </code>
        <div style={{ marginTop: 6 }}>
          <CopyButton text={masterKey} label="Key" />
        </div>
      </div>

      <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', fontSize: '0.68rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Model list cache</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            style={{ padding: 0, minHeight: 'unset', width: 22, height: 22, marginTop: -2 }}
            onClick={onRefreshModels}
            disabled={refreshingModels}
          >
            <RefreshIcon size={12} style={{ animation: refreshingModels ? 'spin 1s linear infinite' : 'none', opacity: 0.7 }} />
          </button>
        </div>
        {formatModelCacheSubtitle(modelCache)}
      </div>

      {(models ?? []).length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ width: '100%', justifyContent: 'space-between', fontSize: '0.68rem', padding: '4px 10px' }}
            onClick={() => setModelsOpen(o => !o)}
          >
            <span>Browse {models.length} models</span>
            <span>{modelsOpen ? '▲' : '▼'}</span>
          </button>
          {modelsOpen && (
            <div style={{ marginTop: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ padding: 8, borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <SearchIcon size={12} style={{ opacity: 0.5 }} />
                <input
                  type="text"
                  placeholder="Filter models..."
                  value={modelFilter}
                  onChange={e => setModelFilter(e.target.value)}
                  style={{ background: 'transparent', border: 'none', width: '100%', fontSize: '0.72rem', outline: 'none', color: 'var(--text-primary)' }}
                />
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', padding: '4px 0' }}>
                {filteredModels.map(m => (
                  <div key={m.id} style={{ padding: '4px 10px', fontSize: '0.7rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="hover-bg">
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{m.id}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(m.id)} style={{ padding: '2px 4px', height: 20 }}>
                      <CopyIcon size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --- Main Component --- */
export default function PoolManager({ addToast }) {
  const navigate = useNavigate();
  const {
    accounts,
    poolStats,
    masterKey,
    endpoint,
    loading,
    refreshing,
    proxyStatus,
    proxyStatusStats,
    reloadingPool,
    refreshingModels,
    modelCache,
    models,
    proxyOn,
    load,
    handleToggleProxy,
    handleToggleKey,
    handleRegister,
    handleRefreshModels,
    handleAutoProvision,
    handleSyncKeys,
    handleDisableKey,
    handleDeleteKey,
    handleReloadPool,
    handleRotateMasterKey,
    rotatingKey,
  } = usePools({ addToast });

  const [search, setSearch] = useState('');
  const [registering, setRegistering] = useState(null); // { hash, name }
  const [deleting, setDeleting] = useState(null); // hash

  // Filtering
  const filteredAccounts = useMemo(() => {
    if (!search) return accounts;
    const s = search.toLowerCase();
    return accounts.filter(a => 
      a.name?.toLowerCase().includes(s) || 
      a.email?.toLowerCase().includes(s) ||
      a.keys.some(k => k.name?.toLowerCase().includes(s) || k.hash.toLowerCase().includes(s))
    );
  }, [accounts, search]);

  // UI Handlers
  const onToggleKey = (hash, checked) => handleToggleKey(hash, checked);
  const onSyncKeys = (id) => handleSyncKeys(id);
  const onProvision = (id) => handleAutoProvision(id);

  if (loading && accounts.length === 0) {
    return (
      <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="container">
      <header style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <DatabaseIcon size={24} color="var(--accent-primary)" />
            Pool Manager
          </h1>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem', marginTop: 4 }}>
            Manage your keys and accounts in the unified routing pool.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? <div className="spinner-sm" /> : <RefreshIcon size={16} />} Refresh
          </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 24, alignItems: 'flex-start' }}>
        {/* Left Column: Accounts List */}
        <section>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
                  <SearchIcon size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                  <input 
                    type="text" 
                    placeholder="Search accounts or keys..." 
                    className="input" 
                    style={{ paddingLeft: 32, height: 36, fontSize: '0.85rem' }}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                  {filteredAccounts.length} accounts found
                </div>
              </div>
            </div>

            <div style={{ minHeight: 400 }}>
              {filteredAccounts.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <AlertIcon size={48} style={{ opacity: 0.1, marginBottom: 16 }} />
                  <div>No accounts matching your search</div>
                </div>
              ) : (
                filteredAccounts.map(a => (
                  <AccountRow 
                    key={a.id} 
                    account={a} 
                    onToggleKey={onToggleKey}
                    onRegisterKey={(hash, name) => setRegistering({ hash, name })}
                    onDisableKey={handleDisableKey}
                    onDeleteKey={setDeleting}
                    onAccountAction={(id, action) => {
                      if (action === 'sync') onSyncKeys(id);
                      if (action === 'provision') onProvision(id);
                      if (action === 'settings') navigate(`/account/${id}`);
                    }}
                  />
                ))
              )}
            </div>
          </div>
        </section>

        {/* Right Column: Engine Control + Endpoint */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Engine Control — always at top, always visible */}
          <div className="card" style={{
            padding: 'var(--space-lg)',
            border: `2px solid ${proxyStatus !== 'online' ? 'var(--border-subtle)' : proxyOn ? 'rgba(0,255,136,0.3)' : 'var(--status-error)'}`,
          }}>
            {/* Status row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                background: proxyStatus === 'loading'
                  ? 'var(--text-tertiary)'
                  : proxyStatus !== 'online'
                    ? 'var(--status-error)'
                    : proxyOn ? 'var(--status-success)' : 'var(--status-error)',
                boxShadow: proxyStatus === 'online' && proxyOn ? '0 0 7px var(--status-success)' : 'none',
              }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {proxyStatus === 'loading'
                  ? 'ENGINE: LOADING...'
                  : proxyStatus !== 'online'
                    ? 'ENGINE: SERVER DOWN'
                    : proxyOn ? 'ENGINE: LIVE' : 'ENGINE: STOPPED'}
              </span>
            </div>

            {/* Three action buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={proxyOn || proxyStatus !== 'online'}
                onClick={() => handleToggleProxy()}
                style={{
                  background: proxyOn ? 'rgba(255,255,255,0.04)' : 'rgba(0,255,136,0.12)',
                  border: `1px solid ${proxyOn ? 'var(--border-subtle)' : 'var(--status-success)'}`,
                  color: proxyOn ? 'var(--text-tertiary)' : 'var(--status-success)',
                  fontSize: '0.72rem', padding: '6px 4px', fontWeight: 600,
                  opacity: proxyOn ? 0.4 : 1,
                }}
                title="Start — enable /v1 proxy routing"
              >
                ▶ Start
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!proxyOn || proxyStatus !== 'online'}
                onClick={() => handleToggleProxy()}
                style={{
                  background: !proxyOn ? 'rgba(255,255,255,0.04)' : 'rgba(255,34,85,0.12)',
                  border: `1px solid ${!proxyOn ? 'var(--border-subtle)' : 'var(--status-error)'}`,
                  color: !proxyOn ? 'var(--text-tertiary)' : 'var(--status-error)',
                  fontSize: '0.72rem', padding: '6px 4px', fontWeight: 600,
                  opacity: !proxyOn ? 0.4 : 1,
                }}
                title="Stop — disable /v1 proxy, returns 503"
              >
                ■ Stop
              </button>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                disabled={reloadingPool}
                onClick={handleReloadPool}
                style={{ fontSize: '0.72rem', padding: '6px 4px', fontWeight: 600 }}
                title="Reload keys from DB into rotation pool"
              >
                {reloadingPool ? <div className="spinner" style={{ width: 10, height: 10 }} /> : '↻ Reload'}
              </button>
            </div>

            {/* Pool stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { label: 'Accounts', val: accounts.length, color: 'var(--text-primary)' },
                { label: 'Pooled', val: poolStats?.pooledCount ?? 0, color: 'var(--status-success)' },
                { label: 'Available', val: proxyStatusStats?.available ?? poolStats?.poolReadyCount ?? 0, color: 'var(--accent-secondary)' },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ textAlign: 'center', padding: '8px 4px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color }}>{val}</div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            {!proxyOn && proxyStatus === 'online' && (
              <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(255,34,85,0.08)', border: '1px solid var(--status-error)', fontSize: '0.7rem', color: 'var(--status-error)', borderRadius: 4 }}>
                Stopped — all /v1 requests return 503 until you Start.
              </div>
            )}
          </div>

          {/* Endpoint Card — URL + key below engine controls */}
          <EndpointCard
            masterKey={masterKey}
            endpoint={endpoint}
            modelCache={modelCache}
            onRefreshModels={handleRefreshModels}
            refreshingModels={refreshingModels}
            onRotateKey={handleRotateMasterKey}
            rotatingKey={rotatingKey}
            models={models}
          />
        </aside>
      </div>

      {/* Modals */}
      {registering && (
        <RegisterKeyModal 
          keyHash={registering.hash}
          keyName={registering.name}
          onClose={() => setRegistering(null)}
          onConfirm={(hash, str) => {
            handleRegister(hash, str);
            setRegistering(null);
          }}
        />
      )}

      {deleting && (
        <DeleteKeyModal 
          keyHash={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={(hash) => {
            handleDeleteKey(hash);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}
