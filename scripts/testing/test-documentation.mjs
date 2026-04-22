#!/usr/bin/env node
/**
 * Comprehensive REST Endpoint Documentation
 * Documents all tested endpoints and their results
 */

import * as store from './server/services/store.js';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = 'cecff6a9-cbcc-4110-93ec-409299474b82';

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║          OPENROUTER MANAGEMENT KEY CREATION - ENDPOINT DISCOVERY             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Date: 2026-04-03');
  console.log('Account: cecff6a9-cbcc-4110-93ec-409299474b82');
  console.log('User: 26d94c8c-5294-4841-855c-2ae12d4490fe');
  console.log('');

  const account = await store.getAccountWithKey(USER_ID, ACCOUNT_ID);
  
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              SESSION STATUS                                   ');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Has sessionCookie:', account?.sessionCookie ? 'Yes' : 'No');
  console.log('Has clientCookie:', account?.clientCookie ? 'Yes' : 'No');
  console.log('Has managementKey:', account?.managementKey ? 'Yes' : 'No');
  
  if (account?.sessionCookie) {
    const parts = account.sessionCookie.split('.');
    if (parts.length >= 2) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        console.log('');
        console.log('Session JWT Details:');
        console.log('  Subject (user ID):', payload.sub);
        console.log('  Issuer:', payload.iss);
        console.log('  Expires:', new Date(payload.exp * 1000).toISOString());
        console.log('  Issued at:', new Date(payload.iat * 1000).toISOString());
      } catch (e) {}
    }
  }
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                           TESTED REST ENDPOINTS                                ');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const restEndpoints = [
    { path: '/api/v1/management-keys', methods: ['POST', 'GET', 'PUT'], auth: ['Bearer', 'Cookie', 'Both'] },
    { path: '/api/v1/keys', methods: ['POST', 'GET'], auth: ['Bearer', 'Cookie', 'Both'] },
    { path: '/api/v2/management-keys', methods: ['POST'], auth: ['Both'] },
    { path: '/api/v2/keys', methods: ['POST'], auth: ['Both'] },
    { path: '/api/auth/keys', methods: ['POST'], auth: ['Bearer', 'Cookie', 'Both'] },
    { path: '/api/user/keys', methods: ['POST', 'GET'], auth: ['Bearer', 'Cookie', 'Both'] },
    { path: '/api/account/keys', methods: ['POST', 'GET'], auth: ['Bearer', 'Cookie', 'Both'] },
    { path: '/api/management/keys', methods: ['POST'], auth: ['Bearer', 'Cookie', 'Both'] },
    { path: '/api/keys/management', methods: ['POST'], auth: ['Bearer', 'Cookie', 'Both'] },
    { path: '/api/settings/management-keys', methods: ['POST'], auth: ['Bearer', 'Cookie', 'Both'] },
    { path: '/api/dashboard/keys', methods: ['POST'], auth: ['Bearer', 'Cookie', 'Both'] },
  ];

  console.log('Endpoints tested with various authentication methods:');
  console.log('');
  
  for (const ep of restEndpoints) {
    console.log(`  ${ep.path}`);
    console.log(`    Methods: ${ep.methods.join(', ')}`);
    console.log(`    Auth types tested: ${ep.auth.join(', ')}`);
    console.log(`    Result: ❌ All returned HTML (auth redirect) or 401`);
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                           TESTED tRPC ROUTES                                   ');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const trpcRoutes = [
    'managementKeys.create',
    'managementKey.create',
    'keys.createManagement',
    'managementKeys.createKey',
    'managementKeys.createManagementKey',
    'management.createManagementKey',
    'management.createKey',
    'apiKeys.createManagement',
    'apiKeys.createManagementKey',
    'settings.managementKeys.create',
    'dashboard.managementKeys.create',
    'management.managementKeys.create',
    'admin.managementKeys.create',
    'user.managementKeys.create',
    'account.managementKeys.create',
    'keys.management.create',
    'keys.managementCreate',
    'managementKeys.list',
    'apiKeys.list',
    'keys.list',
    'user.keys',
    'account.keys',
    'settings.keys',
  ];

  console.log('tRPC routes tested (each with 5 payload variations):');
  console.log('');
  for (const route of trpcRoutes) {
    console.log(`  ❌ ${route} - Returns HTML (auth redirect)`);
  }
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                         AUTHENTICATION TESTED                                  ');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Authentication methods tested:');
  console.log('');
  console.log('  1. Bearer Token (JWT as Authorization: Bearer <token>)');
  console.log('     - Used fresh JWT from Clerk /client endpoint');
  console.log('     - Used original session cookie JWT');
  console.log('     - Result: 401 or HTML redirect');
  console.log('');
  console.log('  2. Cookie-based (Cookie header with __session=<jwt>)');
  console.log('     - With __session cookie alone');
  console.log('     - With __session + __client');
  console.log('     - With __session + __client + __client_uat');
  console.log('     - With __session + Cloudflare cookies (__cf_bm, _cfuvid)');
  console.log('     - With all cookies combined');
  console.log('     - Result: HTML redirect to login');
  console.log('');
  console.log('  3. Combined (Bearer + Cookie)');
  console.log('     - Both Authorization header and Cookie header');
  console.log('     - Result: Same as individual methods');
  console.log('');
  console.log('Headers used:');
  console.log('  - Content-Type: application/json');
  console.log('  - Origin: https://openrouter.ai');
  console.log('  - Referer: https://openrouter.ai/settings/management-keys');
  console.log('  - User-Agent: Chrome 120');
  console.log('  - x-trpc-source: nextjs-react (for tRPC calls)');
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                            FINDINGS SUMMARY                                    ');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('❌ NO WORKING REST ENDPOINTS FOUND');
  console.log('');
  console.log('None of the tested REST or tRPC endpoints accepted the provided authentication.');
  console.log('All endpoints returned either:');
  console.log('  - HTML redirect to login page');
  console.log('  - 401 Unauthorized (for /api/v1/keys)');
  console.log('  - 404 Not Found (for PUT /api/v1/keys)');
  console.log('');
  console.log('Possible causes:');
  console.log('  1. Session/JWT has expired or been revoked');
  console.log('  2. Missing Cloudflare clearance cookies (cf_clearance)');
  console.log('  3. OpenRouter has implemented additional security measures');
  console.log('  4. The actual endpoint names may be different');
  console.log('  5. OpenRouter may be using Next.js Server Actions with custom headers');
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                         RECOMMENDED NEXT STEPS                                 ');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('1. RE-AUTHENTICATE');
  console.log('   - Use the OTP flow to get fresh session cookies');
  console.log('   - Run: curl -X POST http://localhost:3001/api/accounts/<id>/otp/start');
  console.log('   - Then: curl -X POST http://localhost:3001/api/accounts/<id>/otp/verify');
  console.log('');
  console.log('2. CAPTURE LIVE TRAFFIC');
  console.log('   - Use scripts/capture-mgmt-key-network.mjs to capture actual dashboard requests');
  console.log('   - This requires browser automation and valid login');
  console.log('');
  console.log('3. CHECK FOR SERVER ACTIONS');
  console.log('   - OpenRouter may have migrated to Next.js Server Actions');
  console.log('   - Look for POST requests with "Next-Action" headers');
  console.log('');
  console.log('4. VERIFY MANAGEMENT KEY');
  console.log('   - The existing management key returned 401 errors');
  console.log('   - It may have been revoked or expired');
  console.log('   - A new one may need to be created via the UI');
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              FILES CREATED                                     ');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  - test-rest-endpoints.mjs      (REST endpoint testing script)');
  console.log('  - test-trpc-routes.mjs         (tRPC route testing script)');
  console.log('  - test-session-validation.mjs  (Session validation script)');
  console.log('  - test-account-verify.mjs      (Management key verification script)');
  console.log('');

  // Cleanup
  await store.prisma?.$disconnect?.();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
