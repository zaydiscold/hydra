import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { getStorageEncryptionKey } from './local-secrets.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export class EncryptionError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'EncryptionError';
    if (cause) this.cause = cause;
  }
}

export function encrypt(text) {
  if (text === null || text === undefined) return null;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getStorageEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(encryptedBase64) {
  if (!encryptedBase64) return null;

  try {
    const buffer = Buffer.from(encryptedBase64, 'base64');
    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, getStorageEncryptionKey(), iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (err) {
    throw new EncryptionError('Encrypted data is unreadable with the current local secrets.', err);
  }
}

export function encryptConfig(config) {
  return encrypt(JSON.stringify(config ?? {}));
}

export function decryptConfig(encryptedConfig) {
  if (!encryptedConfig) return {};

  try {
    return JSON.parse(decrypt(encryptedConfig));
  } catch (err) {
    throw new EncryptionError('Encrypted config is unreadable with the current local secrets.', err);
  }
}
