import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { config } from '../config.js';
import { getDataDir, getDataPath } from '../lib/data-dir.js';
import { logger } from './logger.js';

const DATA_DIR = getDataDir();
const SECRETS_PATH = getDataPath('local-secrets.json');
const HEX_SECRET_LENGTH = 64;

function normalizeSecret(secret, name) {
  if (!secret) return null;

  const normalized = secret.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${name} must be a 64-character hex string.`);
  }

  return normalized.toLowerCase();
}

function generateSecret() {
  return randomBytes(32).toString('hex');
}

function loadPersistedSecrets() {
  if (!existsSync(SECRETS_PATH)) return {};

  try {
    const parsed = JSON.parse(readFileSync(SECRETS_PATH, 'utf8'));
    return {
      storageKey: normalizeSecret(parsed.storageKey, 'Persisted storageKey'),
      proxySecret: normalizeSecret(parsed.proxySecret, 'Persisted proxySecret'),
    };
  } catch (error) {
    throw new Error(`Failed to read ${SECRETS_PATH}: ${error.message}`);
  }
}

function persistSecrets(secrets) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SECRETS_PATH, `${JSON.stringify(secrets, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function resolveSecrets() {
  const persisted = loadPersistedSecrets();
  const storageKey = normalizeSecret(config.LOCAL_STORAGE_KEY ?? config.VAULT_KEY, 'LOCAL_STORAGE_KEY/VAULT_KEY')
    ?? persisted.storageKey
    ?? generateSecret();
  const proxySecret = normalizeSecret(config.HYDRA_PROXY_SECRET, 'HYDRA_PROXY_SECRET')
    ?? persisted.proxySecret
    ?? generateSecret();

  const shouldPersist = !persisted.storageKey || !persisted.proxySecret;
  if (shouldPersist) {
    persistSecrets({ storageKey, proxySecret });
  }

  return {
    storageKey: Buffer.from(storageKey, 'hex'),
    proxySecret: Buffer.from(proxySecret, 'hex'),
    secretsPath: SECRETS_PATH,
  };
}

// Item #37: wrap module-level resolve in try/catch so a corrupted secrets file
// doesn't crash the entire server at import time.
//
// IMPORTANT: only quarantine + regenerate on errors that GENUINELY indicate
// file corruption (bad JSON syntax, hex parse failure). Transient I/O errors
// (EBUSY, EACCES, EAGAIN) must re-throw — silently regenerating secrets in
// those cases would orphan every encrypted account blob the user owns.
function isCorruptionError(error) {
  if (!error) return false;
  if (error instanceof SyntaxError) return true;  // JSON.parse failure
  // resolveSecrets() throws plain Error('invalid hex...') on hex decode fail.
  // Match defensively but specifically.
  const msg = error.message || '';
  return /invalid hex|malformed|unexpected token|JSON/i.test(msg);
}

function safeResolveSecrets() {
  try {
    return resolveSecrets();
  } catch (error) {
    if (!isCorruptionError(error)) {
      // Transient I/O / permissions / disk error — surface, do NOT regenerate.
      logger.error({
        source: 'local-secrets',
        event: 'resolve_failed_transient',
        message: `[SECRETS] Could not load local-secrets.json: ${error.message}. NOT regenerating — re-throw so the operator can recover.`,
        stack: error.stack,
        code: error.code,
      });
      throw error;
    }

    let quarantinedPath = null;
    if (existsSync(SECRETS_PATH)) {
      try {
        quarantinedPath = `${SECRETS_PATH}.corrupt-${Date.now()}`;
        renameSync(SECRETS_PATH, quarantinedPath);
      } catch (renameErr) {
        logger.error({
          source: 'local-secrets',
          event: 'corrupt_quarantine_failed',
          message: `[SECRETS] Could not rename corrupt secrets file: ${renameErr.message}`,
          stack: renameErr.stack,
        });
      }
    }

    logger.error({
      source: 'local-secrets',
      event: 'secrets_regenerated',
      message: `[SECRETS] Corrupt local-secrets.json detected (${error.constructor.name}: ${error.message}) — regenerating fresh secrets. Encrypted account blobs from before this point are unrecoverable.`,
      secretsPath: SECRETS_PATH,
      quarantinedPath,
      state: 'secrets-regenerated',
    });

    // Second attempt with corrupt file moved aside — should succeed.
    return resolveSecrets();
  }
}

const resolvedSecrets = safeResolveSecrets();

// Mutable reference — allows runtime rotation without restart
let _proxySecret = resolvedSecrets.proxySecret;

export function getStorageEncryptionKey() {
  return resolvedSecrets.storageKey;
}

export function getProxyMasterSecret() {
  return _proxySecret;
}

export function getLocalSecretsPath() {
  return resolvedSecrets.secretsPath;
}

export function getLocalSecretsInfo() {
  return {
    secretsPath: resolvedSecrets.secretsPath,
    storageKeyLength: HEX_SECRET_LENGTH,
  };
}

/**
 * Generate a new proxySecret, update in-memory + persist to disk.
 * All subsequent getMasterProxyKey() / getGenericProxyKey() calls return
 * keys derived from the new secret — no restart required.
 */
export function rotateProxySecret() {
  const newHex = generateSecret();
  _proxySecret = Buffer.from(newHex, 'hex');
  // Preserve storageKey when writing back
  const currentStorageKey = resolvedSecrets.storageKey.toString('hex');
  persistSecrets({ storageKey: currentStorageKey, proxySecret: newHex });
  return newHex;
}
