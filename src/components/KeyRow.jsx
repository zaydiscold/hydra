import React, { useState } from 'react';
import ScrambleText from './ScrambleText';
import { 
  KeyIcon, 
  AlertIcon, 
  EyeIcon, 
  CopyIcon 
} from './Icons';

function StatusDot({ pooled, hasKey }) {
  let color = 'var(--text-tertiary)';
  let shadow = 'none';
  if (pooled) {
    color = 'var(--status-success)';
    shadow = '0 0 8px var(--status-success)';
  } else if (!hasKey) {
    color = 'var(--status-warning)';
  }
  return (
    <span style={{
      width: 7, height: 7, borderRadius: '50%',
      background: color, boxShadow: shadow,
      flexShrink: 0, display: 'inline-block'
    }} />
  );
}

export default function KeyRow({ 
  keyData, 
  onToggle, 
  onRegister, 
  onDisable, 
  onDelete 
}) {
  const {
    hash, name, enabled, isPooled, hasKeyString, plaintextKey, isProvisioningKey,
    usage, limit, limitRemaining,
  } = keyData;

  const [showPlaintext, setShowPlaintext] = useState(false);

  const canPool = hasKeyString;
  
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '28px 1fr auto auto auto',
        alignItems: 'center',
        gap: 8,
        padding: '5px 12px',
        background: isPooled ? 'rgba(0,255,102,0.04)' : 'transparent',
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
        <code 
          style={{ 
            fontSize: '0.72rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', 
            wordBreak: 'break-all', display: 'block', maxWidth: '100%', 
            cursor: plaintextKey ? 'pointer' : 'default' 
          }} 
          onClick={() => plaintextKey && setShowPlaintext(!showPlaintext)}
        >
          {showPlaintext && plaintextKey ? (
            <span style={{ color: 'var(--accent-primary)' }}>{plaintextKey}</span>
          ) : (
            <ScrambleText text={hash ? hash.slice(0, 12) + '…' : '—'} duration={300} />
          )}
        </code>

        {/* Key limit bar */}
        {limit != null ? (() => {
          const consumed = limit - (limitRemaining ?? 0);
          const pct = Math.min(100, Math.round((consumed / limit) * 100));
          const barColor = pct >= 80 || limitRemaining === 0
            ? 'var(--status-error)'
            : pct >= 50
            ? 'var(--status-warning)'
            : 'var(--status-success)';
          return (
            <div style={{ marginTop: 4 }}>
              <div style={{ height: 3, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden', marginBottom: 2 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: barColor, transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: '0.65rem', color: barColor, fontFamily: 'var(--font-mono)' }}>
                {pct}% · ${(limitRemaining ?? 0).toFixed(2)} / ${limit.toFixed(2)}
              </span>
            </div>
          );
        })() : (
          <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 2, display: 'block' }}>∞ unlimited</span>
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
            onClick={() => onRegister && onRegister(hash, name)}
            style={{
              color: '#000',
              border: '1px solid var(--status-warning)',
              background: 'var(--status-warning)',
              gap: 4,
              fontSize: '0.72rem',
              fontWeight: 700,
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
              onClick={() => onRegister && onRegister(hash, name)}
              title="Replace key string"
              style={{ fontSize: '0.72rem', padding: '2px 8px', height: 24 }}
            >
              Replace
            </button>
          </div>
        )}
      </div>

      {/* Status + key actions */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <span
          style={{
            fontSize: '0.72rem',
            color: enabled ? 'var(--status-success)' : 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
          }}
          title={enabled ? 'Click to disable' : 'Click to enable'}
          onClick={() => onDisable && onDisable(hash, enabled)}
        >
          {enabled ? '● ON' : '○ OFF'}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onDelete && onDelete(hash)}
          title="Delete key"
          style={{ fontSize: '0.65rem', padding: '1px 5px', color: 'var(--status-error)', opacity: 0.6 }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
