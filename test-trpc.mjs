import { createManagementKey } from './server/services/dashboard-api.js';
import * as store from './server/services/store.js';

const userId = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const accountId = '27f1bd77-1f5f-4c94-bbf1-91e23dcbb24e';

console.log('Manual tRPC test...');

const result = await createManagementKey(userId, accountId);
console.log('Result:', result);
