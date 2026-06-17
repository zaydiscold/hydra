import { memo } from 'react';
import { useTraffic } from '../hooks/useTraffic';
import AnimeText from '../components/AnimeText';
import ScrambleText from '../components/ScrambleText';
import {
  ActivityIcon,
  RefreshIcon,
  AlertIcon,
  DatabaseIcon,
  WalletIcon
} from '../components/Icons';

function formatUsd(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const amount = Number(value);
  if (amount === 0) return '$0.00';
  if (amount < 0.0001) return `$${amount.toFixed(7)}`;
  if (amount < 0.01) return `$${amount.toFixed(5)}`;
  return `$${amount.toFixed(3)}`;
}

function describeRoute(log) {
  const attempt = Number(log.attempt || 1);
  const rotated = attempt > 1;
  const label = rotated ? `try ${attempt} · rotated` : `try ${attempt}`;
  const descriptions = {
    served: 'OpenRouter served this request.',
    upstream_response: log.status === 404
      ? 'OpenRouter rejected the model or endpoint. Rotating credentials would not repair this request.'
      : 'OpenRouter returned a client-visible response. Hydra did not penalize the credential.',
    key_rate_limited: 'This credential hit a rate limit. Hydra cooled it and tried another eligible key.',
    ip_rate_limited: 'OpenRouter reported an IP-level rate limit. Hydra cooled the whole pool.',
    key_out_of_credits: 'This credential ran out of credits. Hydra cooled it and tried another eligible key.',
    key_rejected: 'OpenRouter rejected this credential. Hydra removed it from rotation.',
    upstream_5xx: 'OpenRouter returned a server error. Hydra tried another eligible key.',
    connect_timeout: 'The upstream connection timed out. Hydra tried another eligible key.',
    stream_timeout: 'The upstream response timed out. Hydra tried another eligible key.',
    network_error: 'The upstream request failed before a response. Hydra tried another eligible key.',
  };
  return {
    label,
    detail: descriptions[log.outcome] || 'Legacy log row without route-attempt telemetry.',
  };
}

// ⚡ Bolt: Extracted table row into memoized component to avoid re-rendering 100 unchanged rows on every background traffic poll.
const TrafficRow = memo(function TrafficRow({ log }) {
  const isErr = log.status >= 400;
  const shortHash = typeof log.keyHash === 'string' ? log.keyHash.slice(0, 8) : 'deleted';
  const routeName = log.key?.name || (log.keyHash ? 'Archived key' : 'Deleted key');
  const routeAlias = log.key?.account?.alias || (log.keyHash ? 'Archived account' : 'Deleted account');
  const at = new Date(log.createdAt);
  const stamp = at.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
  const route = describeRoute(log);
  const costPrefix = log.costSource === 'catalog_estimate' ? '~' : '';

  return (
    <tr>
      <td className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
        {stamp}
      </td>
      <td>
        <span
          className={`badge ${isErr ? 'badge-error' : 'badge-success'}`}
          title={route.detail}
        >
          {log.status}
        </span>
      </td>
      <td style={{ minWidth: 118, verticalAlign: 'middle' }} title={route.detail}>
        <div className="traffic-route-label mono">{route.label}</div>
        <div className={`traffic-route-outcome traffic-route-outcome--${isErr ? 'error' : 'ok'}`}>
          {log.outcome || 'legacy'}
        </div>
      </td>
      <td
        className="mono"
        style={{
          fontSize: '0.8rem',
          maxWidth: 220,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          verticalAlign: 'middle'
        }}
        title={log.model}
      >
        {log.model}
      </td>
      <td style={{ fontSize: '0.82rem', fontWeight: 600, verticalAlign: 'middle' }}>
        {routeAlias}
      </td>
      <td style={{ verticalAlign: 'middle' }}>
        <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{routeName}</div>
        <div
          className="mono"
          style={{
            fontSize: '0.68rem',
            color: 'var(--text-tertiary)',
            marginTop: 2,
            userSelect: 'text',
            cursor: 'text'
          }}
        >
          {shortHash}
        </div>
      </td>
      <td style={{ verticalAlign: 'middle' }}>
        {log.clientHint ? (
          <span className="badge badge-info" style={{ fontSize: '0.7rem', textTransform: 'lowercase' }}>
            {log.clientHint}
          </span>
        ) : (
          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>—</span>
        )}
      </td>
      <td
        className="mono"
        style={{
          fontSize: '0.8rem',
          textAlign: 'right',
          color: log.latencyMs > 5000 ? 'var(--status-warning)' : 'inherit',
          verticalAlign: 'middle'
        }}
      >
        {log.latencyMs}ms
      </td>
      <td
        className="mono"
        style={{
          fontSize: '0.8rem',
          textAlign: 'right',
          color: 'var(--text-tertiary)',
          verticalAlign: 'middle'
        }}
      >
        {(log.promptTokens !== null && log.completionTokens !== null) ? `${log.promptTokens}/${log.completionTokens}` : '—'}
      </td>
      <td
        className="mono"
        style={{
          minWidth: 132,
          fontSize: '0.72rem',
          textAlign: 'right',
          color: 'var(--text-secondary)',
          verticalAlign: 'middle'
        }}
        title={log.costSource === 'openrouter_usage'
          ? `OpenRouter reported ${formatUsd(log.totalCost)} total usage. Input and output splits use the cached catalog rate.`
          : log.costSource === 'catalog_estimate'
            ? 'Estimated from cached OpenRouter per-token model prices.'
            : 'Refresh the OpenRouter model catalog in Pool Manager to estimate pricing.'}
      >
        {log.inputCost !== null || log.outputCost !== null ? (
          <>
            <div>{costPrefix}{formatUsd(log.inputCost)} / {costPrefix}{formatUsd(log.outputCost)}</div>
            <div className="traffic-cost-total">{formatUsd(log.totalCost)} total</div>
          </>
        ) : '—'}
      </td>
    </tr>
  );
});

export default function Traffic({ addToast }) {
  const { data, loading, refreshing, fetchTraffic } = useTraffic({ addToast });

  if (loading && !data) {
    return (
      <div className="animate-fade-in">
        <div className="page-header">
          <div className="skeleton-shimmer" style={{ width: 300, height: 40, marginBottom: 8 }} />
        </div>
        <div className="stats-grid">
          {[1, 2, 3].map(i => <div key={i} className="stat-card skeleton-shimmer" style={{ height: 120, border: 'none' }} />)}
        </div>
      </div>
    );
  }

  const { logs = [], metrics = [], routing = {} } = data || {};

  // Aggregate metrics
  let totalRequests = 0;
  let errorRequests = 0;

  metrics.forEach(m => {
    totalRequests += m._count.id;
    if (m.status < 200 || m.status >= 300) {
      errorRequests += m._count.id;
    }
  });

  const errorRate = totalRequests > 0 ? ((errorRequests / totalRequests) * 100).toFixed(1) : 0;
  const visibleSpend = logs.reduce((sum, log) => sum + (Number(log.totalCost) || 0), 0);

  // Calculate RPM from logs (very rough estimate based on the last 100 requests)
  let rpm = 0;
  if (logs.length > 1) {
    const oldest = new Date(logs[logs.length - 1].createdAt).getTime();
    const newest = new Date(logs[0].createdAt).getTime();
    const minutesSpan = (newest - oldest) / 60000;
    if (minutesSpan > 0) {
      rpm = (logs.length / minutesSpan).toFixed(1);
    }
  }

  return (
    <div className="animate-fade-in traffic-page">
      {/* Header */}
      <div className="page-header page-header--panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div style={{ color: 'var(--accent-primary)', opacity: 0.9 }}>
            <ActivityIcon size={40} />
          </div>
          <div>
            <AnimeText as="h2" mode="chars" variant="scanline" delay={14} style={{ margin: 0 }}>Traffic Console</AnimeText>
            <p style={{ margin: 0, marginTop: 2, color: 'var(--text-secondary)' }}>Live proxy observability and routing logs</p>
          </div>
        </div>
        <div className="page-actions">
          {refreshing && (
            <div className="refresh-status animate-fade-in">
              <div className="spinner-sm" />
              <span>Syncing...</span>
            </div>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => fetchTraffic(true)} disabled={refreshing || loading}>
            <span className={refreshing ? 'spin-inline' : ''}><RefreshIcon size={14} /></span>
            {refreshing ? 'Polling' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        <div className="stat-card stat-card-highlight traffic-stat-card shine-sweep animate-spring stagger-delay-0">
          <div className="stat-card-header">
            <div className="stat-card-label">Est. Request Rate</div>
            <ActivityIcon className="stat-icon" />
          </div>
          <div className="stat-card-value success mono">
            <ScrambleText text={`${rpm} RPM`} />
          </div>
          <div className="stat-card-sub">based on recent buffer</div>
        </div>
        <div className="stat-card traffic-stat-card shine-sweep animate-spring stagger-delay-50">
          <div className="stat-card-header">
            <div className="stat-card-label">Total 24h Volume</div>
            <DatabaseIcon className="stat-icon" />
          </div>
          <div className="stat-card-value info mono">
            {totalRequests.toLocaleString()}
          </div>
          <div className="stat-card-sub">upstream attempts logged</div>
        </div>
        <div className="stat-card traffic-stat-card shine-sweep animate-spring stagger-delay-100">
          <div className="stat-card-header">
            <div className="stat-card-label">Global Error Rate</div>
            <AlertIcon className="stat-icon" />
          </div>
          <div className={`stat-card-value mono ${errorRate > 10 ? 'error' : errorRate > 2 ? 'warning' : 'success'}`}>
            {errorRate}%
          </div>
          <div className="stat-card-sub">non-200 responses</div>
        </div>
        <div className="stat-card traffic-stat-card shine-sweep animate-spring stagger-delay-150">
          <div className="stat-card-header">
            <div className="stat-card-label">Visible Spend</div>
            <WalletIcon className="stat-icon" />
          </div>
          <div className="stat-card-value accent mono">
            {formatUsd(visibleSpend)}
          </div>
          <div className="stat-card-sub">
            latest {logs.length} attempts · {routing.available ?? 0}/{routing.totalPooled ?? 0} keys ready
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="section-header" style={{ marginTop: 'var(--space-xl)' }}>
        <h3>Recent Proxy Logs</h3>
        <div className="section-count">{logs.length} events</div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {logs.length === 0 ? (
          <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
            <p style={{ color: 'var(--text-tertiary)' }}>No traffic recorded yet. Connect an app to the proxy endpoint to see live logs.</p>
          </div>
        ) : (
          <div
            className="table-container"
            style={{ border: 'none', boxShadow: 'none', background: 'transparent' }}
          >
            <table className="table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Status</th>
                  <th>Route</th>
                  <th>Model</th>
                  <th>Account</th>
                  <th>Key</th>
                  <th>Client</th>
                  <th style={{ textAlign: 'right' }}>Latency</th>
                  <th style={{ textAlign: 'right' }}>Tokens (in/out)</th>
                  <th style={{ textAlign: 'right' }}>Price (in/out)</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <TrafficRow key={log.id} log={log} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
