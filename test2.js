import { prisma } from './server/services/db.js';
import * as store from './server/services/store.js';

const BASE_URL = 'https://openrouter.ai/api/v1';

async function run() {
  const u = await prisma.user.findFirst();
  const accs = await store.getAllAccountsWithKeys(u.id);
  const mgmt = accs.find(a => a.managementKey)?.managementKey;
  if (!mgmt) { console.log('no mgmt key'); return }

  const res = await fetch(`${BASE_URL}/keys`, { headers: { 'Authorization': `Bearer ${mgmt}` } });
  const data = await res.json();
  const keyToEdit = data.data.find(k => k.name === 'test' || k.name === 'QWE');
  if(!keyToEdit) {
    console.log('could not find key to edit, trying first one');
  }
  const hash = keyToEdit ? keyToEdit.hash : data.data[0].hash;
  console.log(`Trying to edit hash: ${hash}`);

  const patchRes = await fetch(`${BASE_URL}/keys/${hash}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${mgmt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'test-renamed' })
  });
  console.log('PATCH response:', patchRes.status, await patchRes.text());

  const putRes = await fetch(`${BASE_URL}/keys/${hash}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${mgmt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'test-renamed' })
  });
  console.log('PUT response:', putRes.status, await putRes.text());
}
run().then(()=>process.exit(0));
