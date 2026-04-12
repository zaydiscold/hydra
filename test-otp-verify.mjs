import { completeEmailOTP } from './server/services/clerk-auth.js';
import * as store from './server/services/store.js';

const signInId = 'sia_3BrbmarXchWLHNEua0MZuJWkwaR';
const code = '349009';
const clientCookie = '__client=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...'; // This would be from the stored value

console.log('Testing completeEmailOTP...');
console.log('signInId:', signInId);
console.log('code:', code);

// Get the stored client cookie from the account
try {
  const account = await store.getAccountWithKey('26d94c8c-5294-4841-855c-2ae12d4490fe', '409dc5b2-9a05-4850-99d4-ebcea164368d');
  console.log('Account found');
  console.log('Stored clientCookie:', account.clientCookie ? account.clientCookie.slice(0, 80) + '...' : 'NONE');
  
  if (account.clientCookie) {
    console.log('\nCalling completeEmailOTP...');
    const session = await completeEmailOTP(signInId, code, account.clientCookie);
    console.log('\n✅ Session result:');
    console.log('sessionCookie:', session.sessionCookie ? session.sessionCookie.slice(0, 50) + '...' : 'NONE');
    console.log('clientCookie:', session.clientCookie ? session.clientCookie.slice(0, 50) + '...' : 'NONE');
    console.log('sessionExpiry:', session.sessionExpiry);
  } else {
    console.log('No clientCookie stored - OTP start didn\'t save it');
  }
} catch (err) {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
}
