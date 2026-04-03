import { prisma } from './db.js';
import { decrypt } from './storage-codec.js';

import { config } from '../config.js';
import { logger } from './logger.js';
import { nukeSystem } from './auth.js';

async function hasLegacyVaultSecretColumn() {
  const columns = await prisma.$queryRawUnsafe(`PRAGMA table_info("User")`);
  return Array.isArray(columns) && columns.some((column) => column.name === 'vaultSecret');
}

async function hasUnreadableLegacyCiphertext() {
  const account = await prisma.account.findFirst({
    select: { config: true, sessionToken: true },
  });

  if (account?.config) {
    try {
      JSON.parse(decrypt(account.config));
    } catch {
      return true;
    }
  }

  if (account?.sessionToken) {
    try {
      decrypt(account.sessionToken);
    } catch {
      return true;
    }
  }

  const keyRecord = await prisma.key.findFirst({
    where: { key: { not: null } },
    select: { key: true },
  });

  if (keyRecord?.key) {
    try {
      decrypt(keyRecord.key);
    } catch {
      return true;
    }
  }

  return false;
}

export async function enforceLegacyStorageReset() {
  const legacySchema = await hasLegacyVaultSecretColumn();
  const unreadableCiphertext = legacySchema ? false : await hasUnreadableLegacyCiphertext();
  if (!legacySchema && !unreadableCiphertext) return;

  if (config.HYDRA_RESET_LEGACY_STORAGE) {
    logger.warn('[STORAGE] Legacy local storage detected. Wiping local data because HYDRA_RESET_LEGACY_STORAGE is enabled.');
    await nukeSystem();
    throw new Error('Legacy Hydra storage was reset. Restart the server and create fresh account data.');
  }

  throw new Error(
    legacySchema
      ? 'Legacy Hydra encryption schema detected. Run `npx prisma migrate deploy` or `npx prisma db push --accept-data-loss` first. '
          + 'If you want a one-time local reset instead of preserving old data, restart with HYDRA_RESET_LEGACY_STORAGE=1.'
      : 'Legacy Hydra encrypted account data is unreadable with the simplified local storage model. '
          + 'Restart with HYDRA_RESET_LEGACY_STORAGE=1 to wipe and recreate local account data.'
  );
}
