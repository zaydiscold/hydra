
import { db } from '../../server/db/index.js';
import { decryptConfig } from '../../server/services/storage-codec.js';

async function audit() {
  const accounts = await db('accounts').select('alias', 'email', 'lastLoginAt', 'pendingVerification', 'config');
  console.log('--- Account Audit ---');
  for (const acc of accounts) {
    let hasMgmtKey = false;
    try {
      const config = decryptConfig(acc.config);
      hasMgmtKey = !!config.managementKey || !!config.secretKey;
    } catch(e) {}
    
    console.log(`Alias: ${acc.alias}`);
    console.log(`  Email: ${acc.email}`);
    console.log(`  Last Login: ${acc.lastLoginAt}`);
    console.log(`  Pending: ${acc.pendingVerification}`);
    console.log(`  Has Key in Config: ${hasMgmtKey}`);
    console.log('-------------------');
  }
  process.exit(0);
}

audit();
