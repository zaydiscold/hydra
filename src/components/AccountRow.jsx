import React, { useState } from 'react';
import KeyRow from './KeyRow';
import {
  UserIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SettingsIcon
} from './Icons';

function StatusDot({ active }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%',
      background: active ? 'var(--status-success)' : 'var(--text-tertiary)',
      boxShadow: active ? '0 0 8px var(--status-success)' : 'none',
      flexShrink: 0
    }} />
  );
}

export default function AccountRow({
  account,
  onToggleKey,
  onRegisterKey,
  onDisableKey,
  onDeleteKey,
  onAccountAction
}) {
  const [expanded, setExpanded] = useState(false);
  const { id, keys, poolStatus, modelGroup } = account;
  const email = account.email || '';
  const name = account.alias || account.name || email.split('@')[0] || 'Unnamed';

  const activeKeysCount = keys.filter(k => k.isPooled).length;
  const totalKeysCount = keys.length;
  const isPooled = poolStatus === 'pooled';

  return (
    <div style={{
      borderBottom: '1px solid var(--border-subtle)',
      background: expanded ? 'rgba(255,255,255,0.02)' : 'transparent'
    }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '40px 1.5fr 1fr 1fr 120px 80px',
          alignItems: 'center',
          padding: '12px 16px',
          cursor: 'pointer',
          transition: 'background 0.2s'
        }}
        onClick={() => setExpanded(!expanded)}
        className="hover-bg"
      >
        {/* Expand/Collapse */}
        <div style={{ color: 'var(--text-tertiary)' }}>
          {expanded ? <ChevronDownIcon size={18} /> : <ChevronRightIcon size={18} />}
        </div>

        {/* Account Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6,
            background: 'var(--bg-tertiary)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)'
          }}>
            <UserIcon size={16} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                {name || 'No Name'}
              </span>
              <StatusDot active={isPooled} />
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {email}
            </div>
          </div>
        </div>

        {/* Model Group */}
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          {modelGroup || 'default'}
        </div>

        {/* Keys Summary */}
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <span style={{ color: activeKeysCount > 0 ? 'var(--status-success)' : 'var(--text-tertiary)', fontWeight: 600 }}>
              {activeKeysCount}
            </span>
            <span style={{ color: 'var(--text-tertiary)' }}> / {totalKeysCount} pooled</span>
        </div>

        {/* Account Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
           <button
             type="button"
             className="btn btn-ghost btn-sm"
             onClick={() => onAccountAction(id, 'settings')}
             title="Account Settings"
           >
             <SettingsIcon size={14} />
           </button>
        </div>

        {/* Status Toggle */}
        <div style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
           <div
             style={{
               fontSize: '0.7rem',
               fontWeight: 700,
               color: isPooled ? 'var(--status-success)' : 'var(--text-tertiary)',
               padding: '2px 6px',
               borderRadius: 4,
               border: `1px solid ${isPooled ? 'var(--status-success)' : 'var(--border-subtle)'}`,
               display: 'inline-block'
             }}
           >
             {(poolStatus === 'pooled' ? 'POOLED' : 'NOT POOLED')}
           </div>
        </div>
      </div>

      {/* Expanded Key List */}
      {expanded && (
        <div style={{
          padding: '4px 0 12px 40px',
          background: 'rgba(0,0,0,0.1)',
          borderTop: '1px solid var(--border-subtle)'
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '28px 1fr auto auto auto',
            gap: 8,
            padding: '8px 12px',
            fontSize: '0.7rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-tertiary)',
            fontWeight: 700
          }}>
            <div>Pool</div>
            <div>Key Identifier</div>
            <div style={{ textAlign: 'right' }}>Usage</div>
            <div style={{ textAlign: 'right' }}>Key String</div>
            <div style={{ textAlign: 'right' }}>Status</div>
          </div>

          {keys.length === 0 ? (
            <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
              No keys found for this account.
            </div>
          ) : (
            keys.map(key => (
              <KeyRow
                key={key.hash}
                keyData={key}
                onToggle={onToggleKey}
                onRegister={onRegisterKey}
                onDisable={onDisableKey}
                onDelete={onDeleteKey}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
