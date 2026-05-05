
import { prisma } from './server/services/db.js';
import { decryptConfig } from './server/services/storage-codec.js';

async function audit() {
  const accounts = await prisma.account.findMany({
    include: {
      managementKeys: true
    }
  });

  console.log('--- Account Audit ---');
  for (const acc of accounts) {
    let config = {};
    try {
      config = decryptConfig(acc.config);
    } catch (e) {
      console.log(`[ERROR] Failed to decrypt config for ${acc.alias}`);
    }
    
    console.log(`Alias: ${acc.alias}`);
    console.log(`  Last Login: ${config.lastLoginAt}`);
    console.log(`  Pending: ${config.pendingVerification}`);
    console.log(`  Auth Method: ${config.authMethod}`);
    console.log(`  Mgmt Keys Count: ${acc.managementKeys?.length || 0}`);
    console.log('-------------------');
  }
  process.exit(0);
}

audit().catch(err => {
  console.error(err);
  process.exit(1);
});
