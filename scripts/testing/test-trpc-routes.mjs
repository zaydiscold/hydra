#!/usr/bin/env node
/**
 * tRPC Endpoint Discovery for OpenRouter Management Key Creation
 * Tests various tRPC routes with proper authentication
 */

import * as store from '../../server/services/store.js';
import { openRouterDashboardDeviceCookies } from '../../server/services/clerk-auth.js';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = 'cecff6a9-cbcc-4110-93ec-409299474b82';
const OR_BASE = 'https://openrouter.ai';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function warnProbe(message, details = {}) {
  const suffix = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  console.warn(`[trpc-route-probe] ${message}${suffix ? ` (${suffix})` : ''}`);
}

// tRPC routes to test for management key creation
const TRPC_ROUTES = [
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
];

// Alternative payload formats
const PAYLOADS = [
  { name: 'Hydra Test Key' },
  { label: 'Hydra Test Key' },
  { title: 'Hydra Test Key' },
  { keyName: 'Hydra Test Key' },
  { name: 'Hydra Test Key', type: 'management' },
];

// Get fresh JWT from Clerk /client endpoint
async function getFreshJwt(sessionCookie, clientCookie) {
  try {
    const cookieHeader = `__session=${sessionCookie}; ${clientCookie}`;
    const url = 'https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0';
    
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Cookie': cookieHeader,
        'Origin': 'https://openrouter.ai',
        'Referer': 'https://openrouter.ai/',
        'User-Agent': USER_AGENT,
      },
    });
    
    if (!res.ok) return null;
    
    const data = await res.json();
    const session = data?.response?.sessions?.[0] || data?.client?.sessions?.[0];
    
    if (session?.last_active_token?.jwt) {
      return session.last_active_token.jwt;
    }
    if (session?.jwt) {
      return session.jwt;
    }
    return null;
  } catch (err) {
    warnProbe('failed to refresh Clerk JWT; continuing with stored session cookie', {
      error: err.message,
    });
    return null;
  }
}

async function testTrpcRoute(route, payload, sessionCookie, clientCookie, freshJwt) {
  const url = `${OR_BASE}/api/trpc/${route}?batch=1`;
  const body = JSON.stringify({ '0': { json: payload } });
  
  const deviceCookies = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  const cookieHeader = `__session=${freshJwt || sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
        'User-Agent': USER_AGENT,
        'Origin': OR_BASE,
        'Referer': `${OR_BASE}/settings/management-keys`,
        'x-trpc-source': 'nextjs-react',
        'Accept': '*/*',
      },
      body,
    });

    const contentType = response.headers.get('content-type') || '';
    const responseBody = await response.text();
    
    const isJson = contentType.includes('application/json');
    const isHtml = responseBody.includes('<!DOCTYPE') || responseBody.includes('<html');
    const hasKey = responseBody.includes('sk-or-v1-');
    const hasError = responseBody.includes('"error"');
    const hasResult = responseBody.includes('"result"');
    
    let parsedData = null;
    if (isJson && !isHtml) {
      try {
        parsedData = JSON.parse(responseBody);
      } catch (err) {
        warnProbe('failed to parse JSON response body', {
          route,
          status: response.status,
          error: err.message,
        });
      }
    }
    
    return {
      status: response.status,
      contentType,
      isJson,
      isHtml,
      hasKey,
      hasError,
      hasResult,
      body: responseBody.slice(0, 500),
      parsedData,
      success: response.status === 200 && isJson && hasResult && !hasError,
    };
  } catch (err) {
    return {
      error: err.message,
      success: false,
    };
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('tRPC ENDPOINT DISCOVERY FOR OPENROUTER MANAGEMENT KEY CREATION');
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
  console.log('Has sessionCookie:', !!account.sessionCookie);
  console.log('Has clientCookie:', !!account.clientCookie);
  console.log('Has managementKey:', !!account.managementKey);
  console.log('');

  if (!account.sessionCookie) {
    console.error('No session cookie found - cannot test');
    process.exit(1);
  }

  // Get fresh JWT
  console.log('Fetching fresh JWT from Clerk...');
  const freshJwt = await getFreshJwt(account.sessionCookie, account.clientCookie || '');
  if (freshJwt) {
    console.log('✅ Fresh JWT obtained');
  } else {
    console.log('⚠️ Using original session cookie (fresh JWT failed)');
  }

  console.log('');
  console.log('Testing tRPC routes...');
  console.log('='.repeat(80));

  const results = [];
  const workingRoutes = [];
  const keyCreatingRoutes = [];

  for (const route of TRPC_ROUTES) {
    for (const payload of PAYLOADS) {
      const testId = `${route} with ${JSON.stringify(payload)}`;
      console.log(`\nTesting: ${route}`);
      console.log(`  Payload: ${JSON.stringify(payload)}`);
      
      const result = await testTrpcRoute(route, payload, account.sessionCookie, account.clientCookie, freshJwt);
      results.push({ route, payload, result, testId });

      console.log(`  Status: ${result.status || 'ERROR'}`);
      console.log(`  Is JSON: ${result.isJson}`);
      console.log(`  Is HTML: ${result.isHtml}`);
      console.log(`  Has Result: ${result.hasResult}`);
      console.log(`  Has Error: ${result.hasError}`);
      console.log(`  Has Key: ${result.hasKey}`);
      
      if (result.error) {
        console.log(`  ❌ Error: ${result.error}`);
      } else if (result.isHtml) {
        console.log(`  ❌ HTML response (auth redirect)`);
      } else if (result.hasKey) {
        console.log(`  🎉 KEY CREATED!`);
        keyCreatingRoutes.push({ route, payload, result, testId });
        workingRoutes.push({ route, payload, result, testId });
      } else if (result.hasResult && !result.hasError) {
        console.log(`  ✅ SUCCESS (but no key returned)`);
        workingRoutes.push({ route, payload, result, testId });
      } else if (result.hasError) {
        // Check error code
        const errorCode = result.parsedData?.[0]?.error?.json?.code || 
                         result.parsedData?.error?.code ||
                         'unknown';
        const errorMsg = result.parsedData?.[0]?.error?.json?.message || 
                        result.parsedData?.error?.message ||
                        'unknown error';
        
        if (errorCode === -32601 || errorMsg.includes('not found')) {
          console.log(`  ⚠️ Route not found`);
        } else if (errorCode === -32001 || result.status === 401) {
          console.log(`  🔒 Auth required`);
        } else {
          console.log(`  ⚠️ Error: ${errorCode} - ${errorMsg.slice(0, 100)}`);
        }
      } else {
        console.log(`  ⚠️ Unexpected response`);
      }
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const successfulTests = results.filter(r => r.result.success);
  const resultTests = results.filter(r => r.result.hasResult);
  const htmlTests = results.filter(r => r.result.isHtml);
  const errorTests = results.filter(r => r.result.hasError && !r.result.isHtml);

  console.log(`\nTotal route/payload combinations tested: ${results.length}`);
  console.log(`Successful (result + no error): ${successfulTests.length}`);
  console.log(`Has result (any): ${resultTests.length}`);
  console.log(`HTML responses: ${htmlTests.length}`);
  console.log(`JSON error responses: ${errorTests.length}`);
  console.log(`Routes that created keys: ${keyCreatingRoutes.length}`);

  if (keyCreatingRoutes.length > 0) {
    console.log('\n🎉 WORKING ROUTES THAT CREATE KEYS:');
    console.log('-'.repeat(80));
    for (const test of keyCreatingRoutes) {
      console.log(`  Route: ${test.route}`);
      console.log(`  Payload: ${JSON.stringify(test.payload)}`);
      console.log(`  Response: ${test.result.body.slice(0, 200)}...`);
      console.log('');
    }
  }

  if (workingRoutes.length > 0) {
    console.log('\n✅ ROUTES WITH SUCCESSFUL RESPONSES (no key):');
    console.log('-'.repeat(80));
    for (const test of workingRoutes) {
      if (!test.result.hasKey) {
        console.log(`  Route: ${test.route}`);
        console.log(`  Payload: ${JSON.stringify(test.payload)}`);
        console.log(`  Response: ${test.result.body.slice(0, 200)}...`);
        console.log('');
      }
    }
  }

  // Show HTML responses (auth issues)
  if (htmlTests.length > 0) {
    console.log('\n🔒 ROUTES RETURNING HTML (AUTH ISSUES):');
    console.log('-'.repeat(80));
    const uniqueRoutes = [...new Set(htmlTests.map(t => t.route))];
    for (const route of uniqueRoutes.slice(0, 10)) {
      console.log(`  ${route}`);
    }
    if (uniqueRoutes.length > 10) {
      console.log(`  ... and ${uniqueRoutes.length - 10} more`);
    }
  }

  // Show routes not found
  const notFoundTests = results.filter(r => {
    const errorCode = r.result.parsedData?.[0]?.error?.json?.code;
    const errorMsg = r.result.parsedData?.[0]?.error?.json?.message || 
                     r.result.parsedData?.error?.message || '';
    return errorCode === -32601 || errorMsg.includes('not found');
  });
  if (notFoundTests.length > 0) {
    console.log('\n⚠️ ROUTES NOT FOUND (-32601):');
    console.log('-'.repeat(80));
    const uniqueRoutes = [...new Set(notFoundTests.map(t => t.route))];
    for (const route of uniqueRoutes) {
      console.log(`  ${route}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('CONCLUSIONS');
  console.log('='.repeat(80));
  
  if (keyCreatingRoutes.length === 0) {
    console.log('\n❌ No tRPC routes for management key creation were found working.');
    console.log('\nPossible reasons:');
    console.log('  1. The tRPC routes may have different names');
    console.log('  2. Authentication may require additional headers/cookies');
    console.log('  3. OpenRouter may be using Next.js Server Actions instead');
    console.log('  4. The account session may need to be refreshed');
    console.log('\nRecommended next steps:');
    console.log('  - Check browser network logs when creating a management key');
    console.log('  - Look for POST requests to /api/trpc/* with the actual route name');
    console.log('  - Look for POST requests with Next-Action headers');
    console.log('  - Try the scripts/capture-mgmt-key-network.mjs script');
  } else {
    console.log(`\n✅ Found ${keyCreatingRoutes.length} working route(s)!`);
    console.log('See above for details.');
  }

  // Cleanup
  await store.prisma?.$disconnect?.();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
