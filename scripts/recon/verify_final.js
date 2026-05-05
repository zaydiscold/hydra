import { prisma } from './server/services/db.js';
import * as store from './server/services/store.js';
async function verify() {
  const user = await prisma.user.findFirst();
  if (!user) return console.log('No user');

  // Verify Master Key Format
  const masterKey = await store.getMasterProxyKey(user.id);
  console.log('Master Key:', masterKey);
  if (masterKey.startsWith('sk-hydra-')) {
    console.log('✅ Master key format correct');
  } else {
    console.log('❌ Master key format wrong!');
  }

  // Verify can decrypt a key
  const accs = await store.getAllAccountsWithKeys(user.id);
  if (!accs.length) {
    console.log('No accounts found, skipping local key decryption check');
    return;
  }
  const poolData = await store.getLocalKeys(user.id, accs[0].id);
  console.log('Local key count:', poolData.length);
  if (poolData[0]?.key) {
    console.log('✅ Key decryption working');
  }

  // Mock Request for model refresh
  const req = { user: { id: user.id } };
  const res = {
    status: (s) => ({
      json: (d) => console.log('Refresh Status:', s, 'Count:', d.data?.count)
    }),
    json: (d) => console.log('JSON:', d.success)
  };
  
  // Note: refreshModels requires an active key in pool... 
  // I won't run it here to avoid real API calls in verification if possible, 
  // but I verified the endpoint code exists.
}

verify().then(() => process.exit(0));
