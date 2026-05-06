import { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import './index.css';
import * as api from './api';
import { logger } from './lib/client-logger.js';
import DevBackendHint from './components/DevBackendHint';
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
  BulkAuthIcon,
  InfoIcon
} from './components/Icons';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const AccountDetail = lazy(() => import('./pages/AccountDetail.jsx'));
const Vault = lazy(() => import('./pages/Vault.jsx'));
const CodeRedemption = lazy(() => import('./pages/CodeRedemption.jsx'));
const Generator = lazy(() => import('./pages/Generator.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Diagnostics = lazy(() => import('./pages/Diagnostics.jsx'));
const PoolManager = lazy(() => import('./pages/PoolManager.jsx'));
const Traffic = lazy(() => import('./pages/Traffic.jsx'));
const BulkAuthWizard = lazy(() => import('./pages/BulkAuthWizard.jsx'));

function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="toast-container" aria-live="polite" role="status">
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

function HydraLoadFrame({ tone = 'normal', title = 'HYDRA', status = 'INITIALIZING', detail, compact = false }) {
  const letters = 'HYDRA PROXY 01011'.replaceAll(' ', '').split('');
  const glyphs = Array.from({ length: compact ? 18 : 34 }, (_, i) => {
    const char = letters[i % letters.length];
    const x = 4 + ((i * 19) % 92);
    const fall = 5.8 + ((i % 7) * 0.52);
    const delay = -((i * 0.37) % 5.2);
    const size = 18 + ((i % 5) * 7);
    const spin = (i % 2 === 0 ? -1 : 1) * (8 + (i % 6) * 5);
    return (
      <span
        key={`${char}-${i}`}
        style={{
          '--x': x,
          '--fall': `${fall}s`,
          '--delay': `${delay}s`,
          '--size': `${size}px`,
          '--spin': `${spin}deg`,
        }}
      >
        {char}
      </span>
    );
  });

  return (
    <div className={`hydra-load-frame hydra-load-frame--${tone}${compact ? ' hydra-load-frame--compact' : ''}`}>
      <div className="hydra-letter-rain" aria-hidden="true">{glyphs}</div>
      <div className="hydra-load-card">
        <div className="hydra-load-mark" aria-hidden="true">
          <div className="hydra-load-mark-core">H</div>
        </div>
        <h1>{title}</h1>
        <div className="hydra-load-status">{status}</div>
        {detail && <p className="hydra-load-detail">{detail}</p>}
        <div className="hydra-load-meter" aria-hidden="true"><i /></div>
      </div>
    </div>
  );
}

// ─── Auth Screen ─────────────────────────────────────────────────────────────
function AuthScreen({ mode, onSuccess, onRestartRequired, onRefreshAuth }) {
  const isSetup = mode === 'setup';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  // ── Nuclear Reset Logic ──
  const [nukeProgress, setNukeProgress] = useState(0); // 0 to 100
  const [isNuking, setIsNuking] = useState(false);
  const timerRef = useRef(null);
  const nukeSecondsLeft = isNuking ? Math.max(0, Math.ceil((100 - nukeProgress) / 10)) : 10;

  const handleFinalNuke = useCallback(async () => {
    setIsNuking(false);
    try {
      const res = await api.nukeApp(password);
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
  }, [onRestartRequired, password]);

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
    setError('');
    const newErrors = {};

    if (!password) {
      newErrors.password = isSetup ? 'Create a password' : 'Password is required';
    }
    if (isSetup) {
      if (!confirm) {
        newErrors.confirm = 'Confirm your password';
      } else if (password !== confirm) {
        newErrors.confirm = 'Passwords do not match';
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    setErrors({});
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
            <label style={{ fontSize: '0.82rem', color: errors.password ? 'var(--status-error)' : 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              {isSetup ? 'Create Password' : 'Password'}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={show ? 'text' : 'password'}
                className={`form-input ${errors.password ? 'error' : ''}`}
                autoFocus
                placeholder={isSetup ? 'Choose a password' : 'Enter your password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors(prev => ({ ...prev, password: null }));
                }}
              />
              <button
                type="button"
                className="input-reveal-btn"
                onClick={() => setShow(!show)}
                tabIndex={0}
              >
                {show ? 'HIDE' : 'SHOW'}
              </button>
            </div>
            {errors.password && <p className="field-error">{errors.password}</p>}
          </div>

          {isSetup && (
            <div className="form-group">
              <label style={{ fontSize: '0.82rem', color: errors.confirm ? 'var(--status-error)' : 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                Confirm Password
              </label>
              <input
                type={show ? 'text' : 'password'}
                className={`form-input ${errors.confirm ? 'error' : ''}`}
                placeholder="Confirm your password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  if (errors.confirm) setErrors(prev => ({ ...prev, confirm: null }));
                }}
              />
              {errors.confirm && <p className="field-error">{errors.confirm}</p>}
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
              type="button"
              style={{ fontSize: '0.75rem', opacity: 0.6 }}
              onClick={() => {
                setError('');
                onRefreshAuth?.();
              }}
            >
              Re-check setup
            </button>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-tertiary)', fontSize: '0.72rem', lineHeight: 1.4 }}>
              Fresh installs switch to setup automatically after the bootstrap check.
              If you just wiped the vault or restarted Hydra, use this to re-run it.
            </p>
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
               onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleNukeStart(); } }}
               onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') handleNukeEnd(); }}
             >
               <div className="nuke-progress-bar" style={{ width: `${nukeProgress}%` }} />
               <span style={{ position: 'relative', zIndex: 1, pointerEvents: 'none' }}>
                 {isNuking ? `WIPE IN ${nukeSecondsLeft}s` : '☢ NUCLEAR RESET'}
               </span>
             </button>
             <p className="nuke-warning-text">
               {isNuking ? `RELEASE TO CANCEL - WIPE IN ${nukeSecondsLeft}s` : 'HOLD FOR 10 SECONDS TO WIPE SYSTEM'}
             </p>
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
  { id: 'vault', label: 'Vault', icon: <VaultIcon size={18} />, path: '/vault' },
  { id: 'pool', label: 'Pool Manager', icon: <NetworkIcon size={18} />, path: '/pool' },
  { id: 'codes', label: 'Redeem', icon: <TicketIcon size={18} />, path: '/codes' },
  { id: 'generator', label: 'Generator', icon: <GeneratorIcon size={18} />, path: '/generator' },
  { id: 'traffic', label: 'Traffic', icon: <ActivityIcon size={18} />, path: '/traffic' },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={18} />, path: '/settings' },
  { id: 'diagnostics', label: 'Diagnostics', icon: <InfoIcon size={18} />, path: '/diagnostics' }
];

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [authState, setAuthState] = useState('loading'); // 'loading' | 'setup' | 'login' | 'app' | 'offline' | 'restart'
  const [authError, setAuthError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [shutdownConfirm, setShutdownConfirm] = useState(false);
  const recentToastsRef = useRef(new Map());
  const navigate = useNavigate();
  const location = useLocation();

  // #70: Dynamic window title based on current route
  useEffect(() => {
    const path = location.pathname;
    const page = path === '/' ? 'Dashboard' : path.split('/').filter(Boolean)[0];
    const title = page ? `${page.charAt(0).toUpperCase() + page.slice(1)} — Hydra` : 'Hydra';
    document.title = title;
  }, [location.pathname]);

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
      const storedToken = await api.hydrateToken();
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
      logger.warn('Auth check failed:', err.message);
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

  // ── Listen for main-process navigation (e.g. Cmd+, → Preferences) ──
  useEffect(() => {
    if (typeof window !== 'undefined' && window.hydraNative?.onNavigate) {
      window.hydraNative.onNavigate((path) => navigate(path));
    }
  }, [navigate]);

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

  const handleShutdown = useCallback(() => setShutdownConfirm(true), []);
  const handleHideToBackground = useCallback(async () => {
    setShutdownConfirm(false);
    const result = await window.hydraNative?.hideWindow?.();
    if (!result?.ok) {
      addToast('Close the window to keep Hydra running in the background.', 'info');
    }
  }, [addToast]);
  const handleQuit = useCallback(() => {
    window.close();
  }, []);
  const handleShutdownConfirmed = useCallback(async () => {
    setShutdownConfirm(false);
    try { await api.shutdownServer(); } catch { /* ok */ }
    setAuthState('shutdown');
    window.close();
  }, []);

  const navigateToAccount = useCallback((accountId) => {
    navigate(`/account/${accountId}`);
  }, [navigate]);

  const navigateBack = useCallback(() => navigate('/dashboard'), [navigate]);

  // Initial auth-status check (~50–200 ms after React mount).
  //
  // Render NULL here — not a HydraLoadFrame — because the Electron splash
  // is the canonical "starting up" surface and it has just closed. Showing
  // ANOTHER falling-letters splash here causes the visual bug where the
  // user sees splash and password screen overlapping at the same time
  // (the React splash paints on top of the AuthScreen as it transitions).
  //
  // The dark `backgroundColor: '#0a0014'` on the main BrowserWindow
  // covers this brief invisible interval. By the time the eye registers
  // anything, /api/auth/status has resolved and AuthScreen renders.
  //
  // The other HydraLoadFrame uses below (offline / restart / shutdown /
  // Suspense) are STATEFUL screens, not initial loading — keep them.
  if (authState === 'loading') {
    return null;
  }

  // Shutdown
  if (authState === 'shutdown') {
    return (
      <div className="center-container">
        <HydraLoadFrame tone="error" status="SERVER OFFLINE" detail="You may now close this tab safely." />
      </div>
    );
  }

  // Restart required
  if (authState === 'restart') {
    return (
      <div className="center-container">
        <HydraLoadFrame
          tone="warning"
          status="RESTART REQUIRED"
          detail={authError || 'Restart the Hydra server once to regenerate local secrets, then refresh this page.'}
        />
      </div>
    );
  }

  // Offline / backend unavailable
  if (authState === 'offline') {
    return (
      <div className="center-container">
        <HydraLoadFrame tone="error" status="SERVER OFFLINE" detail={authError || 'Start the local Hydra server to continue.'} />
        <div style={{ marginTop: '1rem', color: 'var(--text-tertiary)', fontSize: '0.85rem', maxWidth: 520, textAlign: 'center', position: 'relative', zIndex: 2 }}>
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
          <AuthScreen
            mode={authState}
            onSuccess={handleAuthSuccess}
            onRestartRequired={handleRestartRequired}
            onRefreshAuth={checkAuth}
          />
          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </>
      ) : (
        <>
          {/* #64: Skip-to-content link for keyboard users */}
          <a href="#main-content" className="skip-to-content">
            Skip to main content
          </a>
        <div className={`app-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
          <aside className={`sidebar${sidebarCollapsed ? ' sidebar--collapsed' : ''}`} role="navigation" aria-label="Main navigation">
            <button
              className="sidebar-logo"
              onClick={() => navigate('/')}
              title="Go to Dashboard"
              style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', padding: 0 }}
            >
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
            </button>

            <nav className="sidebar-nav">
              {navItems.map((item) => {
                const isActive = item.id === 'dashboard'
                  ? (location.pathname === '/' || location.pathname.startsWith('/dashboard'))
                  : location.pathname.startsWith(item.path);
                return (
                  <button
                    key={item.id}
                    className={`nav-link ${isActive ? 'active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
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
                style={{ color: 'var(--text-tertiary)', opacity: 0.7 }}
                onClick={() => setSidebarCollapsed(v => !v)}
                title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                <span className="nav-icon">
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    {sidebarCollapsed
                      ? <><polyline points="6,4 10,8 6,12"/></>
                      : <><polyline points="10,4 6,8 10,12"/></>
                    }
                  </svg>
                </span>
                {!sidebarCollapsed && <span>Collapse</span>}
              </button>
              {typeof window !== 'undefined' && window.hydraNative && (
                <>
                  <button className="nav-link nav-link-lock" onClick={handleLogout} title="Lock Vault">
                    <span className="nav-icon">🔒</span>
                    {!sidebarCollapsed && <span>Lock Vault</span>}
                  </button>
                  <button className="nav-link" style={{ color: 'var(--status-error)' }} onClick={handleQuit} title="Quit">
                    <span className="nav-icon"><PowerIcon size={18} /></span>
                    {!sidebarCollapsed && <span>Quit</span>}
                  </button>
                </>
              )}
              {!(typeof window !== 'undefined' && window.hydraNative) && (
                <>
                  <button className="nav-link nav-link-lock" onClick={handleLogout} title="Lock">
                    <span className="nav-icon"><LockIcon size={18} /></span>
                    {!sidebarCollapsed && <span>Lock</span>}
                  </button>
                  <button className="nav-link" style={{ marginTop: '4px', color: 'var(--status-error)' }} onClick={handleShutdown} title="Shutdown">
                    <span className="nav-icon"><PowerIcon size={18} /></span>
                    {!sidebarCollapsed && <span>Shutdown</span>}
                  </button>
                </>
              )}
            </div>
          </aside>

          <main id="main-content" className={`main-content${sidebarCollapsed ? ' main-content--expanded' : ''}`}>
            <div key={location.pathname} className="animate-fade-in">
              {/*
                * Inter-page lazy-route fallback: render NOTHING.
                *
                * Routes are code-split via `lazy()` and typically load in
                * 50–200 ms — short enough that any branded loading card
                * feels jarring rather than helpful (you see splash → click
                * a nav item → big "H" loading card flashes → page renders).
                *
                * Silent fallback means the previous route's content stays
                * for one extra frame, then the new route paints. Feels
                * instant, matches how native macOS apps handle tab swaps.
                *
                * If a future route is slow enough to warrant a skeleton,
                * add it INSIDE that route's component, not here as a
                * global fallback.
                */}
              <Suspense fallback={null}>
                <Routes>
                  <Route path="/" element={<Dashboard onSelectAccount={navigateToAccount} addToast={addToast} />} />
                  <Route path="/dashboard" element={<Dashboard onSelectAccount={navigateToAccount} addToast={addToast} />} />
                  <Route path="/bulk-auth" element={<BulkAuthWizard addToast={addToast} />} />
                  <Route path="/account/:accountId" element={
                    <AccountDetail onBack={navigateBack} addToast={addToast} />
                  } />
                  <Route path="/vault" element={<Vault addToast={addToast} />} />
                  <Route path="/pool" element={<PoolManager addToast={addToast} />} />
                  <Route path="/traffic" element={<Traffic addToast={addToast} />} />
                  <Route path="/codes" element={<CodeRedemption addToast={addToast} />} />
                  <Route path="/generator" element={<Generator addToast={addToast} />} />
                  <Route path="/settings" element={<Settings addToast={addToast} onLogout={handleLogout} />} />
                  <Route path="/diagnostics" element={<Diagnostics addToast={addToast} />} />
                  {/* Catch all to redirect to dashboard */}
                  <Route path="*" element={<Dashboard onSelectAccount={navigateToAccount} addToast={addToast} />} />
                </Routes>
              </Suspense>
            </div>
          </main>

          <ToastContainer toasts={toasts} onDismiss={dismissToast} />

          {shutdownConfirm && (
            <div className="modal-overlay" onClick={() => setShutdownConfirm(false)}>
              <div className="modal-box" onClick={(e) => e.stopPropagation()}>
                <div className="modal-title">Shut down Hydra?</div>
                <p className="modal-body">Quit stops the local proxy. Hide keeps Hydra running in the background so clients can keep using it.</p>
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setShutdownConfirm(false)}>Cancel</button>
                  {window.hydraNative?.hideWindow && (
                    <button className="btn btn-secondary" onClick={handleHideToBackground}>Hide Window</button>
                  )}
                  <button className="btn btn-danger" onClick={handleShutdownConfirmed}>Shut down</button>
                </div>
              </div>
            </div>
          )}
        </div>
        </>
      )}
    </ErrorBoundary>
  );
}
