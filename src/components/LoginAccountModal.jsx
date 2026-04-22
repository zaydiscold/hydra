import { useState, useEffect } from 'react';
import * as api from '../api';

function initialStepForAccount(account) {
  if (account?.authMethod === 'otp') return 'otp_intro';
  if (account?.passwordOnFile === false) return 'otp_intro';
  return 'password';
}

/**
 * Email/password or OTP flow to establish an OpenRouter session for a stored account.
 */
/** After password, Clerk may require TOTP (authenticator) — not email OTP. */
const OTP_MODE = { email: 'email', totp2fa: 'totp2fa' };

export default function LoginAccountModal({ account, onClose, onDone }) {
  const [step, setStep] = useState(() => initialStepForAccount(account));
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [signInId, setSignInId] = useState('');
  const [otpMode, setOtpMode] = useState(OTP_MODE.email);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setStep(initialStepForAccount(account));
    setPassword('');
    setOtpCode('');
    setSignInId('');
    setOtpMode(OTP_MODE.email);
    setErrors({});
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when identity or sign-in path metadata changes, not whole account object
  }, [account.id, account.authMethod, account.passwordOnFile]);

  async function handleLogin(e) {
    e.preventDefault();
    if (!password) {
      setErrors({ password: 'Password is required' });
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await api.loginAccount(account.id, password);
      onDone('Session established successfully');
      onClose();
    } catch (err) {
      if (err.message?.includes('NEEDS_2FA') || err.requiresTwoFactor) {
        if (err.signInId) setSignInId(err.signInId);
        setOtpMode(OTP_MODE.totp2fa);
        setStep('otp');
      } else {
        setErrors({ submit: api.formatApiErrorMessage(err) });
      }
    }
    setLoading(false);
  }

  async function handleStartOTP(e) {
    e?.preventDefault?.();
    setErrors({});
    setLoading(true);
    try {
      const res = await api.startOTP(account.id, account.email);
      const sid = res?.data?.signInId ?? res?.signInId ?? '';
      if (!sid) {
        setErrors({ submit: 'Server did not return a sign-in id. Try again or check server logs.' });
        setLoading(false);
        return;
      }
      setSignInId(sid);
      setOtpMode(OTP_MODE.email);
      setStep('otp');
    } catch (err) {
      setErrors({ submit: api.formatApiErrorMessage(err) });
    }
    setLoading(false);
  }

  async function handleVerifyOTP(e) {
    e.preventDefault();
    if (!otpCode || otpCode.length < 6) {
      setErrors({ otp: 'Enter the full 6-digit code' });
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await api.verifyOTP(account.id, signInId, otpCode, {
        totpSecondFactor: otpMode === OTP_MODE.totp2fa,
      });
      onDone('OTP verified — session active');
      onClose();
    } catch (err) {
      setErrors({ submit: api.formatApiErrorMessage(err) });
    }
    setLoading(false);
  }

  function handleOtpBack() {
    setOtpCode('');
    setSignInId('');
    setOtpMode(OTP_MODE.email);
    setErrors({});
    const otpFirst = account.authMethod === 'otp' || account.passwordOnFile === false;
    setStep(otpFirst ? 'otp_intro' : 'password');
  }

  return (
    <div className="modal-backdrop" onClick={onClose} data-testid="login-account-backdrop">
      <div className="modal animate-spring" onClick={(e) => e.stopPropagation()} data-testid="login-account-modal">
        <div className="modal-header">
          <div>
            <h3 data-testid="login-account-title">Authenticate — {account.alias}</h3>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem', marginTop: 2 }}>
              {account.email}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>

        {step === 'otp_intro' && (
          <div data-testid="login-account-otp-intro">
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 'var(--space-md)' }}>
              We’ll send a 6-digit code to your email to sign in to OpenRouter. Any existing dashboard session in the vault is kept until verification succeeds (a failed or abandoned code does not clear it by itself).
            </p>
            {errors.submit && <p className="form-error" data-testid="login-account-error">{errors.submit}</p>}
            <div className="modal-footer" style={{ flexDirection: 'column', gap: 8 }}>
              <button type="button" className="btn btn-primary btn-full" data-testid="login-account-send-otp" onClick={handleStartOTP} disabled={loading}>
                {loading ? <><div className="spinner-sm" /> Sending...</> : 'Send verification code'}
              </button>
              <button type="button" className="btn btn-ghost btn-full" data-testid="login-account-use-password" onClick={() => { setErrors({}); setStep('password'); }} disabled={loading}>
                Use password instead
              </button>
            </div>
          </div>
        )}

        {step === 'password' && (
          <form onSubmit={handleLogin} noValidate data-testid="login-account-password-form">
            <div className="form-group">
              <label>Password</label>
              <input type="password" className={`form-input ${errors.password ? 'error' : ''}`} placeholder="Account password" data-testid="login-account-password-input"
                value={password} onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors(prev => ({ ...prev, password: null }));
                }} autoFocus spellCheck={false} />
              {errors.password && <p className="field-error">{errors.password}</p>}
            </div>
            {errors.submit && <p className="form-error" data-testid="login-account-error">{errors.submit}</p>}
            <div className="modal-footer" style={{ flexDirection: 'column', gap: 8 }}>
              <button type="submit" className="btn btn-primary btn-full" data-testid="login-account-password-submit" disabled={loading}>
                {loading ? <><div className="spinner-sm" /> Signing in...</> : 'Sign In'}
              </button>
              <button type="button" className="btn btn-ghost btn-full" data-testid="login-account-switch-otp" onClick={handleStartOTP} disabled={loading}>
                {loading ? 'Sending OTP...' : 'Use Email OTP instead'}
              </button>
            </div>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={handleVerifyOTP} noValidate data-testid="login-account-otp-form">
            <div className="info-banner" style={{ marginBottom: 'var(--space-md)', background: 'rgba(255, 184, 0, 0.05)', border: '1px solid rgba(255, 184, 0, 0.2)' }}>
              <span style={{ fontWeight: 800, color: 'var(--status-warning)' }} className="pulsar">
                {otpMode === OTP_MODE.totp2fa ? '[2FA REQUIRED]' : '[OTP REQUIRED]'}
              </span>
              <span style={{ fontSize: '0.8rem' }}>
                {otpMode === OTP_MODE.totp2fa
                   ? 'Enter the 6-digit code from your authenticator app (TOTP).'
                  : '6-digit code sent to your email. Check inbox.'}
              </span>
            </div>
            <div className="form-group">
              <label>OTP Code</label>
              <input type="text" className={`form-input form-input-mono otp-input ${errors.otp ? 'error' : ''}`} data-testid="login-account-otp-input"
                placeholder="123456" maxLength={6}
                value={otpCode} onChange={(e) => {
                  setOtpCode(e.target.value);
                  if (errors.otp && e.target.value.length === 6) setErrors(prev => ({ ...prev, otp: null }));
                }} autoFocus spellCheck={false} />
              {errors.otp && <p className="field-error">{errors.otp}</p>}
            </div>
            {errors.submit && <p className="form-error" data-testid="login-account-error">{errors.submit}</p>}
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" data-testid="login-account-otp-back" onClick={handleOtpBack} disabled={loading}>Back</button>
              <button
                type="submit"
                className="btn btn-primary"
                data-testid="login-account-otp-submit"
                disabled={loading || otpCode.length < 6 || !signInId}
              >
                {loading ? <><div className="spinner-sm" /> Verifying...</> : 'Verify Code'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
