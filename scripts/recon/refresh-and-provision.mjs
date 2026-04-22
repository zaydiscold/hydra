#!/usr/bin/env node
/**
 * Try to refresh sessions and then provision fresh keys
 */

import axios from 'axios';
import { prisma } from './server/services/db.js';
import { decrypt } from './server/services/storage-codec.js';

const API_BASE = 'http://localhost:3001/api';
const ADMIN_PASSWORD = '1111';

const ACCOUNTS = [
  { id: '6f1d28e8-bc8d-4557-b589-66b6db341f8c', alias: 'admin@zayd.world' },
  { id: 'cecff6a9-cbcc-4110-93ec-409299474b82', alias: 'iam@zayd.wtf' },
  { id: '09f8cc49-9308-4977-9f18-15d1a7e13216', alias: 'zayd@zayd.wtf' },
];

async function adminLogin() {
  console.log('🔐 Logging in as admin...');
  try {
    const response = await axios.post(`${API_BASE}/auth/login`, { password: ADMIN_PASSWORD });
    if (response.data?.success && response.data?.data?.token) {
      console.log('✅ Admin login successful\n');
      return response.data.data.token;
    }
    throw new Error('Login response missing token');
  } catch (err) {
    console.error('❌ Admin login failed:', err.response?.data?.error || err.message);
    throw err;
  }
}

async function refreshSession(token, accountId) {
  try {
    const response = await axios.post(
      `${API_BASE}/accounts/${accountId}/refresh`,
      {},
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    return { success: true, data: response.data?.data };
  } catch (err) {
    return {
      success: false,
      error: err.response?.data?.error || err.message,
      status: err.response?.status
    };
  }
}

async function provisionKey(token, accountId, keyName) {
  try {
    console.log(`   🔧 Calling provision endpoint...`);
    const response = await axios.post(
      `${API_BASE}/accounts/${accountId}/provision`,
      { keyName },
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    return { success: true, data: response.data?.data };
  } catch (err) {
    return {
      success: false,
      error: err.response?.data?.error || err.message,
      code: err.response?.data?.code,
      details: err.response?.data
    };
  }
}

async function listManagementKeys(token, accountId) {
  try {
    const response = await axios.get(`${API_BASE}/accounts/${accountId}/management-keys`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return { success: true, keys: response.data?.data?.keys || [] };
  } catch (err) {
    return { success: false, error: err.response?.data?.error || err.message };
  }
}

async function testKeyWithOpenRouter(key) {
  try {
    const response = await axios.get('https://openrouter.ai/api/v1/credits', {
      headers: { 'Authorization': `Bearer ${key}` },
      timeout: 10000
    });
    return { success: true, data: response.data };
  } catch (err) {
    return { success: false, error: err.response?.data?.error?.message || err.message };
  }
}

async function getStoredSessionToken(accountId) {
  try {
    const account = await prisma.account.findFirst({ where: { id: accountId } });
    if (account?.sessionToken) {
      return decrypt(account.sessionToken);
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('SESSION REFRESH AND KEY PROVISIONING');
  console.log('Generated:', new Date().toISOString());
  console.log('='.repeat(80));
  console.log();

  const token = await adminLogin();

  const results = {
    refreshedAndProvisioned: [],
    refreshFailed: [],
    provisionFailed: []
  };

  for (const account of ACCOUNTS) {
    console.log(`📋 Account: ${account.alias} (${account.id})`);

    // First, try refreshing the session
    console.log('   🔄 Attempting session refresh...');
    const refreshResult = await refreshSession(token, account.id);

    if (refreshResult.success) {
      console.log(`   ✅ Session refreshed, expiry: ${refreshResult.data?.sessionExpiry}`);

      // Try provisioning
      console.log('   🔧 Provisioning fresh key...');
      const provisionResult = await provisionKey(token, account.id, `Fresh Key ${new Date().toISOString().split('T')[0]}`);

      if (provisionResult.success) {
        console.log('   ✅ Fresh key provisioned!');
        console.log(`   📝 Key prefix: ${provisionResult.data?.key?.substring(0, 20)}...`);
        console.log(`   🔍 Source: ${provisionResult.data?.source || 'unknown'}`);
        results.refreshedAndProvisioned.push({
          ...account,
          key: provisionResult.data?.key,
          source: provisionResult.data?.source
        });
      } else {
        console.log(`   ❌ Provisioning failed: ${provisionResult.error}`);
        if (provisionResult.code) {
          console.log(`      Code: ${provisionResult.code}`);
        }
        results.provisionFailed.push({
          ...account,
          error: provisionResult.error,
          code: provisionResult.code
        });
      }
    } else {
      console.log(`   ❌ Session refresh failed: ${refreshResult.error} (status: ${refreshResult.status})`);
      console.log('   💡 This account needs manual re-login via UI');
      results.refreshFailed.push({
        ...account,
        error: refreshResult.error,
        status: refreshResult.status
      });
    }

    console.log('');
  }

  // Verify the new keys
  console.log('='.repeat(80));
  console.log('VERIFYING NEW KEYS');
  console.log('='.repeat(80));
  console.log();

  for (const account of results.refreshedAndProvisioned) {
    console.log(`📋 Verifying: ${account.alias}`);

    const keysResult = await listManagementKeys(token, account.id);

    if (keysResult.success && keysResult.keys.length > 0) {
      console.log(`   ✅ Found ${keysResult.keys.length} management key(s)`);

      const firstKey = keysResult.keys[0];
      console.log(`   🧪 Testing key with OpenRouter API...`);

      const testResult = await testKeyWithOpenRouter(firstKey.key);

      if (testResult.success) {
        console.log(`   ✅ Key is valid and working`);
        console.log(`   💰 Credits: $${testResult.data?.data?.total_credits || 'N/A'}`);
        account.verified = true;
        account.credits = testResult.data?.data?.total_credits;
      } else {
        console.log(`   ⚠️  Key test failed: ${testResult.error}`);
        account.verified = false;
        account.testError = testResult.error;
      }
    } else {
      console.log(`   ❌ No keys found: ${keysResult.error}`);
      account.verified = false;
    }

    console.log('');
  }

  // Final summary
  console.log('='.repeat(80));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(80));
  console.log();

  console.log(`✅ Successfully refreshed and provisioned: ${results.refreshedAndProvisioned.length}`);
  for (const acc of results.refreshedAndProvisioned) {
    const verified = acc.verified ? '✓ VERIFIED' : '✗ UNVERIFIED';
    const credits = acc.credits ? `($${acc.credits} credits)` : '';
    console.log(`   - ${acc.alias}: ${verified} ${credits}`);
  }

  console.log();
  console.log(`❌ Session refresh failed (needs manual re-login): ${results.refreshFailed.length}`);
  for (const acc of results.refreshFailed) {
    console.log(`   - ${acc.alias}: ${acc.error}`);
  }

  console.log();
  console.log(`❌ Provisioning failed: ${results.provisionFailed.length}`);
  for (const acc of results.provisionFailed) {
    console.log(`   - ${acc.alias}: ${acc.error} (${acc.code || 'no code'})`);
  }

  await prisma.$disconnect();

  console.log();
  console.log('='.repeat(80));

  return results;
}

main()
  .then(results => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
