#!/usr/bin/env node
/**
 * Attempt to re-login to expired accounts using stored credentials
 * Then provision fresh keys
 */

import axios from 'axios';
import * as store from './server/services/store.js';
import { prisma } from './server/services/db.js';

const API_BASE = 'http://localhost:3001/api';
const ADMIN_PASSWORD = '1111';

// Account IDs that need re-login
const ACCOUNTS_NEEDING_LOGIN = [
  { id: '6f1d28e8-bc8d-4557-b589-66b6db341f8c', alias: 'admin@zayd.world' },
  { id: 'cecff6a9-cbcc-4110-93ec-409299474b82', alias: 'iam@zayd.wtf' },
  { id: '09f8cc49-9308-4977-9f18-15d1a7e13216', alias: 'zayd@zayd.wtf' },
];

async function adminLogin() {
  console.log('🔐 Logging in as admin...');
  try {
    const response = await axios.post(`${API_BASE}/auth/login`, { password: ADMIN_PASSWORD });
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

async function getAccountWithKey(userId, accountId) {
  try {
    return await store.getAccountWithKey(userId, accountId);
  } catch (err) {
    return null;
  }
}

async function detectAuthMethod(token, accountId) {
  try {
    const response = await axios.post(
      `${API_BASE}/accounts/${accountId}/detect-auth`,
      {},
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    return response.data?.data;
  } catch (err) {
    return { error: err.response?.data?.error || err.message };
  }
}

async function attemptLogin(token, accountId, password) {
  try {
    const response = await axios.post(
      `${API_BASE}/accounts/${accountId}/login`,
      { password },
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    return { success: true, data: response.data?.data };
  } catch (err) {
    // Check if it's a 2FA case
    if (err.response?.status === 202 && err.response?.data?.data?.requiresTwoFactor) {
      return {
        success: false,
        requires2FA: true,
        signInId: err.response?.data?.data?.signInId,
        message: 'Account requires 2FA/OTP'
      };
    }
    return {
      success: false,
      error: err.response?.data?.error || err.message,
      status: err.response?.status
    };
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
  console.log('EMERGENCY RE-LOGIN AND KEY PROVISIONING');
  console.log('Generated:', new Date().toISOString());
  console.log('='.repeat(80));
  console.log();

  // Get admin token
  let token;
  try {
    token = await adminLogin();
  } catch (err) {
    console.error('Cannot proceed without admin authentication');
    process.exit(1);
  }

  // First, get the admin user ID from a simple accounts call
  let adminUserId;
  try {
    const accountsResponse = await axios.get(`${API_BASE}/accounts`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    // Get first account to determine user ID
    if (accountsResponse.data?.data?.length > 0) {
      const firstAccount = accountsResponse.data.data[0];
      // Get full account with key to find user ID
      const fullAccount = await getAccountWithKey(firstAccount.userId, firstAccount.id);
      adminUserId = firstAccount.userId;
      console.log(`Found admin user ID: ${adminUserId}`);
    }
  } catch (err) {
    console.log('Could not determine admin user ID, will try default approach');
  }

  console.log();
  console.log('='.repeat(80));
  console.log('ATTEMPTING RE-LOGIN AND PROVISIONING');
  console.log('='.repeat(80));
  console.log();

  const results = {
    provisioned: [],
    needs2FA: [],
    loginFailed: [],
    provisionFailed: []
  };

  for (const account of ACCOUNTS_NEEDING_LOGIN) {
    console.log(`\n📋 Account: ${account.alias} (${account.id})`);

    // Get account details to check for stored password
    let accountDetails = null;
    try {
      // Try to get account details from API
      const accountResponse = await axios.get(`${API_BASE}/accounts`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const accounts = accountResponse.data?.data || [];
      accountDetails = accounts.find(a => a.id === account.id);
    } catch (err) {
      console.log(`   Could not fetch account details: ${err.message}`);
    }

    // Check if we have credentials stored
    let hasPassword = false;
    let hasEmail = false;
    let password = null;

    try {
      const fullAccount = await getAccountWithKey(adminUserId || 'admin', account.id);
      if (fullAccount) {
        hasEmail = !!fullAccount.email;
        hasPassword = !!fullAccount.password;
        password = fullAccount.password;
        console.log(`   Has email: ${hasEmail ? 'Yes' : 'No'}`);
        console.log(`   Has password: ${hasPassword ? 'Yes' : 'No'}`);
      }
    } catch (err) {
      console.log(`   Could not fetch full account: ${err.message}`);
    }

    if (!hasPassword) {
      console.log('   ⚠️  No stored password - cannot auto-login');
      results.loginFailed.push({ ...account, reason: 'No stored password' });
      continue;
    }

    // Attempt login
    console.log('   🔐 Attempting login...');
    const loginResult = await attemptLogin(token, account.id, password);

    if (loginResult.success) {
      console.log('   ✅ Login successful');
      console.log('   🔧 Provisioning fresh key...');

      // Provision key
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
        results.provisionFailed.push({
          ...account,
          error: provisionResult.error,
          code: provisionResult.code
        });
      }
    } else if (loginResult.requires2FA) {
      console.log(`   ⚠️  Account requires 2FA/OTP - cannot auto-login`);
      results.needs2FA.push({
        ...account,
        signInId: loginResult.signInId,
        message: loginResult.message
      });
    } else {
      console.log(`   ❌ Login failed: ${loginResult.error} (status: ${loginResult.status})`);
      results.loginFailed.push({
        ...account,
        error: loginResult.error,
        status: loginResult.status
      });
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('VERIFYING NEW KEYS');
  console.log('='.repeat(80));
  console.log();

  for (const account of results.provisioned) {
    console.log(`\n📋 Verifying: ${account.alias}`);

    const keysResult = await listManagementKeys(token, account.id);

    if (keysResult.success && keysResult.keys.length > 0) {
      console.log(`   ✅ Found ${keysResult.keys.length} management key(s)`);

      // Test the first key
      const firstKey = keysResult.keys[0];
      console.log(`   🧪 Testing key with OpenRouter API...`);

      const testResult = await testKeyWithOpenRouter(firstKey.key);

      if (testResult.success) {
        console.log(`   ✅ Key is valid and working`);
        account.verified = true;
        account.credits = testResult.data?.data?.total_credits;
      } else {
        console.log(`   ⚠️  Key test failed: ${testResult.error}`);
        account.verified = false;
      }
    } else {
      console.log(`   ❌ No keys found`);
      account.verified = false;
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(80));
  console.log();

  console.log(`✅ Successfully provisioned: ${results.provisioned.length}`);
  for (const acc of results.provisioned) {
    const verified = acc.verified ? '✓ VERIFIED' : '✗ UNVERIFIED';
    const credits = acc.credits ? `($${acc.credits} credits)` : '';
    console.log(`   - ${acc.alias}: ${verified} ${credits}`);
  }

  console.log();
  console.log(`⚠️  Requires 2FA/OTP: ${results.needs2FA.length}`);
  for (const acc of results.needs2FA) {
    console.log(`   - ${acc.alias}: ${acc.message}`);
  }

  console.log();
  console.log(`❌ Login failed: ${results.loginFailed.length}`);
  for (const acc of results.loginFailed) {
    console.log(`   - ${acc.alias}: ${acc.reason || acc.error}`);
  }

  console.log();
  console.log(`❌ Provisioning failed: ${results.provisionFailed.length}`);
  for (const acc of results.provisionFailed) {
    console.log(`   - ${acc.alias}: ${acc.error} (${acc.code || 'no code'})`);
  }

  // Cleanup
  await prisma.$disconnect();

  console.log();
  console.log('='.read(80));
  console.log('Done!');
  console.log('='.repeat(80));

  return results;
}

main()
  .then(results => {
    console.log();
    console.log('Final results:', JSON.stringify({
      provisioned: results.provisioned.length,
      needs2FA: results.needs2FA.length,
      loginFailed: results.loginFailed.length,
      provisionFailed: results.provisionFailed.length
    }, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
