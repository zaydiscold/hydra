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

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

export default function Generator({ addToast }) {
  const [emailTemplate, setEmailTemplate] = useState('');
  const [password, setPassword] = useState('HydraGen2026!');
  const [taskId, setTaskId] = useState(null);
  const [status, setStatus] = useState('idle');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState(null);
  const [createdAccount, setCreatedAccount] = useState(null);

  const activeTaskRef = useRef(null);
  const completedToastRef = useRef(false);
  const statusPollInFlightRef = useRef(false);
  const heartbeatInFlightRef = useRef(false);

  useEffect(() => {
    activeTaskRef.current = taskId && !isTerminalStatus(status) ? taskId : null;
  }, [taskId, status]);

  const applyTaskPayload = useCallback((payload) => {
    if (!payload) return;
    const nextStatus = typeof payload.status === 'string' ? payload.status : 'failed';
    setStatus(nextStatus);
    if (payload.error) setError(payload.error);
    if (payload.account) setCreatedAccount(payload.account);
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

  useEffect(() => {
    if (!taskId || isTerminalStatus(status)) return undefined;

    const controller = new AbortController();
    let timer = null;
    let cancelled = false;

    const poll = async () => {
      if (cancelled || statusPollInFlightRef.current) return;
      statusPollInFlightRef.current = true;
      try {
        const res = await api.getGeneratorJobStatus(taskId, controller.signal);
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
        await api.heartbeatGeneratorJob(taskId, controller.signal);
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
    const handlePageHide = () => {
      const currentTaskId = activeTaskRef.current;
      if (!currentTaskId) return;
      void api.cleanupGeneratorJob(currentTaskId, 'client_disconnect', { keepalive: true }).catch((err) => {
        console.warn('[GENERATOR] Keepalive cleanup failed:', err.message || 'Generator cleanup failed');
      });
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      void cleanupActiveTask('client_disconnect');
    };
  }, [cleanupActiveTask]);

  const resetFormState = useCallback(() => {
    setTaskId(null);
    setStatus('idle');
    setOtp('');
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
    try {
      setError(null);
      setOtp('');
      setCreatedAccount(null);
      completedToastRef.current = false;
      const res = await api.startGeneratorJob(emailTemplate, password, 1);
      const payload = res?.data ?? res ?? {};
      setTaskId(payload.taskId ?? payload.jobId ?? null);
      setStatus(payload.status ?? 'initializing');
    } catch (err) {
      setError(err.message);
      addToast?.(err.message, 'error');
    }
  };

  const handleVerify = async () => {
    if (!otp || !taskId) return;
    try {
      setError(null);
      await api.submitGeneratorOtp(taskId, otp);
      setStatus('submitting_otp');
    } catch (err) {
      setError(err.message);
      addToast?.(err.message, 'error');
    }
  };

  const cancelJob = async () => {
    try {
      await cleanupActiveTask('user_cancelled');
    } finally {
      resetFormState();
    }
  };

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
                <label>Gmail Alias</label>
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
              disabled={!emailTemplate}
            >
              <span className="btn-icon" style={{ justifyContent: 'center' }}>
                <PlusIcon size={20} />
                <span>Start Generation</span>
              </span>
            </button>

            <div className="generator-steps" aria-label="Generator flow">
              <span>1. Email alias</span>
              <span>2. Isolated browser</span>
              <span>3. Paste OTP</span>
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
        <div className="card active-job-card shine-sweep animate-spring stagger-delay-50" style={{ borderColor: 'var(--accent-primary)', borderLeftWidth: 8 }}>
          <h3>Active Job</h3>
          <p style={{ marginTop: 'var(--space-sm)' }}>
            [STATUS]{' '}
            <span className="status-dot success" style={{ color: 'var(--accent-primary)', fontWeight: 800 }}>
              [{status.toUpperCase()}]
            </span>
          </p>
          {taskId && (
            <p className="mono" style={{ marginTop: '0.5rem', opacity: 0.7 }}>
              TASK {taskId.slice(0, 8)}
            </p>
          )}

          <div className="status-indicator" style={{ marginTop: 'var(--space-md)' }}>
            {status === 'awaiting_otp' ? (
              <div className="otp-box">
                <p>Playwright paused. Enter the 6-digit code sent to {emailTemplate}:</p>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', marginBottom: '1rem' }}>
                  <input
                    type="text"
                    className="form-input form-input-mono otp-input"
                    maxLength={6}
                    value={otp}
                    onChange={e => setOtp(e.target.value)}
                    placeholder="123456"
                    style={{ fontSize: '2rem', letterSpacing: '0.4em', width: '240px' }}
                    spellCheck={false}
                  />
                  <button type="button" className="btn btn-primary" onClick={handleVerify} disabled={otp.length !== 6}>
                    [VERIFY]
                  </button>
                </div>
              </div>
            ) : (
              <p>Please wait…</p>
            )}
          </div>

          <button type="button" className="btn btn-ghost" onClick={cancelJob} style={{ marginTop: 'var(--space-xl)', color: 'var(--status-error)' }}>
            <span className="btn-icon">
              <PowerIcon size={18} />
              <span>CANCEL & CLEANUP</span>
            </span>
          </button>
        </div>
      )}
    </>
  );
}
