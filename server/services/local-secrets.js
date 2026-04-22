import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { config } from '../config.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const SECRETS_PATH = path.join(DATA_DIR, 'local-secrets.json');
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

const resolvedSecrets = resolveSecrets();

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
