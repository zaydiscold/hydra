import { prisma } from './server/services/db.js';
import * as store from './server/services/store.js';
import * as openrouter from './server/services/openrouter.js';

async function run() {
  const u = await prisma.user.findFirst();
  const accs = await store.getAllAccountsWithKeys(u.id);
  const mgmt = accs.find(a => a.managementKey)?.managementKey;
  if (!mgmt) { console.log("No mgmt key"); return }
  const keys = await openrouter.listKeys(mgmt);
  console.log(JSON.stringify(keys.slice(0,1), null, 2));
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
