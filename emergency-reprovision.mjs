#!/usr/bin/env node
/**
 * Emergency re-provisioning of management keys for all accounts
 * Steps:
 * 1. Login as admin
 * 2. Check session status for each account
 * 3. Provision fresh keys for accounts with valid sessions
 * 4. Report which accounts need re-login
 * 5. Verify new keys
 */

import axios from 'axios';
import * as store from './server/services/store.js';
import { prisma } from './server/services/db.js';

const API_BASE = 'http://localhost:3001/api';
const ADMIN_PASSWORD = '1111';

// Account IDs from the context
const ACCOUNTS = [
  { id: '6f1d28e8-bc8d-4557-b589-66b6db341f8c', alias: 'admin@zayd.world' },
  { id: 'cecff6a9-cbcc-4110-93ec-409299474b82', alias: 'iam@zayd.wtf' },
  { id: '09f8cc49-9308-4977-9f18-15d1a7e13216', alias: 'zayd@zayd.wtf' },
  { id: '529c3bc9-d8b4-49c7-8fee-957e54db4c50', alias: 'delilah@zayd.wtf', likelyLocked: true },
];

async function adminLogin() {
  console.log('🔐 Logging in as admin...');
  try {
    const response = await axios.post(`${API_BASE}/auth/login`, {
      password: ADMIN_PASSWORD
    });
    if (response.data?.success && response.data?.data?.token) {
      console.log('✅ Admin login successful');
      return response.data.data.token;
    }
    throw new Error('Login response missing token');
  } catch (err) {
    console.error('❌ Admin login failed:', err.response?.data?.error || err.message);
    throw err;
  }
}

async function checkAccountSession(token, accountId) {
  try {
    const response = await axios.get(`${API_BASE}/accounts/${accountId}/session-status`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.data?.data;
  } catch (err) {
    return { status: 'error', error: err.response?.data?.error || err.message };
  }
}

async function provisionKey(token, accountId, keyName = 'Fresh Key') {
  try {
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

async function main() {
  console.log('='.repeat(80));
  console.log('EMERGENCY MANAGEMENT KEY RE-PROVISIONING');
  console.log('Generated:', new Date().toISOString());
  console.log('='.repeat(80));
  console.log();

  // Login as admin
  let token;
  try {
    token = await adminLogin();
  } catch (err) {
    console.error('Cannot proceed without admin authentication');
    process.exit(1);
  }

  console.log();
  console.log('='.repeat(80));
  console.log('STEP 1: CHECKING SESSIONS FOR ALL ACCOUNTS');
  console.log('='.repeat(80));
  console.log();

  const results = {
    provisioned: [],
    needsLogin: [],
    failed: [],
    skipped: []
  };

  for (const account of ACCOUNTS) {
    console.log(`\n📋 Account: ${account.alias} (${account.id})`);

    if (account.likelyLocked) {
      console.log('   ⚠️  Skipped - account likely locked');
      results.skipped.push({ ...account, reason: 'Likely locked' });
      continue;
    }

    // Check session status
    const sessionStatus = await checkAccountSession(token, account.id);
    console.log(`   Session status: ${sessionStatus?.status || 'unknown'}`);

    if (sessionStatus?.status === 'active' || sessionStatus?.status === 'valid') {
      console.log('   ✅ Valid session found, attempting to provision...');

      // Provision fresh key
      const provisionResult = await provisionKey(token, account.id, `Fresh Key ${new Date().toISOString().split('T')[0]}`);

      if (provisionResult.success) {
        console.log('   ✅ Fresh key provisioned successfully');
        results.provisioned.push({
          ...account,
          keyPrefix: provisionResult.data?.key?.substring(0, 20) + '...',
          source: provisionResult.data?.source
        });
      } else {
        console.log(`   ❌ Provisioning failed: ${provisionResult.error}`);
        if (provisionResult.code) {
          console.log(`   Error code: ${provisionResult.code}`);
        }
        results.failed.push({
          ...account,
          error: provisionResult.error,
          code: provisionResult.code
        });
      }
    } else if (sessionStatus?.status === 'expired' || sessionStatus?.status === 'none') {
      console.log('   ⚠️  Session expired or missing - needs re-login');
      results.needsLogin.push({ ...account, status: sessionStatus?.status });
    } else {
      console.log(`   ⚠️  Unknown session status: ${JSON.stringify(sessionStatus)}`);
      results.needsLogin.push({ ...account, status: sessionStatus?.status || 'unknown' });
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('STEP 2: VERIFYING NEW KEYS');
  console.log('='.repeat(80));
  console.log();

  for (const account of results.provisioned) {
    console.log(`\n📋 Verifying: ${account.alias}`);

    const keysResult = await listManagementKeys(token, account.id);

    if (keysResult.success && keysResult.keys.length > 0) {
      console.log(`   ✅ Found ${keysResult.keys.length} management key(s)`);

      // Test the first key with OpenRouter
      const firstKey = keysResult.keys[0];
      console.log(`   🧪 Testing key with OpenRouter API...`);

      const testResult = await testKeyWithOpenRouter(firstKey.key);

      if (testResult.success) {
        console.log(`   ✅ Key is valid and working with OpenRouter`);
        account.verified = true;
        account.credits = testResult.data?.data?.total_credits;
      } else {
        console.log(`   ⚠️  Key test failed: ${testResult.error}`);
        account.verified = false;
        account.testError = testResult.error;
      }
    } else {
      console.log(`   ❌ No keys found or error: ${keysResult.error}`);
      account.verified = false;
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('SUMMARY REPORT');
  console.log('='.repeat(80));
  console.log();

  console.log(`✅ Successfully provisioned: ${results.provisioned.length}`);
  for (const acc of results.provisioned) {
    const verified = acc.verified ? '✓ VERIFIED' : '✗ FAILED VERIFICATION';
    const credits = acc.credits ? `($${acc.credits} credits)` : '';
    console.log(`   - ${acc.alias}: ${verified} ${credits}`);
  }

  console.log();
  console.log(`⚠️  Needs re-login: ${results.needsLogin.length}`);
  for (const acc of results.needsLogin) {
    console.log(`   - ${acc.alias} (status: ${acc.status})`);
  }

  console.log();
  console.log(`❌ Provisioning failed: ${results.failed.length}`);
  for (const acc of results.failed) {
    console.log(`   - ${acc.alias}: ${acc.error} (${acc.code || 'no code'})`);
  }

  console.log();
  console.log(`⏭️  Skipped: ${results.skipped.length}`);
  for (const acc of results.skipped) {
    console.log(`   - ${acc.alias}: ${acc.reason}`);
  }

  console.log();
  console.log('='.repeat(80));
  console.log('RECOMMENDATIONS');
  console.log('='.repeat(80));
  console.log();

  if (results.needsLogin.length > 0) {
    console.log('For accounts needing re-login:');
    console.log('1. Use the UI or API to re-authenticate these accounts');
    console.log('2. Then re-run this script to provision keys for them');
    console.log();
  }

  if (results.failed.length > 0) {
    console.log('For failed provisioning attempts:');
    console.log('1. Check server logs for detailed error messages');
    console.log('2. Verify the OpenRouter dashboard is accessible');
    console.log('3. Consider using browser-based provisioning if HTTP fails');
    console.log();
  }

  console.log('Next steps:');
  console.log('1. Verify all provisioned keys are working');
  console.log('2. Delete any corrupted keys from the old system');
  console.log('3. Update account configurations to use new keys');

  // Cleanup
  await prisma.$disconnect();

  console.log();
  console.log('='.repeat(80));
  console.log('Done!');
  console.log('='.repeat(80));

  return results;
}

main()
  .then(results => {
    console.log();
    console.log('Final results:', JSON.stringify({
      provisioned: results.provisioned.length,
      needsLogin: results.needsLogin.length,
      failed: results.failed.length,
      skipped: results.skipped.length
    }, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
