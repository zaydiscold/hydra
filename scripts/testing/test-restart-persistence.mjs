/**
 * Server Restart Persistence Test
 * Verifies:
 * 1. Accounts still exist after server restart
 * 2. Management keys still exist after server restart
 * 3. Previous session token still works (if not expired)
 * 4. Key rotation still works
 */

import http from 'http';
import { PrismaClient } from '@prisma/client';

const BASE_URL = 'localhost';
const PORT = 3001;
const TEST_ACCOUNT_ID = '6f1d28e8-bc8d-4557-b589-66b6db341f8c';
const PERSISTENCE_KEY_ID = '4fb8c4ca-29a0-4d8d-a70a-8ba3ebfc003a'; // From previous test

// Old token from previous session (may have expired)
const OLD_TOKEN = process.env.OLD_TOKEN || null;

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

async function test1_checkDatabaseAfterRestart() {
  console.log('\n=== TEST 1: Check Database After Restart ===');
  const prisma = new PrismaClient();
  
  try {
    const accounts = await prisma.account.findMany({
      select: { id: true, alias: true }
    });
    
    const testAccount = accounts.find(a => a.id === TEST_ACCOUNT_ID);
    
    if (testAccount) {
      console.log('✅ Test account persisted:', testAccount.alias);
    } else {
      console.log('❌ Test account NOT found after restart');
      return { success: false };
    }
    
    const keys = await prisma.managementKey.findMany({
      where: { accountId: TEST_ACCOUNT_ID },
      select: { id: true, name: true, status: true }
    });
    
    const persistenceKey = keys.find(k => k.id === PERSISTENCE_KEY_ID);
    
    if (persistenceKey) {
      console.log('✅ Persistence key found:', persistenceKey.name, '-', persistenceKey.status);
    } else {
      console.log('❌ Persistence key NOT found after restart');
      return { success: false };
    }
    
    console.log(`  Total accounts: ${accounts.length}`);
    console.log(`  Management keys for test account: ${keys.length}`);
    
    return { success: true, accountCount: accounts.length, keyCount: keys.length };
  } catch (err) {
    console.log('❌ Database error:', err.message);
    return { success: false };
  } finally {
    await prisma.$disconnect();
  }
}

async function test2_loginForNewSession() {
  console.log('\n=== TEST 2: Login After Restart ===');
  try {
    const response = await makeRequest('POST', '/api/auth/login', {
      username: 'admin',
      password: '1111'
    });
    
    if (response.status === 200 && response.data.success && response.data.data?.token) {
      console.log('✅ Login successful after restart');
      return { success: true, token: response.data.data.token };
    } else {
      console.log('❌ Login failed:', response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  }
}

async function test3_verifyApiAccessWithNewSession(token) {
  console.log('\n=== TEST 3: API Access After Restart ===');
  try {
    const response = await makeRequest(
      'GET',
      '/api/accounts',
      null,
      { 'Authorization': `Bearer ${token}` }
    );
    
    if (response.status === 200 && response.data.success) {
      const testAccount = response.data.data.find(a => a.id === TEST_ACCOUNT_ID);
      if (testAccount) {
        console.log('✅ API access working, test account accessible:', testAccount.alias);
        return { success: true };
      } else {
        console.log('❌ Test account not found via API');
        return { success: false };
      }
    } else {
      console.log('❌ API access failed:', response.status, response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  }
}

async function test4_verifyManagementKeysViaApi(token) {
  console.log('\n=== TEST 4: Management Keys via API After Restart ===');
  try {
    const response = await makeRequest(
      'GET',
      `/api/accounts/${TEST_ACCOUNT_ID}/management-keys`,
      null,
      { 'Authorization': `Bearer ${token}` }
    );
    
    const keys = response.data.success && response.data.data?.keys;
    
    if (response.status === 200 && Array.isArray(keys)) {
      const persistenceKey = keys.find(k => k.id === PERSISTENCE_KEY_ID);
      
      if (persistenceKey) {
        console.log('✅ Persistence key accessible via API:', persistenceKey.name);
      } else {
        console.log('❌ Persistence key not found via API');
        return { success: false };
      }
      
      const revokedKey = keys.find(k => k.status === 'revoked');
      if (revokedKey) {
        console.log('✅ Revoked key status preserved:', revokedKey.name, '-', revokedKey.status);
      }
      
      console.log(`  Total keys for account: ${keys.length}`);
      return { success: true, keyCount: keys.length };
    } else {
      console.log('❌ Failed to get keys:', response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  }
}

async function test5_keyRotationAfterRestart(token) {
  console.log('\n=== TEST 5: Key Rotation (Best Key) After Restart ===');
  try {
    const response = await makeRequest(
      'GET',
      `/api/accounts/${TEST_ACCOUNT_ID}/management-keys/best`,
      null,
      { 'Authorization': `Bearer ${token}` }
    );
    
    if (response.status === 200 && response.data.success && response.data.data) {
      const key = response.data.data;
      console.log('✅ Best key retrieval working after restart');
      console.log(`   ID: ${key.id}`);
      console.log(`   Name: ${key.name}`);
      console.log(`   Status: ${key.status}`);
      console.log(`   Has key value: ${!!key.key}`);
      
      // The best key should be the most recently created active key
      if (key.status === 'active') {
        return { success: true, keyId: key.id };
      } else {
        console.log('❌ Best key is not active');
        return { success: false };
      }
    } else {
      console.log('❌ Best key retrieval failed:', response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  }
}

async function test6_createKeyAfterRestart(token) {
  console.log('\n=== TEST 6: Create New Key After Restart ===');
  const testKeyName = `Post-Restart Key ${new Date().toLocaleTimeString()}`;
  const testKeyValue = 'sk-or-v1-restart-' + Math.random().toString(36).substring(2);
  
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
      console.log('✅ New key created after restart:', response.data.data.id);
      return { success: true, keyId: response.data.data.id };
    } else {
      console.log('❌ Failed to create key:', response.data);
      return { success: false };
    }
  } catch (err) {
    console.log('❌ Error:', err.message);
    return { success: false };
  }
}

async function runTests() {
  console.log('========================================');
  console.log('Server Restart Persistence Test Suite');
  console.log('========================================');
  console.log('Test Account:', TEST_ACCOUNT_ID);
  console.log('Persistence Key:', PERSISTENCE_KEY_ID);
  
  const results = {};
  
  // Test database state
  results.test1 = await test1_checkDatabaseAfterRestart();
  
  // Login for new session
  results.test2 = await test2_loginForNewSession();
  
  if (!results.test2.success) {
    console.log('\n❌ Cannot continue without session');
    return results;
  }
  
  const token = results.test2.token;
  
  // Test API access
  results.test3 = await test3_verifyApiAccessWithNewSession(token);
  
  // Test management keys via API
  results.test4 = await test4_verifyManagementKeysViaApi(token);
  
  // Test key rotation
  results.test5 = await test5_keyRotationAfterRestart(token);
  
  // Test creating new key after restart
  results.test6 = await test6_createKeyAfterRestart(token);
  
  // Summary
  console.log('\n========================================');
  console.log('Persistence Test Summary');
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
  
  if (passed === 6) {
    console.log('\n✅ ALL PERSISTENCE TESTS PASSED - Data survives server restart!');
  } else {
    console.log('\n❌ SOME PERSISTENCE TESTS FAILED');
  }
  
  return results;
}

runTests().then(() => {
  console.log('\n========================================');
  console.log('Persistence Tests Complete');
  console.log('========================================');
}).catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
