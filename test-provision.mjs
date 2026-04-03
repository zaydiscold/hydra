import { createManagementKey } from './server/services/dashboard-api.js';
import * as store from './server/services/store.js';

const userId = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const accountId = '409dc5b2-9a05-4850-99d4-ebcea164368d';

console.log('========================================');
console.log('MANUAL PROVISION TRACE');
console.log('========================================');

try {
  // Get account
  const account = await store.getAccountWithKey(userId, accountId);
  console.log('Account found:', account.id);
  console.log('Email:', account.email);
  console.log('Has clientCookie:', !!account.clientCookie);
  console.log('Has sessionCookie:', !!account.sessionCookie);
  console.log('Session expiry:', account.sessionExpiry);
  
  // Check if session is expired
  if (account.sessionExpiry) {
    const expiry = new Date(account.sessionExpiry).getTime();
    const now = Date.now();
    console.log('Time until expiry:', Math.floor((expiry - now) / 1000), 'seconds');
    if (expiry < now) {
      console.log('❌ SESSION EXPIRED!');
    } else {
      console.log('✅ Session still valid');
    }
  }
  
  // Try to create management key
  console.log('\nCalling createManagementKey...');
  const result = await createManagementKey(userId, accountId);
  console.log('\nResult:', result);
  
} catch (err) {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
}
