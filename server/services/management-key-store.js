/**
 * Management Key Storage & Retrieval System
 * 
 * Handles secure storage of OpenRouter management keys with:
 * - Encryption at rest
 * - Account association
 * - Balance tracking
 * - Usage statistics
 */

import crypto from 'node:crypto';

import { prisma } from './db.js';
import { encrypt, decrypt } from './storage-codec.js';

/**
 * Store a newly created management key
 * @param {string} accountId - Hydra account ID
 * @param {string} key - The sk-or-v1-... key
 * @param {string} name - Key name/label
 * @param {Object} metadata - Additional metadata (expiresAt, etc)
 */
export async function storeManagementKey(accountId, key, name, metadata = {}) {
  // Reject empty, preview/masked keys (contain ... or too short to be real)
  if (!key || key.length < 20) {
    throw new Error('Key too short or empty — full key required');
  }
  if (key.includes('...')) {
    throw new Error(`Rejecting masked/preview key (length: ${key.length}) — full key required, not preview`);
  }

  // Encrypt the key
  const encryptedKey = encrypt(key);

  // Store in database
  const keyRecord = await prisma.managementKey.create({
    data: {
      id: crypto.randomUUID(),
      accountId,
      encryptedKey,
      name: name || `Key ${new Date().toLocaleString()}`,
      status: 'active',
      metadata: metadata ? JSON.stringify(metadata) : null,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  });

  return {
    id: keyRecord.id,
    accountId,
    name: keyRecord.name,
    status: 'active',
    createdAt: keyRecord.createdAt
  };
}

/**
 * Get all management keys for an account (decrypted)
 * @param {string} accountId
 * @returns {Array} Keys with decrypted values
 */
export async function getManagementKeys(accountId) {
  const keys = await prisma.managementKey.findMany({
    where: { accountId },
    orderBy: { createdAt: 'desc' }
  });

  return keys.map(k => ({
    id: k.id,
    accountId: k.accountId,
    key: decrypt(k.encryptedKey), // Decrypt for use
    name: k.name,
    status: k.status,
    metadata: k.metadata ? JSON.parse(k.metadata) : null,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt
  }));
}

/**
 * Get a single management key by ID
 * @param {string} keyId
 * @returns {Object} Key with decrypted value
 */
export async function getManagementKey(keyId) {
  const key = await prisma.managementKey.findFirst({
    where: { id: keyId }
  });

  if (!key) return null;

  return {
    id: key.id,
    accountId: key.accountId,
    key: decrypt(key.encryptedKey),
    name: key.name,
    status: key.status,
    metadata: key.metadata ? JSON.parse(key.metadata) : null,
    lastUsedAt: key.lastUsedAt,
    createdAt: key.createdAt
  };
}

/**
 * Get the best (most recently used or newest) management key for an account
 * @param {string} accountId
 * @returns {Object|null} Best key with decrypted value, or null if none
 */
export async function getBestManagementKey(accountId) {
  // First try to find an active key that was recently used
  let key = await prisma.managementKey.findFirst({
    where: { accountId, status: 'active' },
    orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }]
  });
  
  // If no used key, get the newest active key
  if (!key) {
    key = await prisma.managementKey.findFirst({
      where: { accountId, status: 'active' },
      orderBy: { createdAt: 'desc' }
    });
  }
  
  if (!key) return null;

  return {
    id: key.id,
    accountId: key.accountId,
    key: decrypt(key.encryptedKey),
    name: key.name,
    status: key.status,
    metadata: key.metadata ? JSON.parse(key.metadata) : null,
    lastUsedAt: key.lastUsedAt,
    createdAt: key.createdAt
  };
}

/**
 * Mark a key as used (update lastUsedAt)
 * @param {string} keyId
 */
export async function markKeyUsed(keyId) {
  await prisma.managementKey.update({
    where: { id: keyId },
    data: {
      lastUsedAt: new Date(),
      updatedAt: new Date()
    }
  });
}

/**
 * Revoke/delete a management key
 * @param {string} keyId
 */
export async function revokeManagementKey(keyId) {
  await prisma.managementKey.update({
    where: { id: keyId },
    data: {
      status: 'revoked',
      updatedAt: new Date()
    }
  });
}

/** Alias for getBestManagementKey — kept for call-site compat. */
export const getBestKey = getBestManagementKey;

/**
 * Check if account has any active keys
 * @param {string} accountId
 * @returns {boolean}
 */
export async function hasManagementKey(accountId) {
  const count = await prisma.managementKey.count({
    where: {
      accountId,
      status: 'active'
    }
  });
  return count > 0;
}

/**
 * Provision and store a new key in one operation
 * @param {string} deviceId
 * @param {string} accountId
 * @param {string} name
 */
export async function provisionAndStoreKey(deviceId, accountId, name) {
  // Import dashboard API
  const { createManagementKey } = await import('./dashboard-api.js');

  // Create key via Playwright
  const result = await createManagementKey(deviceId, accountId, name);

  if (!result.key) {
    throw new Error(`Provisioning failed: ${result.message}`);
  }

  // Store it
  const stored = await storeManagementKey(accountId, result.key, name, {
    provisionedAt: new Date().toISOString(),
    via: result.source ?? 'unknown'
  });

  return {
    ...stored,
    key: result.key // Include full key in response
  };
}
