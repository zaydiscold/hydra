/**
 * Hydra Electron — Biometric Unlock (Touch ID + future Windows Hello)
 *
 * MVP design: biometric is a "trust this device" gate over the existing
 * persisted auth-token mechanism (`native:auth-token:*` in ipc.js).
 *
 *   1. User enables in Settings — we persist `biometricEnabled=true` and
 *      keep the existing auth-token-on-disk flow.
 *   2. On next launch, the renderer asks the bridge for the auth token.
 *      If `biometricEnabled === true`, we Touch-ID-prompt FIRST. Only
 *      after approval does the token come back.
 *   3. On denial / cancel, we return null and the user falls back to
 *      typing their password.
 *
 * This means biometric never *replaces* the password — it's a convenience
 * gate over an already-trusted device-local secret. Threat model:
 *   • Adversary with physical access + Touch ID enrolled — can unlock
 *     without knowing the password. Identical to every macOS keychain-
 *     backed app (1Password, Bitwarden, system Keychain). Acceptable.
 *   • Adversary with disk access — already has the encrypted vault and
 *     the auth token file, both at 0600. Touch ID doesn't help them.
 *   • Adversary with neither — no impact.
 *
 * Why not `node-mac-auth`: Electron exposes `systemPreferences.canPromptTouchID()`
 * and `systemPreferences.promptTouchID()` natively on macOS, so we don't need
 * an external native dep. Windows Hello support stays unavailable until we can
 * ship it without adding fragile native package installs.
 */
import { systemPreferences } from 'electron';

const PLATFORM = process.platform;
let _availabilityFailureReported = false;

function warnBiometricFailure(scope, error) {
  const message = error?.message || String(error);
  console.warn(`[biometric] ${scope}: ${message}`);
}

/**
 * Does this device support biometric unlock at all?
 *   • macOS: Touch ID enrolled and policy available
 *   • Windows: Hello is unavailable in this build
 *   • Linux: not supported
 */
export function canPromptBiometric() {
  try {
    if (PLATFORM === 'darwin') {
      // canPromptTouchID returns false if the Mac has no Secure Enclave or
      // if no fingerprint is enrolled. We treat both as "not available".
      return Boolean(systemPreferences?.canPromptTouchID?.());
    }
    return false; // Windows Hello / Linux unavailable in this build
  } catch (err) {
    if (!_availabilityFailureReported) {
      warnBiometricFailure('Touch ID availability check failed', err);
      _availabilityFailureReported = true;
    }
    return false;
  }
}

/**
 * Prompt the user with a biometric challenge. Resolves on approval,
 * rejects with a typed error on denial / unavailable / unsupported.
 *
 * @param {string} reason — short human-readable text shown by the OS
 * @returns {Promise<true>}
 */
export async function promptBiometric(reason = 'Unlock Hydra') {
  if (!canPromptBiometric()) {
    const err = new Error('Biometric authentication is not available on this device');
    err.code = 'NOT_AVAILABLE';
    throw err;
  }
  if (PLATFORM === 'darwin') {
    // promptTouchID throws on cancel, denial, or sensor failure — but the
    // raw error doesn't tell the renderer WHY it failed. Distinguish here
    // so the UI can choose copy ("Sign in again with password" vs "Touch ID
    // hardware error — try a different finger").
    try {
      await systemPreferences.promptTouchID(reason);
      return true;
    } catch (raw) {
      const msg = String(raw?.message || raw || '').toLowerCase();
      const e = new Error(raw?.message || 'Touch ID failed');
      if (/cancel|user.+denied|user.+rejected/.test(msg)) e.code = 'BIOMETRIC_CANCELLED';
      else if (/not.+available|disabled|policy/.test(msg)) e.code = 'BIOMETRIC_UNAVAILABLE';
      else e.code = 'BIOMETRIC_FAILED';
      warnBiometricFailure(`Touch ID prompt failed (${e.code})`, e);
      throw e;
    }
  }
  // Should be unreachable given canPromptBiometric guard, but leave a clear error.
  const err = new Error('Biometric prompt is unavailable for this platform');
  err.code = 'UNSUPPORTED_PLATFORM';
  throw err;
}

/**
 * Convenience: returns a typed `{available, platform, reason?}` object
 * for the renderer to render UI affordances correctly.
 */
export function describeBiometricSupport() {
  if (PLATFORM === 'darwin') {
    const available = canPromptBiometric();
    return {
      available,
      platform: 'darwin',
      label: 'Touch ID',
      reason: available ? null : 'No fingerprint enrolled or device lacks Secure Enclave',
    };
  }
  if (PLATFORM === 'win32') {
    return {
      available: false,
      platform: 'win32',
      label: 'Windows Hello',
      reason: 'Windows Hello is unavailable in this build',
    };
  }
  return {
    available: false,
    platform: PLATFORM,
    label: 'Biometric',
    reason: 'Not supported on this platform',
  };
}
