import { prisma } from './server/services/db.js';
import * as store from './server/services/store.js';

const BASE_URL = 'https://openrouter.ai/api/v1';

async function run() {
  const u = await prisma.user.findFirst();
  const accs = await store.getAllAccountsWithKeys(u.id);
  const mgmt = accs.find(a => a.managementKey)?.managementKey;
  if (!mgmt) { console.log('no mgmt key'); return }

  const hash = '38baaa48d360685d140fd5dfe39876732e4394b0957bf1cbeb988cbf6b16fea8'; // from previous run

  const patchRes = await fetch(`${BASE_URL}/keys/${hash}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${mgmt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  console.log('PATCH {} response:', patchRes.status, await patchRes.text());
}
run().then(()=>process.exit(0));
