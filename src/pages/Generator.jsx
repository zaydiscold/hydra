import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import AnimeText from '../components/AnimeText';
import { clearTrackedTimeout, setTrackedTimeout } from '../lib/runtimeDiagnostics.js';
import {
  GeneratorIcon,
  PlusIcon,
  PowerIcon,
} from '../components/Icons';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired']);
const HEARTBEAT_INTERVAL_MS = 10 * 1000;
const POLL_INTERVAL_MS = 2 * 1000;
const BROWSER_BACKED_STATUSES = new Set([
  'entering_email',
  'entering_signup_details',
  'waiting_for_otp_screen',
  'manual_verification',
  'awaiting_otp',
  'submitting_otp',
  'waiting_for_completion',
]);
const STATUS_COPY = {
  detecting_account: 'Checking whether this email already exists.',
  falling_back_to_browser: 'Opening the isolated account browser for signup.',
  launching_browser: 'Launching the isolated account browser.',
  navigating_signup: 'Opening OpenRouter signup.',
  waiting_for_page_hydrate: 'Waiting for Clerk to render the signup form.',
  entering_email: 'Entering the signup email.',
  entering_signup_details: 'Entering the signup password and required OpenRouter consent.',
  waiting_for_otp_screen: 'Watching the isolated browser for email-code or human-verification state.',
  manual_verification: 'Finish any OpenRouter security check in the account browser. Hydra will enable the code field when the OTP screen appears.',
  sending_otp: 'Sending the email code through direct HTTPS.',
  awaiting_otp: 'Enter the 6-digit code from your email.',
  submitting_otp: 'Code submitted. Hydra is finishing signup in the background.',
  verifying_otp: 'Verifying the code.',
  waiting_for_completion: 'Waiting for OpenRouter to finish the dashboard handoff.',
  setting_password: 'Setting the account password.',
  extracting_session: 'Capturing the finished dashboard session.',
  activating_session: 'Extending the fresh OTP session.',
  activating_long_lived_session: 'Extending the fresh signup session.',
  saving_profile: 'Saving the local account profile.',
  saving_local_profile: 'Saving the local account profile.',
  provisioning_key: 'Creating the first management key.',
};

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

function generatorModeLabel(mode) {
  if (mode === 'https_otp') return 'Direct HTTPS OTP';
  if (mode === 'browser_signup') return 'Isolated browser signup';
  return 'Generator';
}

function checkpointLabel(checkpoint) {
  switch (checkpoint?.state) {
    case 'otp':
      return 'OTP screen detected';
    case 'manual_verification':
      return 'Security check visible';
    case 'signup_blocked': {
      const fields = [
        checkpoint.passwordBlocked ? 'password' : null,
        checkpoint.legalBlocked ? 'terms' : null,
      ].filter(Boolean).join(' + ');
      return fields ? `Signup fields blocked: ${fields}` : 'Signup fields blocked';
    }
    case 'signup_form':
      return 'Signup form visible';
    default:
      return null;
  }
}

export default function Generator({ addToast }) {
  const [emailTemplate, setEmailTemplate] = useState('');
  const [password, setPassword] = useState('HydraGen2026!');
  const [taskId, setTaskId] = useState(null);
  const [status, setStatus] = useState('idle');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState(null);
  const [createdAccount, setCreatedAccount] = useState(null);
  const [jobMode, setJobMode] = useState(null);
  const [checkpoint, setCheckpoint] = useState(null);
  const [starting, setStarting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [focusingBrowser, setFocusingBrowser] = useState(false);

  const activeTaskRef = useRef(null);
  const completedToastRef = useRef(false);
  const statusPollInFlightRef = useRef(false);
  const heartbeatInFlightRef = useRef(false);
  const lifecycleClosedRef = useRef(false);
  const startInFlightRef = useRef(false);
  const verifyInFlightRef = useRef(false);

  useEffect(() => {
    activeTaskRef.current = taskId && !isTerminalStatus(status) ? taskId : null;
  }, [taskId, status]);

  const applyTaskPayload = useCallback((payload) => {
    if (!payload) return;
    const nextStatus = typeof payload.status === 'string' ? payload.status : 'failed';
    setStatus(nextStatus);
    if (payload.error) setError(payload.error);
    if (payload.account) setCreatedAccount(payload.account);
    if (payload.mode) setJobMode(payload.mode);
    if (payload.checkpoint) setCheckpoint(payload.checkpoint);
    if (payload.taskId && !taskId) setTaskId(payload.taskId);
  }, [taskId]);

  const cleanupActiveTask = useCallback((reason = 'cancelled', options = {}) => {
    const currentTaskId = activeTaskRef.current;
    if (!currentTaskId) return Promise.resolve();
    activeTaskRef.current = null;
    return api.cleanupGeneratorJob(currentTaskId, reason, options).catch((err) => {
      const message = err.message || 'Generator cleanup failed';
      console.warn('[GENERATOR] Cleanup failed:', message);
      if (!options.keepalive) addToast?.(message, 'warning');
    });
  }, [addToast]);

  const cleanupLateStartedTask = useCallback((lateTaskId) => {
    if (!lateTaskId) return;
    void api.cleanupGeneratorJob(lateTaskId, 'client_disconnect', { keepalive: true }).catch((err) => {
      console.warn('[GENERATOR] Late-start cleanup failed:', err.message || 'Generator cleanup failed');
    });
  }, []);

  useEffect(() => {
    if (!taskId || isTerminalStatus(status)) return undefined;

    const controller = new AbortController();
    let timer = null;
    let cancelled = false;

    const poll = async () => {
      if (cancelled || statusPollInFlightRef.current) return;
      statusPollInFlightRef.current = true;
      try {
        const res = await api.getGeneratorJobStatusQuiet(taskId, controller.signal);
        applyTaskPayload(res?.data ?? res ?? {});
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('[GENERATOR] Status check failed:', err.message);
      } finally {
        statusPollInFlightRef.current = false;
      }
    };

    const schedule = () => {
      if (cancelled) return;
      timer = setTrackedTimeout('Generator.statusPoll', async () => {
        timer = null;
        await poll();
        schedule();
      }, POLL_INTERVAL_MS);
    };

    schedule();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTrackedTimeout(timer);
    };
  }, [applyTaskPayload, status, taskId]);

  useEffect(() => {
    if (!taskId || isTerminalStatus(status)) return undefined;

    const controller = new AbortController();
    let timer = null;
    let cancelled = false;

    const heartbeat = async () => {
      if (cancelled || heartbeatInFlightRef.current) return;
      heartbeatInFlightRef.current = true;
      try {
        await api.heartbeatGeneratorJobQuiet(taskId, controller.signal);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('[GENERATOR] Heartbeat failed:', err.message);
      } finally {
        heartbeatInFlightRef.current = false;
      }
    };

    const schedule = () => {
      if (cancelled) return;
      timer = setTrackedTimeout('Generator.heartbeat', async () => {
        timer = null;
        await heartbeat();
        schedule();
      }, HEARTBEAT_INTERVAL_MS);
    };

    schedule();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTrackedTimeout(timer);
    };
  }, [status, taskId]);

  useEffect(() => {
    lifecycleClosedRef.current = false;

    const handlePageHide = () => {
      lifecycleClosedRef.current = true;
      const currentTaskId = activeTaskRef.current;
      if (!currentTaskId) return;
      void api.cleanupGeneratorJob(currentTaskId, 'client_disconnect', { keepalive: true }).catch((err) => {
        console.warn('[GENERATOR] Keepalive cleanup failed:', err.message || 'Generator cleanup failed');
      });
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);

    return () => {
      lifecycleClosedRef.current = true;
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      void cleanupActiveTask('client_disconnect');
    };
  }, [cleanupActiveTask]);

  const resetFormState = useCallback(() => {
    setTaskId(null);
    setStatus('idle');
    setOtp('');
    setJobMode(null);
    setCheckpoint(null);
    setVerifying(false);
    setFocusingBrowser(false);
  }, []);

  useEffect(() => {
    if (status === 'completed' && createdAccount && addToast && !completedToastRef.current) {
      completedToastRef.current = true;
      addToast(
        `OpenRouter account ${createdAccount.alias || emailTemplate} created.`,
        'success'
      );
    }
    if (status !== 'completed') completedToastRef.current = false;
  }, [status, createdAccount, addToast, emailTemplate]);

  const handleStart = async () => {
    if (startInFlightRef.current) return;
    startInFlightRef.current = true;
    setStarting(true);
    try {
      setError(null);
      setOtp('');
      setCreatedAccount(null);
      setCheckpoint(null);
      completedToastRef.current = false;
      const res = await api.startGeneratorJob(emailTemplate, password, 1);
      const payload = res?.data ?? res ?? {};
      const startedTaskId = payload.taskId ?? payload.jobId ?? null;
      if (lifecycleClosedRef.current) {
        cleanupLateStartedTask(startedTaskId);
        return;
      }
      activeTaskRef.current = startedTaskId;
      setTaskId(startedTaskId);
      setJobMode(payload.mode ?? null);
      setStatus(payload.status ?? 'initializing');
    } catch (err) {
      if (lifecycleClosedRef.current) return;
      setError(err.message);
      addToast?.(err.message, 'error');
    } finally {
      startInFlightRef.current = false;
      if (!lifecycleClosedRef.current) setStarting(false);
    }
  };

  const handleVerify = async () => {
    if (otp.length !== 6 || !taskId || verifyInFlightRef.current) return;
    const renderedTaskId = taskId;
    verifyInFlightRef.current = true;
    setVerifying(true);
    try {
      setError(null);
      await api.submitGeneratorOtpQuiet(renderedTaskId, otp);
      if (lifecycleClosedRef.current || activeTaskRef.current !== renderedTaskId) return;
      setStatus('submitting_otp');
    } catch (err) {
      if (lifecycleClosedRef.current) return;
      setError(err.message);
      addToast?.(err.message, 'error');
    } finally {
      verifyInFlightRef.current = false;
      if (!lifecycleClosedRef.current) setVerifying(false);
    }
  };

  const handleFocusBrowser = async () => {
    if (!taskId || focusingBrowser) return;
    setFocusingBrowser(true);
    try {
      const res = await api.focusGeneratorBrowserQuiet(taskId);
      applyTaskPayload(res?.data ?? res ?? {});
    } catch (err) {
      addToast?.(err.message || 'Could not show account browser', 'warning');
    } finally {
      if (!lifecycleClosedRef.current) setFocusingBrowser(false);
    }
  };

  const cancelJob = async () => {
    try {
      await cleanupActiveTask('user_cancelled');
    } finally {
      resetFormState();
    }
  };

  const checkpointText = checkpointLabel(checkpoint);
  const canFocusBrowser = jobMode === 'browser_signup' && BROWSER_BACKED_STATUSES.has(status);

  return (
    <>
      <div className="page-header page-header--panel generator-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <GeneratorIcon size={32} style={{ color: 'var(--accent-primary)' }} />
          <div>
            <AnimeText as="h2" mode="words" variant="scanline" delay={42}>Account Generator</AnimeText>
            <p>Create one isolated OpenRouter account, pause for OTP, store the finished session locally.</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          [ERROR] {error}
        </div>
      )}

      {status === 'idle' || isTerminalStatus(status) ? (
        <div className="generator-grid">
          <div className="card generator-card shine-sweep animate-spring stagger-delay-0">
            <div className="generator-card-title">New account</div>
            <div className="generator-form-grid">
              <div className="form-group">
                <label>Email alias</label>
                <input
                  type="email"
                  className="form-input form-input-mono"
                  value={emailTemplate}
                  onChange={e => setEmailTemplate(e.target.value)}
                  placeholder="alias+1@example.com"
                  spellCheck={false}
                  autoComplete="email"
                />
              </div>
              <div className="form-group">
                <label>Password to assign</label>
                <input
                  type="text"
                  className="form-input form-input-mono"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  spellCheck={false}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <button type="button" className="btn btn-primary generator-start-btn"
              onClick={handleStart}
              disabled={!emailTemplate || starting}
            >
              <span className="btn-icon" style={{ justifyContent: 'center' }}>
                <PlusIcon size={20} />
                <span>{starting ? 'Starting...' : 'Start Generation'}</span>
              </span>
            </button>

            <div className="generator-steps" aria-label="Generator flow">
              <span>1. Email alias</span>
              <span>2. Isolated browser</span>
              <span>3. Email code</span>
              <span>4. Session saved</span>
            </div>
          </div>

          {status === 'completed' && (
            <div className="success-banner" style={{ marginTop: '1rem' }}>
              [SUCCESS] Account {createdAccount?.alias || emailTemplate} created and provisioned.
            </div>
          )}
          {status === 'expired' && (
            <div className="error-banner" style={{ marginTop: '1rem' }}>
              [EXPIRED] Generator job expired because the UI stopped heartbeating.
            </div>
          )}
          {status === 'cancelled' && (
            <div className="error-banner" style={{ marginTop: '1rem' }}>
              [CANCELLED] Generator job was cancelled and cleaned up.
            </div>
          )}
        </div>
      ) : (
        <div className="card active-job-card generator-active-card shine-sweep animate-spring stagger-delay-50">
          <div className="generator-active-heading">
            <div>
              <h3>Active job</h3>
              <p>
                Status{' '}
                <span className="status-dot success">
                  {status.replace(/_/g, ' ').toUpperCase()}
                </span>
              </p>
            </div>
            <span className="generator-mode-pill">{generatorModeLabel(jobMode)}</span>
          </div>
          {taskId && (
            <p className="mono" style={{ marginTop: '0.5rem', opacity: 0.7 }}>
              TASK {taskId.slice(0, 8)}
            </p>
          )}

            <div className="status-indicator" style={{ marginTop: 'var(--space-md)' }}>
            {status === 'awaiting_otp' ? (
              <div className="otp-box generator-otp-panel">
                <p className="generator-status-copy">
                  <strong>{generatorModeLabel(jobMode)}</strong> is ready for the email code sent to {emailTemplate}.
                </p>
                <form
                  className="generator-otp-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleVerify();
                  }}
                >
                  <input
                    type="text"
                    className="form-input form-input-mono otp-input"
                    maxLength={6}
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    spellCheck={false}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                  <button type="submit" className="btn btn-primary generator-otp-submit" disabled={otp.length !== 6 || verifying || status !== 'awaiting_otp'}>
                    {verifying ? 'Submitting...' : 'Submit code'}
                  </button>
                </form>
              </div>
            ) : (
              <>
                <p className="generator-status-copy">
                  {STATUS_COPY[status] || 'Please wait while Hydra advances this generator job.'}
                </p>
                {checkpointText && (
                  <p className="generator-checkpoint-line" aria-live="polite">
                    Browser state: {checkpointText}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="generator-job-actions">
            {canFocusBrowser && (
              <button type="button" className="btn btn-secondary generator-browser-focus" onClick={handleFocusBrowser} disabled={focusingBrowser}>
                {focusingBrowser ? 'Showing...' : 'Show account browser'}
              </button>
            )}
            <button type="button" className="btn btn-ghost generator-cancel-btn" onClick={cancelJob}>
              <span className="btn-icon">
                <PowerIcon size={18} />
                <span>Cancel job</span>
              </span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
