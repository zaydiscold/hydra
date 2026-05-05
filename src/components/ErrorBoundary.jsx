import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[GLOBAL ERROR]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const isProd = !import.meta.env.DEV;
      const correlationId = isProd
        ? Math.random().toString(36).slice(2, 10).toUpperCase()
        : null;

      return (
        <div className="center-container" style={{ backdropFilter: 'blur(20px)', zIndex: 10000 }}>
          <div className="lock-card" style={{ border: '4px solid var(--status-error)', boxShadow: '12px 12px 0 var(--status-error)' }}>
            <div className="lock-card-icon" style={{ background: 'var(--status-error)', color: 'white' }}>CRITICAL ERR</div>
            <h2 style={{ color: 'var(--status-error)', marginTop: 'var(--space-md)' }}>SYSTEM COLLAPSE</h2>

            <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-lg)', fontSize: '0.9rem' }}>
              The application encountered a terminal exception. Your session state is unstable, but Hydra's locally stored encrypted data remains on disk.
            </p>

            <div className="error-banner" style={{ textAlign: 'left', marginBottom: 'var(--space-xl)', padding: '16px', maxHeight: '150px', overflowY: 'auto', background: 'rgba(255,0,0,0.1)', border: '1px solid var(--status-error)' }}>
              {isProd ? (
                <>
                  <strong style={{ display: 'block', color: 'var(--status-error)', marginBottom: '4px', fontSize: '0.75rem' }}>REF:</strong>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--status-error)' }}>
                    Correlation ID: {correlationId}
                  </div>
                </>
              ) : (
                <>
                  <strong style={{ display: 'block', color: 'var(--status-error)', marginBottom: '4px', fontSize: '0.75rem' }}>TRACE:</strong>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--status-error)' }}>
                    {this.state.error?.stack || this.state.error?.message || 'Unknown panic state'}
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button 
                className="btn btn-primary" 
                onClick={() => window.location.reload()}
                style={{ background: 'var(--status-error)', borderColor: 'var(--status-error)', width: '100%' }}
              >
                REBOOT SYSTEM (F5)
              </button>
              
              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => {
                    localStorage.removeItem('hydra_token');
                    window.location.href = '/';
                  }}
                  style={{ flex: 1, fontSize: '0.75rem' }}
                >
                  PURGE SESSION
                </button>
                <button 
                  className="btn btn-secondary" 
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
