import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import AuthBadge from './AuthBadge';
import { timeAgo } from '../utils/time';
import { formatCurrency, getBalanceStatus } from '../utils/format';
import { getAccountBalanceDisplay } from '../utils/accountBalance';
import { getCardHealth, CARD_HEALTH_COLORS } from '../utils/cardHealth';
import { canProvisionWithSession, isSessionProbePending } from '../utils/accountSession';

function areAccountCardPropsEqual(prevProps, nextProps) {
  if (prevProps.account !== nextProps.account) return false;
  if (prevProps.index !== nextProps.index || prevProps.compact !== nextProps.compact) return false;
  if (prevProps.onSelect !== nextProps.onSelect || prevProps.onProvision !== nextProps.onProvision || prevProps.onResumeAuth !== nextProps.onResumeAuth) return false;

  const accountId = prevProps.account.id;
  if (prevProps.provisioningIds?.has(accountId) !== nextProps.provisioningIds?.has(accountId)) return false;
  if (prevProps.liveStatuses?.[accountId] !== nextProps.liveStatuses?.[accountId]) return false;
  if (prevProps.actionSessionTruth?.[accountId] !== nextProps.actionSessionTruth?.[accountId]) return false;

  for (const key of prevProps.account.keys?.list || []) {
    if (prevProps.cooldownMap?.[key.hash] !== nextProps.cooldownMap?.[key.hash]) return false;
  }

  return true;
}

const AccountCard = memo(function AccountCard({
  account,
  index,
  onSelect,
  onProvision,
  provisioningIds,
  liveStatuses,
  actionSessionTruth,
  cooldownMap = {},
  onResumeAuth,
  compact = false,
}) {
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    if (!cardRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '50px' }
    );
    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  const handleClick = useCallback(() => {
    if (account.pendingVerification) {
      onResumeAuth?.();
      return;
    }
    onSelect(account.id);
  }, [account.id, account.pendingVerification, onResumeAuth, onSelect]);
  const handleProvision = useCallback((e) => {
    e.stopPropagation();
    onProvision(account.id);
  }, [onProvision, account.id]);

  const sessionStatus = (liveStatuses && liveStatuses[account.id]) || account.sessionStatus || 'none';
  const provisionTruthStatus = (actionSessionTruth && actionSessionTruth[account.id]) || 'unknown';
  const pendingVerification = !!account.pendingVerification;

  const balanceDisplay = getAccountBalanceDisplay(account);
  const displayCredits = balanceDisplay.credits || account.credits;
  const balStatus = account.status === 'error' && !balanceDisplay.hasValue
    ? 'error'
    : getBalanceStatus(displayCredits);
  const pct = displayCredits?.total > 0
    ? Math.max(0, (displayCredits.remaining / displayCredits.total) * 100)
    : 0;

  const provisioning = provisioningIds.has(account.id);
  const needsKey = !account.hasManagementKey;
  const canProvisionNow =
    !!account.hasCredentials &&
    canProvisionWithSession(provisionTruthStatus) &&
    !isSessionProbePending(provisionTruthStatus);

  // Unified health: drives both the status dot and the card border.
  // healthy = session active + mgmt key | partial = mgmt key, no session | dead = no mgmt key
  const hasErrorState = account.status === 'error' || account.sessionDecryptFailed;
  const health = pendingVerification ? 'partial' : getCardHealth(sessionStatus, !!account.hasManagementKey, hasErrorState);
  const { dot: dotColor, border: borderColor, glow: dotGlow } = CARD_HEALTH_COLORS[health];

  // MGMT KEY badge: success = has key, neutral = no key
  const mgmtBadgeClass = account.hasManagementKey ? 'badge-success' : 'badge-neutral';
  const mgmtBadgeLabel = account.hasManagementKey ? 'CONTROL' : 'NO CONTROL';
  const apiKeyCount = account.keys?.active || 0;

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const lockedKeys = (account.keys?.list || []).filter(
    k => cooldownMap[k.hash] && cooldownMap[k.hash] > nowMs
  );
  const lockedMinutes = lockedKeys.length > 0
    ? Math.ceil((Math.max(...lockedKeys.map(k => cooldownMap[k.hash])) - nowMs) / 60000)
    : 0;

  return (
    <div
      ref={cardRef}
      data-proximity-target
      className={`card card-clickable account-card ${compact ? 'account-card--compact' : ''} ${isVisible ? 'animate-spring' : ''}`}
      style={{
        animationDelay: `${Math.min(index * 30, 500)}ms`,
        borderColor,
      }}
      onClick={handleClick}
    >
      <div className="account-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {/* Status dot — same color as border via unified cardHealth */}
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: dotColor,
            boxShadow: dotGlow !== 'none' ? dotGlow : undefined,
          }} />
          <span className="account-card-alias" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.alias}</span>
        </div>
        {account.lastLoginAt && sessionStatus !== 'none' && sessionStatus !== 'expired' && (
          <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', opacity: 0.6, whiteSpace: 'nowrap', flexShrink: 0 }}>login {timeAgo(account.lastLoginAt)}</span>
        )}
      </div>

      {account.email && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {account.email}
        </div>
      )}

      <div className="account-card-balance">
        <div className="account-card-balance-label">Remaining Balance</div>
        <div className={`account-card-balance-value mono ${balStatus === 'low' ? 'low' : ''} ${balStatus === 'depleted' ? 'depleted' : ''}`}>
          {balanceDisplay.label}
        </div>
        {balanceDisplay.detail && (
          <div className="account-card-balance-detail mono">{balanceDisplay.detail}</div>
        )}
      </div>

      <div className="balance-bar">
        <div
          className={`balance-bar-fill ${balStatus === 'low' ? 'low' : ''} ${balStatus === 'depleted' ? 'depleted' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="account-card-footer">
        <div className="account-card-plane-row">
          <span className={`account-card-plane ${account.hasManagementKey ? 'account-card-plane--ready' : 'account-card-plane--missing'}`}>
            <span className="account-card-plane-label">CONTROL</span>
            <strong>{account.hasManagementKey ? 'READY' : 'MISSING'}</strong>
          </span>
          <span className="account-card-plane">
            <span className="account-card-plane-label">API</span>
            <strong>{apiKeyCount}</strong>
          </span>
        </div>
        <div className="account-card-meta account-card-meta-row mono">
          {lockedMinutes > 0 && (
            <span style={{ color: 'var(--status-warning)' }}>[LOCKED {lockedMinutes}m]</span>
          )}
          <span>[USED] <strong>{formatCurrency(account.credits?.used)}</strong></span>
        </div>
        {!compact && (
          <div className="account-card-auth-wrap">
            <AuthBadge
              method={account.authMethod}
              hasManagementKey={!!account.hasManagementKey}
              hasCredentials={!!account.hasCredentials}
              sessionActive={sessionStatus === 'active' || sessionStatus === 'expiring'}
            />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {canProvisionNow && (
                <button
                  type="button"
                  className={`badge ${needsKey ? 'badge-warning' : 'badge-neutral'}`}
                  title={provisioning ? 'Provisioning…' : (needsKey ? 'Provision Management Key' : 'Rotate Management Key')}
                  disabled={provisioning}
                  onClick={handleProvision}
                  style={{
                    cursor: provisioning ? 'not-allowed' : 'pointer',
                    opacity: provisioning ? 0.6 : 1,
                    background: needsKey ? 'color-mix(in srgb, var(--status-warning) 10%, transparent)' : 'none',
                    padding: '4px 10px',
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-mono)',
                    borderStyle: needsKey ? 'solid' : 'dashed',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    color: needsKey ? 'var(--status-warning)' : 'var(--text-secondary)',
                    gap: 6,
                    margin: 0,
                    fontSize: '0.72rem',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {provisioning ? (
                    <div className="spinner" style={{ width: 10, height: 10, borderWidth: '2px' }} />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {!needsKey && <span style={{ fontSize: '1rem', marginTop: '-1px' }}>↺</span>}
                      <span>{needsKey ? 'PROVISION' : 'ROTATE'}</span>
                    </div>
                  )}
                </button>
              )}
              <span className={`badge ${mgmtBadgeClass}`} style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                {mgmtBadgeLabel}
              </span>
            </div>
          </div>
        )}
      </div>

      {pendingVerification && (
        <div className="account-card-pending">
          <span>OTP SIGN-IN PENDING</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(event) => {
              event.stopPropagation();
              onResumeAuth?.();
            }}
          >
            Resume
          </button>
        </div>
      )}

      {account.status === 'error' && account.error && (
        <div style={{ marginTop: 6, fontSize: '0.68rem', color: 'var(--status-error)', fontFamily: 'var(--font-mono)', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={account.error}>
          ✕ {account.error}
        </div>
      )}
    </div>
  );
}, areAccountCardPropsEqual);

export default AccountCard;
