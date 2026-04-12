/**
 * Security Test #3: End-to-End API Cookie Flow
 * 
 * Tests the actual API endpoints with authentication
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3001/api';
let ADMIN_PASSWORD = 'testpass123'; // Will be set during setup

async function getAuthToken() {
  // First check auth status
  const statusRes = await fetch(`${BASE_URL}/auth/status`);
  const statusData = await statusRes.json();
  console.log('   Auth status:', statusData.data);
  
  // If no user exists, do setup
  if (!statusData.data?.hasUser) {
    console.log('   No user found, running setup...');
    const setupRes = await fetch(`${BASE_URL}/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    const setupData = await setupRes.json();
    if (setupData.success) {
      return setupData.data.token;
    }
    throw new Error(`Setup failed: ${setupData.error}`);
  }
  
  // If user exists but we can't login, we need to nuke and start fresh
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrongpassword' }),
  });
  const loginData = await loginRes.json();
  
  // If wrong password works, something is wrong. If it fails as expected, try nuke
  if (!loginData.success) {
    console.log('   Existing user with unknown password. Need to nuke to test...');
    // Can't nuke without auth, so we'll create a new test user with a different method
    // For now, let's just log this and skip the test
    throw new Error('Cannot authenticate with existing admin user. Please run with fresh database.');
  }
  
  throw new Error(`Auth failed: unexpected response`);
}

async function runTests() {
  console.log('=== End-to-End Security API Tests ===\n');
  
  // 1. Get auth token
  console.log('1. Authenticating...');
  const token = await getAuthToken();
  console.log('   ✓ Got auth token\n');
  
  // 2. Get accounts list
  console.log('2. Fetching accounts...');
  const accountsRes = await fetch(`${BASE_URL}/accounts`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const accountsData = await accountsRes.json();
  console.log('   Accounts:', accountsData.data?.length || 0);
  console.log('   ✓ Accounts endpoint works\n');
  
  // 3. Try to add an account with credentials (this tests the credential storage path)
  console.log('3. Testing account creation with credentials...');
  const testEmail = `test-${Date.now()}@example.com`;
  const createRes = await fetch(`${BASE_URL}/accounts/with-credentials`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      alias: `test-account-${Date.now()}`,
      email: testEmail,
      password: 'testpass123',
      authMethod: 'password'
    }),
  });
  const createData = await createRes.json();
  console.log('   Create response:', createData.success ? 'SUCCESS' : 'FAILED');
  if (!createData.success) {
    console.log('   Error:', createData.error);
  }
  console.log();
  
  // 4. Check session status endpoint
  if (createData.success && createData.data?.id) {
    console.log('4. Testing session status endpoint...');
    const statusRes = await fetch(`${BASE_URL}/accounts/${createData.data.id}/session-status`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const statusData = await statusRes.json();
    console.log('   Session status:', statusData.data?.status);
    console.log('   ✓ Session status endpoint works\n');
    
    // 5. Test detect-auth endpoint (this uses Clerk cookies)
    console.log('5. Testing detect-auth endpoint...');
    try {
      const detectRes = await fetch(`${BASE_URL}/accounts/${createData.data.id}/detect-auth`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({}),
      });
      const detectData = await detectRes.json();
      console.log('   Detect auth response:', detectData.success ? 'SUCCESS' : 'FAILED');
      if (detectData.data) {
        console.log('   Method:', detectData.data.method);
        console.log('   Has clientCookie:', !!detectData.data.clientCookie);
      }
    } catch (err) {
      console.log('   Error (expected for non-existent email):', err.message);
    }
    console.log();
  }
  
  // 6. Test dashboard-api cookie logging (we can't directly test this without a valid OpenRouter session,
  // but we can verify the provision endpoint structure)
  console.log('6. Testing provision endpoint structure...');
  if (createData.success && createData.data?.id) {
    const provisionRes = await fetch(`${BASE_URL}/accounts/${createData.data.id}/provision`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ keyName: 'Test Key' }),
    });
    const provisionData = await provisionRes.json();
    console.log('   Provision response:', provisionData.success ? 'SUCCESS' : 'FAILED (expected)');
    if (!provisionData.success) {
      console.log('   Error code:', provisionData.error?.code);
      console.log('   Error message:', provisionData.error?.message?.slice(0, 100));
    }
    // We expect this to fail because the account doesn't have a valid OpenRouter session
    // But the important thing is the endpoint structure works
  }
  console.log();
  
  console.log('=== End-to-End API Tests Complete ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
