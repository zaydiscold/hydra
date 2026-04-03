import fetch from 'node-fetch';

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}/api`;

async function test() {
  console.log('--- Testing Fresh Start & Account Creation ---');

  // 1. Signup
  console.log('1. Signing up admin...');
  const signupResponse = await fetch(`${BASE_URL}/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'testpassword' }),
  });
  const signupData = await signupResponse.json();
  if (!signupData.success) {
    console.error('Signup failed:', signupData.error);
    process.exit(1);
  }
  const token = signupData.data.token;
  console.log('Signup success. Token received.');

  // 2. Add Account (Manual Management Key)
  console.log('2. Adding static management key account...');
  const addAccountResponse = await fetch(`${BASE_URL}/accounts`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ 
      alias: 'test-account', 
      managementKey: 'sk-or-mgmt-fake-key-for-testing' 
    }),
  });
  const addAccountData = await addAccountResponse.json();
  
  if (addAccountData.success) {
    console.log('SUCCESS: Account created without Prisma error!');
  } else {
    console.error('FAILURE: Account creation failed:', addAccountData.error);
    if (addAccountData.error.includes('prisma')) {
      console.error('PRISMA ERROR DETECTED!');
    }
    process.exit(1);
  }

  console.log('--- Verification Complete ---');
}

test().catch(err => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
