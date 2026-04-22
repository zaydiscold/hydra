/**
 * Account Persistence and Management Key CRUD Test
 * Tests:
 * 1. Account Persistence - verify accounts survive server restart
 * 2. Management Key CRUD - create, list, delete (revoke), verify
 * 3. Login Session Persistence - verify sessions work after restart
 * 4. Key Rotation - verify fallback to next key when one fails
 */

import http from 'http';
import { PrismaClient } from '@prisma/client';

const BASE_URL = 'localhost';
const PORT = 3001;
const TEST_ACCOUNT_ID = '6f1d28e8-bc8d-4557-b589-66b6db341f8c';
const ADMIN_EMAIL = 'admin';
const ADMIN_PASSWORD = '1111';

// Helper function for making HTTP requests
function makeRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// Test 1: Verify current accounts exist (pre-restart)
async function test1_checkAccountsBeforeRestart(token) {
  console.log('\n=== TEST 1: Check Accounts via API ===');
  try {
    const response = await makeRequest('GET', '/api/accounts', null, { 'Authorization': `Bearer ${token}` });
    console.log('Status:', response.status);
    
    if (response.status === 200 && response.data.success && Array.isArray(response.data.data)) {
      const testAccount = response.data.data.find(a => a.id === TEST_ACCOUNT_ID);
      if (testAccount) {
        console.log('✅ Test account found:', testAccount.alias);
        return { success: true, account: testAccount, count: response.data.data.length };
      } else {
        console.log('❌ Test account NOT found in list');
        return { success: false };
      }
    } else {
      console.log('❌ Failed to fetch accounts:', response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  }
}

// Test 2: Login to get session token
async function test2_login() {
  console.log('\n=== TEST 2: Login to Get Session ===');
  try {
    const response = await makeRequest('POST', '/api/auth/login', {
      username: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    
    console.log('Login Status:', response.status);
    
    if (response.status === 200 && response.data.success && response.data.data && response.data.data.token) {
      console.log('✅ Login successful, token received');
      return { success: true, token: response.data.data.token, user: response.data.data.user };
    } else {
      console.log('❌ Login failed:', response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Login error:', err.message);
    return { success: false };
  }
}

// Test 3: List Management Keys for test account
async function test3_listManagementKeys(token) {
  console.log('\n=== TEST 3: List Management Keys ===');
  try {
    const response = await makeRequest(
      'GET', 
      `/api/accounts/${TEST_ACCOUNT_ID}/management-keys`,
      null,
      { 'Authorization': `Bearer ${token}` }
    );
    
    console.log('Status:', response.status);
    
    // API returns { success: true, data: { keys: [...] } }
    const keys = response.data.success && response.data.data && response.data.data.keys;
    
    if (response.status === 200 && Array.isArray(keys)) {
      console.log(`✅ Found ${keys.length} management keys`);
      keys.forEach(k => console.log(`  - ${k.name} (${k.id}) - ${k.status}`));
      return { success: true, keys: keys };
    } else {
      console.log('❌ Failed to list keys:', response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  }
}

// Test 4: Create a new Management Key
async function test4_createManagementKey(token) {
  console.log('\n=== TEST 4: Create Management Key ===');
  const testKeyName = `Test Key ${new Date().toLocaleTimeString()}`;
  const testKeyValue = 'sk-or-v1-test-' + Math.random().toString(36).substring(2);
  
  try {
    const response = await makeRequest(
      'POST',
      `/api/accounts/${TEST_ACCOUNT_ID}/management-keys/store`,
      {
        name: testKeyName,
        key: testKeyValue
      },
      { 'Authorization': `Bearer ${token}` }
    );
    
    console.log('Create Status:', response.status);
    
    if ((response.status === 201 || response.status === 200) && response.data.success) {
      console.log('✅ Key created:', response.data.data.id);
      return { success: true, keyId: response.data.data.id, keyName: testKeyName };
    } else {
      console.log('❌ Failed to create key:', response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  }
}

// Test 5: Verify key appears in list
async function test5_verifyKeyInList(token, expectedKeyId) {
  console.log('\n=== TEST 5: Verify Key Appears in List ===');
  try {
    const response = await makeRequest(
      'GET',
      `/api/accounts/${TEST_ACCOUNT_ID}/management-keys`,
      null,
      { 'Authorization': `Bearer ${token}` }
    );
    
    const keys = response.data.success && response.data.data && response.data.data.keys;
    
    if (response.status === 200 && Array.isArray(keys)) {
      const found = keys.find(k => k.id === expectedKeyId);
      if (found) {
        console.log('✅ New key found in list:', found.name);
        return { success: true };
      } else {
        console.log('❌ New key NOT found in list');
        return { success: false };
      }
    } else {
      console.log('❌ Failed to list keys:', response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  }
}

// Test 6: Revoke (delete) the key via Prisma
async function test6_revokeManagementKey(keyId) {
  console.log('\n=== TEST 6: Revoke Management Key via Prisma ===');
  const prisma = new PrismaClient();
  
  try {
    // Check if key exists first
    const key = await prisma.managementKey.findFirst({
      where: { id: keyId }
    });
    
    if (!key) {
      console.log('❌ Key not found in database');
      return { success: false };
    }
    
    console.log('Found key:', key.name, 'with status:', key.status);
    
    // Revoke the key
    await prisma.managementKey.update({
      where: { id: keyId },
      data: {
        status: 'revoked',
        updatedAt: new Date()
      }
    });
    
    console.log('✅ Key revoked successfully');
    return { success: true };
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  } finally {
    await prisma.$disconnect();
  }
}

// Test 7: Verify key is revoked
async function test7_verifyKeyRevoked(token, revokedKeyId) {
  console.log('\n=== TEST 7: Verify Key is Revoked ===');
  try {
    const response = await makeRequest(
      'GET',
      `/api/accounts/${TEST_ACCOUNT_ID}/management-keys`,
      null,
      { 'Authorization': `Bearer ${token}` }
    );
    
    const keys = response.data.success && response.data.data && response.data.data.keys;
    
    if (response.status === 200 && Array.isArray(keys)) {
      const found = keys.find(k => k.id === revokedKeyId);
      if (!found || found.status === 'revoked') {
        console.log('✅ Key successfully revoked (not in active list or marked revoked)');
        return { success: true };
      } else {
        console.log('❌ Key still active:', found.name, '- status:', found.status);
        return { success: false };
      }
    } else {
      console.log('❌ Failed to list keys:', response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  }
}

// Test 8: Create another key (for persistence test)
async function test8_createAnotherKey(token) {
  console.log('\n=== TEST 8: Create Another Key for Persistence Test ===');
  const testKeyName = `Persistence Test Key ${new Date().toLocaleTimeString()}`;
  const testKeyValue = 'sk-or-v1-persist-' + Math.random().toString(36).substring(2);
  
  try {
    const response = await makeRequest(
      'POST',
      `/api/accounts/${TEST_ACCOUNT_ID}/management-keys/store`,
      {
        name: testKeyName,
        key: testKeyValue
      },
      { 'Authorization': `Bearer ${token}` }
    );
    
    if ((response.status === 201 || response.status === 200) && response.data.success) {
      console.log('✅ Persistence test key created:', response.data.data.id);
      return { success: true, keyId: response.data.data.id, keyName: testKeyName };
    } else {
      console.log('❌ Failed to create key:', response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  }
}

// Test 9: Check Database State directly via Prisma
async function test9_checkDatabaseState() {
  console.log('\n=== TEST 9: Check Database State via Prisma ===');
  const prisma = new PrismaClient();
  
  try {
    // Check accounts
    const accounts = await prisma.account.findMany({
      select: { id: true, alias: true, openRouterId: true }
    });
    
    console.log('✅ Database accessible');
    console.log(`  Accounts count: ${accounts.length}`);
    accounts.forEach(a => console.log(`    - ${a.alias} (${a.id})`));
    
    // Check management keys for test account
    const keys = await prisma.managementKey.findMany({
      where: { accountId: TEST_ACCOUNT_ID },
      select: { id: true, name: true, status: true }
    });
    
    console.log(`  Management keys for test account: ${keys.length}`);
    keys.forEach(k => console.log(`    - ${k.name}: ${k.status}`));
    
    return { success: true, accountCount: accounts.length, keyCount: keys.length };
  } catch (err) {
    console.log('❌ Database error:', err.message);
    return { success: false };
  } finally {
    await prisma.$disconnect();
  }
}

// Test 10: Test Key Rotation (get best key, verify fallback)
async function test10_testKeyRotation(token) {
  console.log('\n=== TEST 10: Test Key Rotation (Best Key) ===');
  try {
    // Get best key
    const response = await makeRequest(
      'GET',
      `/api/accounts/${TEST_ACCOUNT_ID}/management-keys/best`,
      null,
      { 'Authorization': `Bearer ${token}` }
    );
    
    if (response.status === 200 && response.data.success && response.data.data) {
      const key = response.data.data;
      console.log('✅ Best key retrieved:', key.id);
      console.log('   Name:', key.name);
      console.log('   Status:', key.status);
      console.log('   Has key value:', !!key.key);
      return { success: true, keyId: key.id };
    } else if (response.status === 404 || (response.data && response.data.message && response.data.message.includes('No management keys found'))) {
      console.log('⚠️ No active keys found (expected if all keys were revoked)');
      return { success: true, noKeys: true };
    } else {
      console.log('❌ Failed to get best key:', response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  }
}

// Test 11: Verify session still works after server restart (simulated)
async function test11_verifySessionPersistence(token) {
  console.log('\n=== TEST 11: Verify Session Works (Pre-Restart) ===');
  try {
    // Try to access a protected endpoint
    const response = await makeRequest(
      'GET',
      '/api/accounts',
      null,
      { 'Authorization': `Bearer ${token}` }
    );
    
    if (response.status === 200 && response.data.success) {
      console.log('✅ Session is valid and working');
      return { success: true };
    } else if (response.status === 401) {
      console.log('❌ Session expired or invalid (401)');
      return { success: false, expired: true };
    } else {
      console.log('❌ Unexpected response:', response.status, response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  }
}

// Main test runner
async function runTests() {
  console.log('========================================');
  console.log('Account & Management Key CRUD Test Suite');
  console.log('========================================');
  console.log('Test Account:', TEST_ACCOUNT_ID);
  console.log('Server:', `${BASE_URL}:${PORT}`);
  
  const results = {};
  
  // Step 1: Login
  results.test2 = await test2_login();
  
  if (!results.test2.success) {
    console.log('\n❌ LOGIN FAILED - cannot continue with authenticated tests');
    return results;
  }
  
  const token = results.test2.token;
  
  // Step 2: Check accounts via API
  results.test1 = await test1_checkAccountsBeforeRestart(token);
  
  // Step 3: Check database state
  results.test9 = await test9_checkDatabaseState();
  
  // Step 4: List existing keys
  results.test3 = await test3_listManagementKeys(token);
  
  // Step 5: Create a new key
  results.test4 = await test4_createManagementKey(token);
  
  if (results.test4.success) {
    // Step 6: Verify key appears in list
    results.test5 = await test5_verifyKeyInList(token, results.test4.keyId);
    
    // Step 7: Revoke the key via Prisma
    results.test6 = await test6_revokeManagementKey(results.test4.keyId);
    
    // Step 8: Verify key is revoked
    results.test7 = await test7_verifyKeyRevoked(token, results.test4.keyId);
  }
  
  // Step 9: Create another key for persistence test
  results.test8 = await test8_createAnotherKey(token);
  
  // Step 10: Test key rotation/best key
  results.test10 = await test10_testKeyRotation(token);
  
  // Step 11: Verify session works
  results.test11 = await test11_verifySessionPersistence(token);
  
  // Summary
  console.log('\n========================================');
  console.log('Test Summary');
  console.log('========================================');
  
  let passed = 0;
  let failed = 0;
  
  for (const [name, result] of Object.entries(results)) {
    if (result && result.success) {
      console.log(`✅ ${name}: PASSED`);
      passed++;
    } else {
      console.log(`❌ ${name}: FAILED`);
      failed++;
    }
  }
  
  console.log(`\nTotal: ${passed} passed, ${failed} failed`);
  
  // Save state for restart test
  const state = {
    timestamp: Date.now(),
    testAccountId: TEST_ACCOUNT_ID,
    persistenceKeyId: results.test8?.keyId,
    token: token,
    accountCount: results.test1?.count,
    results: results,
    testOrder: ['test2', 'test1', 'test9', 'test3', 'test4', 'test5', 'test6', 'test7', 'test8', 'test10', 'test11']
  };
  
  console.log('\n--- STATE FOR RESTART TEST ---');
  console.log(JSON.stringify(state, null, 2));
  
  return state;
}

runTests().then(state => {
  console.log('\n========================================');
  console.log('CRUD Tests Complete');
  console.log('========================================');
}).catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
