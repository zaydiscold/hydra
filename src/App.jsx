import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import './index.css';
import * as api from './api';
import DevBackendHint from './components/DevBackendHint';
import Dashboard from './pages/Dashboard.jsx';
import AccountDetail from './pages/AccountDetail.jsx';
import KeyManager from './pages/KeyManager.jsx';
import CodeRedemption from './pages/CodeRedemption.jsx';
import Generator from './pages/Generator.jsx';
import Settings from './pages/Settings.jsx';
import PoolManager from './pages/PoolManager.jsx';
import Traffic from './pages/Traffic.jsx';
import BulkAuthWizard from './pages/BulkAuthWizard.jsx';
import ErrorBoundary from './components/ErrorBoundary';
import { 
  DashboardIcon, 
  VaultIcon, 
  TicketIcon, 
  GeneratorIcon, 
  SettingsIcon,
  LockIcon,
  PowerIcon,
  NetworkIcon,
  ActivityIcon,
  BulkAuthIcon
} from './components/Icons';

function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="toast-container">
      {toasts.map((t) => {
        const durationMs = t.durationMs ?? (t.type === 'error' ? 10000 : 4000);
        const tag =
          t.type === 'success'
            ? '[SUCCESS] '
            : t.type === 'error'
              ? '[ERROR] '
              : t.type === 'info'
                ? '[INFO] '
                : '[WARN] ';
        return (
          <div key={t.id} className={`toast toast-${t.type}`} onClick={() => onDismiss(t.id)}>
            <div className={`toast-inner toast-inner-${t.type}`}>
              <span className="toast-tag">{tag}</span>
              <span className="toast-message">{t.message}</span>
            </div>
            <div className="toast-progress" style={{ animationDuration: `${durationMs}ms` }} />
          </div>
        );
      })}
    </div>
  );
}

function GlobalLoadingBar() {
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const handleLoading = (e) => setLoading(e.detail.active);
    window.addEventListener('hydra-loading', handleLoading);
    return () => window.removeEventListener('hydra-loading', handleLoading);
  }, []);

  if (!loading) return null;
  return <div className="global-nprogress" />;
}

// ─── Auth Screen ─────────────────────────────────────────────────────────────
function AuthScreen({ mode, onSuccess, onRestartRequired }) {
  const isSetup = mode === 'setup';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── Nuclear Reset Logic ──
  const [nukeProgress, setNukeProgress] = useState(0); // 0 to 100
  const [isNuking, setIsNuking] = useState(false);
  const timerRef = useRef(null);

  const handleFinalNuke = useCallback(async () => {
    setIsNuking(false);
    try {
      const res = await api.nukeApp();
      const payload = res?.data ?? res ?? {};
      api.clearToken();
      if (payload?.restartRequired) {
        if (onRestartRequired) {
          onRestartRequired(payload?.message);
          return;
        }
        setError(payload?.message || 'System wiped. Restart Hydra once to regenerate local secrets, then refresh this page.');
        return;
      }
      window.location.reload(); // Restart from scratch
    } catch (err) {
      setError('Nuclear wipe failed: ' + err.message);
    }
  }, [onRestartRequired]);

  useEffect(() => {
    if (isNuking) {
      const start = Date.now();
      const duration = 10000; // 10 seconds
      
      const update = () => {
        const now = Date.now();
        const nextProgress = Math.min(100, ((now - start) / duration) * 100);
        setNukeProgress(nextProgress);
        
        if (nextProgress < 100 && isNuking) {
          timerRef.current = requestAnimationFrame(update);
        } else if (nextProgress >= 100) {
          handleFinalNuke();
        }
      };
      
      timerRef.current = requestAnimationFrame(update);
    } else if (!isNuking) {
      cancelAnimationFrame(timerRef.current);
      setNukeProgress(0);
    }
    
    return () => cancelAnimationFrame(timerRef.current);
  }, [handleFinalNuke, isNuking]);

  const handleNukeStart = () => setIsNuking(true);
  const handleNukeEnd = () => setIsNuking(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    
    // Custom Validation (Replaces browser "Fill this form" bubbles)
    if (!password) {
      setError(isSetup ? '[REQUIRED] Choose a password' : '[REQUIRED] Enter password');
      return;
    }
    if (isSetup && !confirm) {
      setError('[REQUIRED] Confirm your password');
      return;
    }
    if (isSetup && password !== confirm) {
      setError('[ERROR] Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = isSetup ? await api.setupPassword(password) : await api.login(password);
      // API wraps response: { success, data: { token }, timestamp }
      const token = res?.data?.token || res?.token;
      if (!token) throw new Error('No token received from server');
      api.saveToken(token);
      onSuccess();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="lock-screen">
      <div className="lock-bg-orbs">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
      </div>
      <div className="lock-card animate-spring" style={{ maxWidth: '600px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-xs)' }}>
          <div className="lock-card-icon" style={{ margin: 0 }}>HYDRA</div>
          <h2 style={{ margin: 0, whiteSpace: 'nowrap' }}>{isSetup ? 'Welcome to Hydra' : 'Unlock Hydra'}</h2>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
          <div className="vault-indicator" style={{ margin: 0 }}>
            <div className="vault-dot" />
            <span>SECURE VAULT</span>
          </div>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', fontWeight: 600 }}>
            OPENROUTER API & ACCOUNT MANAGER
          </div>
        </div>

        <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-xl)', lineHeight: 1.5, textAlign: 'center' }}>
          {isSetup
            ? 'Create a local password to protect your account data. This only lives on your machine.'
            : 'Enter your password to access your OpenRouter accounts.'}
        </p>

        <form onSubmit={handleSubmit} noValidate>


          <div className="form-group" style={{ position: 'relative' }}>
            <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              {isSetup ? 'Create Password' : 'Password'}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={show ? 'text' : 'password'}
                className="form-input"
                autoFocus
                placeholder={isSetup ? 'Choose a password' : 'Enter your password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="input-reveal-btn"
                onClick={() => setShow(!show)}
                tabIndex={-1}
              >
                {show ? 'HIDE' : 'SHOW'}
              </button>
            </div>
          </div>

          {isSetup && (
            <div className="form-group">
              <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                Confirm Password
              </label>
              <input
                type={show ? 'text' : 'password'}
                className="form-input"
                placeholder="Confirm your password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          )}

          {error && <p className="form-error" style={{ marginBottom: 'var(--space-md)' }}>{error}</p>}

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading
              ? <><div className="spinner-sm" /> {isSetup ? 'Setting up...' : 'Unlocking...'}</>
              : isSetup ? 'Create Password & Enter' : 'Unlock'
            }
          </button>
        </form>

        {!isSetup && (
          <div style={{ marginTop: 'var(--space-md)', textAlign: 'center' }}>
            <button 
              className="btn btn-ghost" 
              style={{ fontSize: '0.75rem', opacity: 0.6 }}
              onClick={() => setError('Fresh installs with no local accounts will switch to setup automatically. Nuclear Reset only wipes the local vault.')}
            >
              First time install?
            </button>
          </div>
        )}

      <div style={{ marginTop: 'var(--space-md)', fontSize: '0.75rem', color: 'var(--text-tertiary)', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <span style={{ color: 'var(--status-success)' }}>●</span> Local-only Encryption Active
      </div>

      <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 'var(--space-xl)', paddingTop: 'var(--space-md)' }}>
         {!isSetup && (
           <div style={{ textAlign: 'center' }}>
             <button 
               className={`nuke-btn ${isNuking ? 'nuke-active' : ''}`}
               onMouseDown={handleNukeStart}
               onMouseUp={handleNukeEnd}
               onMouseLeave={handleNukeEnd}
               onTouchStart={handleNukeStart}
               onTouchEnd={handleNukeEnd}
             >
               <div className="nuke-progress-bar" style={{ width: `${nukeProgress}%` }} />
               <span style={{ position: 'relative', zIndex: 1, pointerEvents: 'none' }}>
                 {isNuking ? `ARMING... ${Math.ceil((100 - nukeProgress) / 10)}s` : '☢ NUCLEAR RESET'}
               </span>
             </button>
             <p className="nuke-warning-text">HOLD FOR 10 SECONDS TO WIPE SYSTEM</p>
           </div>
         )}
      </div>

      {isNuking && <div className="nuke-overlay" />}
    </div>
  </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon size={18} />, path: '/dashboard' },
  { id: 'bulk-auth', label: 'Bulk OTP', icon: <BulkAuthIcon size={18} />, path: '/bulk-auth' },
  { id: 'keys', label: 'Vault', icon: <VaultIcon size={18} />, path: '/keys' },
  { id: 'pool', label: 'Pool Manager', icon: <NetworkIcon size={18} />, path: '/pool' },
  { id: 'codes', label: 'Redeem', icon: <TicketIcon size={18} />, path: '/codes' },
  { id: 'generator', label: 'Generator', icon: <GeneratorIcon size={18} />, path: '/generator' },
  { id: 'traffic', label: 'Traffic', icon: <ActivityIcon size={18} />, path: '/traffic' },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={18} />, path: '/settings' }
];

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [authState, setAuthState] = useState('loading'); // 'loading' | 'setup' | 'login' | 'app' | 'offline' | 'restart'
  const [authError, setAuthError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const recentToastsRef = useRef(new Map());
  const navigate = useNavigate();
  const location = useLocation();

  const addToast = useCallback((message, type = 'info', options = {}) => {
    const durationMs = options.durationMs ?? (type === 'error' ? 10000 : 4000);
    const toastKey = `${type}:${message}`;
    const now = Date.now();
    const lastShownAt = recentToastsRef.current.get(toastKey) ?? 0;

    if (now - lastShownAt < 1500) return;

    recentToastsRef.current.set(toastKey, now);
    setTimeout(() => {
      if (recentToastsRef.current.get(toastKey) === now) {
        recentToastsRef.current.delete(toastKey);
      }
    }, 2000);

    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, message, type, durationMs }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), durationMs);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const storedToken = localStorage.getItem('hydra_token');
      const res = await api.getAuthStatus();
      const payload = res?.data ?? res ?? {};
      // Server wraps response: { success, data: { setup, authenticated }, timestamp }
      const { setup, authenticated, error, needsRestart, bootstrapRequired } = payload || {};

      if (storedToken && !authenticated) {
        api.clearToken();
      }

      if (needsRestart) {
        setAuthError('Hydra requires a restart to regenerate local secrets after a reset.');
        setAuthState('restart');
        return;
      }

      if (error) {
        setAuthError('Hydra backend is unavailable or storage is unreadable. Please restart the server.');
        setAuthState('offline');
        return;
      }

      if (authenticated) {
        setAuthError(null);
        setAuthState('app');
      } else if (bootstrapRequired) {
        setAuthError(null);
        setAuthState('setup');
      } else if (setup) {
        // Account exists — show login
        setAuthError(null);
        setAuthState('login');
      } else {
        // No account yet — show first-time setup
        setAuthError(null);
        setAuthState('setup');
      }
    } catch (err) {
      console.warn('Auth check failed:', err.message);
      setAuthError(
        import.meta.env.DEV
          ? 'Hydra backend is offline. From the project folder run npm run dev (starts API + UI), then refresh this page.'
          : 'Hydra backend is offline. Start the local server and refresh this page.',
      );
      setAuthState('offline');
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleAuthSuccess = useCallback(() => setAuthState('app'), []);

  const handleRestartRequired = useCallback((message) => {
    if (message) setAuthError(message);
    setAuthState('restart');
  }, []);

  const handleLogout = useCallback(async () => {
    try { await api.logout(); } catch { /* fine */ }
    api.clearToken();
    setAuthState('login');
    navigate('/dashboard');
  }, [navigate]);

  const handleShutdown = useCallback(async () => {
    if (!window.confirm('Shut down the Hydra background server?')) return;
    try { await api.shutdownServer(); } catch { /* ok */ }
    setAuthState('shutdown');
  }, []);

  const navigateToAccount = useCallback((accountId) => {
    navigate(`/account/${accountId}`);
  }, [navigate]);

  const navigateBack = useCallback(() => navigate('/dashboard'), [navigate]);

  // Loading
  if (authState === 'loading') {
    return (
      <div className="center-container">
        <h1 className="hydra-logo-text mb-xl glow-text">HYDRA</h1>
        <div className="spinner spinner-lg mb-md"></div>
        <p className="loading-text" style={{ letterSpacing: '8px' }}>INITIALIZING</p>
      </div>
    );
  }

  // Shutdown
  if (authState === 'shutdown') {
    return (
      <div className="center-container">
        <h1 className="hydra-logo-text mb-xl glow-text" style={{ color: 'var(--status-error)' }}>HYDRA</h1>
        <p className="loading-text" style={{ color: 'var(--text-secondary)' }}>SERVER OFFLINE</p>
        <p style={{ marginTop: '1rem', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>You may now close this tab safely.</p>
      </div>
    );
  }

  // Restart required
  if (authState === 'restart') {
    return (
      <div className="center-container">
        <h1 className="hydra-logo-text mb-xl glow-text" style={{ color: 'var(--status-warning)' }}>HYDRA</h1>
        <p className="loading-text" style={{ color: 'var(--text-secondary)' }}>RESTART REQUIRED</p>
        <p style={{ marginTop: '1rem', color: 'var(--text-tertiary)', fontSize: '0.85rem', maxWidth: 520, textAlign: 'center' }}>
          {authError || 'Restart the Hydra server once to regenerate local secrets, then refresh this page.'}
        </p>
      </div>
    );
  }

  // Offline / backend unavailable
  if (authState === 'offline') {
    return (
      <div className="center-container">
        <h1 className="hydra-logo-text mb-xl glow-text" style={{ color: 'var(--status-error)' }}>HYDRA</h1>
        <p className="loading-text" style={{ color: 'var(--text-secondary)' }}>SERVER OFFLINE</p>
        <div style={{ marginTop: '1rem', color: 'var(--text-tertiary)', fontSize: '0.85rem', maxWidth: 520, textAlign: 'center' }}>
          <DevBackendHint
            message={authError || 'Start the local Hydra server to continue.'}
            copyCommand={import.meta.env.DEV ? api.HYDRA_DEV_START_COMMAND : ''}
          />
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <GlobalLoadingBar />
      {/* Brutalist Space Background Assets (Now global) */}
      <div className="starfield" />
      <div className="nebula-glow" />
      <div className="meteor-container">
        <div className="meteor" />
        <div className="meteor" />
        <div className="meteor" />
        <div className="meteor" />
      </div>
      <div className="planet planet-1" />
      <div className="planet planet-2" />

      {authState === 'setup' || authState === 'login' ? (
        <>
          <AuthScreen mode={authState} onSuccess={handleAuthSuccess} onRestartRequired={handleRestartRequired} />
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </>
      ) : (
        <div className={`app-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
          <aside className={`sidebar${sidebarCollapsed ? ' sidebar--collapsed' : ''}`}>
            <div className="sidebar-logo">
              {/* Abstract geometric logo mark */}
              <div className="sidebar-logo-icon">
                <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
                  <polygon points="20,4 36,14 36,26 20,36 4,26 4,14" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.9"/>
                  <polygon points="20,10 30,16 30,24 20,30 10,24 10,16" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.5"/>
                  <circle cx="20" cy="20" r="4" fill="currentColor" opacity="0.8"/>
                  <line x1="20" y1="4" x2="20" y2="10" stroke="currentColor" strokeWidth="1.5" opacity="0.6"/>
                  <line x1="20" y1="30" x2="20" y2="36" stroke="currentColor" strokeWidth="1.5" opacity="0.6"/>
                  <line x1="4" y1="14" x2="10" y2="16" stroke="currentColor" strokeWidth="1.5" opacity="0.6"/>
                  <line x1="36" y1="14" x2="30" y2="16" stroke="currentColor" strokeWidth="1.5" opacity="0.6"/>
                  <line x1="4" y1="26" x2="10" y2="24" stroke="currentColor" strokeWidth="1.5" opacity="0.6"/>
                  <line x1="36" y1="26" x2="30" y2="24" stroke="currentColor" strokeWidth="1.5" opacity="0.6"/>
                </svg>
              </div>
              {!sidebarCollapsed && (
                <div>
                  <h1>Hydra</h1>
                  <span className="sidebar-version">openrouter manager</span>
                </div>
              )}
            </div>

            <nav className="sidebar-nav">
              {navItems.map((item) => {
                const isActive = item.id === 'dashboard'
                  ? (location.pathname === '/' || location.pathname.startsWith('/dashboard'))
                  : location.pathname.startsWith(item.path);
                return (
                  <button
                    key={item.id}
                    className={`nav-link ${isActive ? 'active' : ''}`}
                    onClick={() => navigate(item.path)}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    {!sidebarCollapsed && <span>{item.label}</span>}
                  </button>
                );
              })}
            </nav>

            <div className="sidebar-bottom">
              <button
                className="nav-link"
                style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', opacity: 0.6 }}
                onClick={() => setSidebarCollapsed(v => !v)}
                title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <span className="nav-icon">{sidebarCollapsed ? '→' : '←'}</span>
                {!sidebarCollapsed && <span>Collapse</span>}
              </button>
              <button className="nav-link nav-link-lock" onClick={handleLogout} title="Lock">
                <span className="nav-icon"><LockIcon size={18} /></span>
                {!sidebarCollapsed && <span>Lock</span>}
              </button>
              <button className="nav-link" style={{ marginTop: '4px', color: 'var(--status-error)' }} onClick={handleShutdown} title="Shutdown">
                <span className="nav-icon"><PowerIcon size={18} /></span>
                {!sidebarCollapsed && <span>Shutdown</span>}
              </button>
            </div>
          </aside>

          <main className={`main-content${sidebarCollapsed ? ' main-content--expanded' : ''}`}>
            <div key={location.pathname} className="animate-slide-up">
              <Routes>
                <Route path="/" element={<Dashboard onSelectAccount={navigateToAccount} addToast={addToast} />} />
                <Route path="/dashboard" element={<Dashboard onSelectAccount={navigateToAccount} addToast={addToast} />} />
                <Route path="/bulk-auth" element={<BulkAuthWizard addToast={addToast} />} />
                <Route path="/account/:accountId" element={
                  <AccountDetail onBack={navigateBack} addToast={addToast} />
                } />
                <Route path="/keys" element={<KeyManager addToast={addToast} />} />
                <Route path="/pool" element={<PoolManager addToast={addToast} />} />
                <Route path="/traffic" element={<Traffic addToast={addToast} />} />
                <Route path="/codes" element={<CodeRedemption addToast={addToast} />} />
                <Route path="/generator" element={<Generator addToast={addToast} />} />
                <Route path="/settings" element={<Settings addToast={addToast} onLogout={handleLogout} />} />
                {/* Catch all to redirect to dashboard */}
                <Route path="*" element={<Dashboard onSelectAccount={navigateToAccount} addToast={addToast} />} />
              </Routes>
            </div>
          </main>

          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
      )}
    </ErrorBoundary>
  );
}
