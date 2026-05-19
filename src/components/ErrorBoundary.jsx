import React from 'react';
import { isElectron, native, tryNative } from '../lib/native';

// Generate a short correlation ID for error tracking without exposing internals
let _correlationCounter = 0;
function nextCorrelationId() {
  _correlationCounter++;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}-${_correlationCounter}`;
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, correlationId: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, correlationId: nextCorrelationId() };
  }

  componentDidCatch(error, errorInfo) {
    // Always log the full stack internally for debugging
    console.error('[GLOBAL ERROR]', error, errorInfo);
  }

  minimizeWindow() {
    void tryNative(native.minimizeWindow);
  }

  closeWindow() {
    void tryNative(native.closeWindow);
  }

  /** Return a safe, production-appropriate error message with a correlation ID. */
  getSafeErrorDisplay() {
    const cid = this.state.correlationId;
    const message = this.state.error?.message || 'Unknown error';

    // Check if we're in development (Vite dev mode or Electron dev).
    // Vite replaces import.meta.env.* at build time; in production
    // builds DEV is `false` and stack traces are sanitized below.
    // (Avoid bare `process.env` here — it's not a browser global and
    // would trip ESLint + the bundled output references won't resolve.)
    const isDev =
      (typeof window !== 'undefined' && window.location?.hostname === 'localhost') ||
      (typeof import.meta !== 'undefined' && import.meta.env?.DEV === true);

    if (isDev) {
      // Dev: show full stack trace for debugging
      return {
        title: 'SYSTEM COLLAPSE',
        details: this.state.error?.stack || message,
        showTrace: true,
      };
    }

    // Production: sanitize — show correlation ID + human-readable message only
    return {
      title: 'Unexpected Error',
      details: `Error ID: ${cid}\n${message}\n\nHydra encountered an unexpected error. Your locally stored data remains safe on disk.\nPlease try restarting the application. If the problem persists, include the Error ID above when reporting.`,
      showTrace: false,
    };
  }

  render() {
    if (this.state.hasError) {
      const display = this.getSafeErrorDisplay();
      return (
        <div className="center-container" style={{ backdropFilter: 'blur(20px)', zIndex: 10000 }}>
          {isElectron() && (
            <div className="error-window-controls" aria-label="Window controls">
              <button type="button" onClick={() => this.minimizeWindow()}>Minimize</button>
              <button type="button" onClick={() => this.closeWindow()}>Close</button>
            </div>
          )}
          <div className="lock-card" style={{ border: '4px solid var(--status-error)', boxShadow: '12px 12px 0 var(--status-error)' }}>
            <div className="lock-card-icon" style={{ background: 'var(--status-error)', color: 'white' }}>CRITICAL ERR</div>
            <h2 style={{ color: 'var(--status-error)', marginTop: 'var(--space-md)' }}>{display.title}</h2>

            <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-lg)', fontSize: '0.9rem' }}>
              The application encountered a terminal exception. Your session state is unstable, but Hydra's locally stored encrypted data remains on disk.
            </p>

            <div className="error-banner" style={{ textAlign: 'left', marginBottom: 'var(--space-xl)', padding: '16px', maxHeight: '150px', overflowY: 'auto', background: 'rgba(255,0,0,0.1)', border: '1px solid var(--status-error)' }}>
              <strong style={{ display: 'block', color: 'var(--status-error)', marginBottom: '4px', fontSize: '0.75rem' }}>{display.showTrace ? 'TRACE:' : 'DETAILS:'}</strong>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--status-error)', whiteSpace: 'pre-wrap' }}>
                {display.details}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button type="button" className="btn btn-primary"
                onClick={() => window.location.reload()}
                style={{ background: 'var(--status-error)', borderColor: 'var(--status-error)', width: '100%' }}
              >
                REBOOT SYSTEM (F5)
              </button>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="button" className="btn btn-secondary"
                  onClick={() => {
                    localStorage.removeItem('hydra_token');
                    window.location.href = '/';
                  }}
                  style={{ flex: 1, fontSize: '0.75rem' }}
                >
                  PURGE SESSION
                </button>
                <button type="button" className="btn btn-secondary"
                  onClick={() => window.location.href = '/'}
                  style={{ flex: 1, fontSize: '0.75rem' }}
                >
                  RETURN HOME
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
