#!/usr/bin/env node
/**
 * Verify account using existing management key
 * Tests the OpenRouter API to confirm the account is valid
 */

import * as store from './server/services/store.js';
import * as openrouter from './server/services/openrouter.js';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = 'cecff6a9-cbcc-4110-93ec-409299474b82';

async function main() {
  console.log('='.repeat(80));
  console.log('ACCOUNT VERIFICATION VIA MANAGEMENT KEY');
  console.log('='.repeat(80));
  console.log(`Account ID: ${ACCOUNT_ID}`);
  console.log(`User ID: ${USER_ID}`);
  console.log('');

  // Get account
  const account = await store.getAccountWithKey(USER_ID, ACCOUNT_ID);
  if (!account) {
    console.error('Account not found');
    process.exit(1);
  }

  console.log('Account:', account.alias || account.email);
  console.log('Has managementKey:', !!account.managementKey);
  console.log('');

  if (!account.managementKey) {
    console.error('No management key found');
    process.exit(1);
  }

  // Test OpenRouter API
  console.log('Testing OpenRouter API with management key...');
  console.log('');

  try {
    console.log('1. Getting credits...');
    const credits = await openrouter.getCredits(account.managementKey);
    console.log('✅ Credits:', credits);
  } catch (err) {
    console.log('❌ Credits error:', err.message);
  }

  try {
    console.log('');
    console.log('2. Listing keys...');
    const keys = await openrouter.listKeys(account.managementKey);
    console.log('✅ Keys count:', keys.length);
    if (keys.length > 0) {
      console.log('First key:', JSON.stringify(keys[0], null, 2).slice(0, 200));
    }
  } catch (err) {
    console.log('❌ Keys error:', err.message);
  }

  try {
    console.log('');
    console.log('3. Getting account snapshot...');
    const snapshot = await openrouter.getAccountSnapshot(account.managementKey);
    console.log('✅ Snapshot:');
    console.log('  Email:', snapshot.email);
    console.log('  Credits:', snapshot.credits);
    console.log('  Total keys:', snapshot.keys?.length);
    console.log('  Total requests:', snapshot.totalRequests);
  } catch (err) {
    console.log('❌ Snapshot error:', err.message);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('CONCLUSION');
  console.log('='.repeat(80));
  console.log('');
  console.log('If all tests pass, the account and management key are valid.');
  console.log('The dashboard access issue is likely due to:');
  console.log('  1. Missing Cloudflare cookies (__cf_bm, cf_clearance)');
  console.log('  2. Different authentication requirements for dashboard vs API');
  console.log('  3. The account may use a different authentication flow');

  // Cleanup
  await store.prisma?.$disconnect?.();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
