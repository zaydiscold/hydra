#!/usr/bin/env node
/**
 * REST Endpoint Discovery for OpenRouter Management Key Creation
 * Tests various REST endpoints with different authentication methods
 */

import * as store from './server/services/store.js';
import { openRouterDashboardDeviceCookies, refreshSession } from './server/services/clerk-auth.js';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = 'cecff6a9-cbcc-4110-93ec-409299474b82';
const OR_BASE = 'https://openrouter.ai';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    return null;
  }
}

// Endpoints to test (from most likely to least likely)
const ENDPOINTS_TO_TEST = [
  // Standard REST API patterns
  { path: '/api/v1/management-keys', method: 'POST', body: { name: 'Test Key' }, authType: 'bearer' },
  { path: '/api/v1/management-keys', method: 'POST', body: { name: 'Test Key' }, authType: 'cookie' },
  { path: '/api/v1/management-keys', method: 'POST', body: { name: 'Test Key' }, authType: 'both' },
  
  { path: '/api/v1/keys', method: 'POST', body: { name: 'Test Key', type: 'management' }, authType: 'bearer' },
  { path: '/api/v1/keys', method: 'POST', body: { name: 'Test Key', type: 'management' }, authType: 'cookie' },
  { path: '/api/v1/keys', method: 'POST', body: { name: 'Test Key', type: 'management' }, authType: 'both' },
  
  // Alternative patterns
  { path: '/api/auth/keys', method: 'POST', body: { name: 'Test Key', keyType: 'management' }, authType: 'bearer' },
  { path: '/api/auth/keys', method: 'POST', body: { name: 'Test Key', keyType: 'management' }, authType: 'cookie' },
  { path: '/api/auth/keys', method: 'POST', body: { name: 'Test Key', keyType: 'management' }, authType: 'both' },
  
  { path: '/api/user/keys', method: 'POST', body: { name: 'Test Key', type: 'management' }, authType: 'bearer' },
  { path: '/api/user/keys', method: 'POST', body: { name: 'Test Key', type: 'management' }, authType: 'cookie' },
  { path: '/api/user/keys', method: 'POST', body: { name: 'Test Key', type: 'management' }, authType: 'both' },
  
  { path: '/api/account/keys', method: 'POST', body: { name: 'Test Key', type: 'management' }, authType: 'bearer' },
  { path: '/api/account/keys', method: 'POST', body: { name: 'Test Key', type: 'management' }, authType: 'cookie' },
  { path: '/api/account/keys', method: 'POST', body: { name: 'Test Key', type: 'management' }, authType: 'both' },
  
  // Management-specific paths
  { path: '/api/management/keys', method: 'POST', body: { name: 'Test Key' }, authType: 'bearer' },
  { path: '/api/management/keys', method: 'POST', body: { name: 'Test Key' }, authType: 'cookie' },
  { path: '/api/management/keys', method: 'POST', body: { name: 'Test Key' }, authType: 'both' },
  
  { path: '/api/keys/management', method: 'POST', body: { name: 'Test Key' }, authType: 'bearer' },
  { path: '/api/keys/management', method: 'POST', body: { name: 'Test Key' }, authType: 'cookie' },
  { path: '/api/keys/management', method: 'POST', body: { name: 'Test Key' }, authType: 'both' },
  
  // Settings paths
  { path: '/api/settings/management-keys', method: 'POST', body: { name: 'Test Key' }, authType: 'bearer' },
  { path: '/api/settings/management-keys', method: 'POST', body: { name: 'Test Key' }, authType: 'cookie' },
  { path: '/api/settings/management-keys', method: 'POST', body: { name: 'Test Key' }, authType: 'both' },
  
  // Dashboard paths
  { path: '/api/dashboard/keys', method: 'POST', body: { name: 'Test Key', type: 'management' }, authType: 'bearer' },
  { path: '/api/dashboard/keys', method: 'POST', body: { name: 'Test Key', type: 'management' }, authType: 'cookie' },
  { path: '/api/dashboard/keys', method: 'POST', body: { name: 'Test Key', type: 'management' }, authType: 'both' },
  
  // Alternative body formats
  { path: '/api/v1/management-keys', method: 'POST', body: { label: 'Test Key' }, authType: 'both' },
  { path: '/api/v1/management-keys', method: 'POST', body: { title: 'Test Key' }, authType: 'both' },
  { path: '/api/v1/management-keys', method: 'POST', body: { keyName: 'Test Key' }, authType: 'both' },
  
  // PUT methods
  { path: '/api/v1/management-keys', method: 'PUT', body: { name: 'Test Key' }, authType: 'both' },
  { path: '/api/v1/keys', method: 'PUT', body: { name: 'Test Key', type: 'management' }, authType: 'both' },
  
  // Different API versions
  { path: '/api/v2/management-keys', method: 'POST', body: { name: 'Test Key' }, authType: 'both' },
  { path: '/api/v2/keys', method: 'POST', body: { name: 'Test Key', type: 'management' }, authType: 'both' },
  
  // List endpoints (GET) - to verify auth works
  { path: '/api/v1/management-keys', method: 'GET', body: null, authType: 'both' },
  { path: '/api/v1/keys', method: 'GET', body: null, authType: 'both' },
  { path: '/api/user/keys', method: 'GET', body: null, authType: 'both' },
  { path: '/api/account/keys', method: 'GET', body: null, authType: 'both' },
];

async function testEndpoint(endpoint, sessionCookie, clientCookie, freshJwt) {
  const url = `${OR_BASE}${endpoint.path}`;
  const headers = {
    'User-Agent': USER_AGENT,
    'Origin': OR_BASE,
    'Referer': `${OR_BASE}/settings/management-keys`,
    'Accept': 'application/json',
  };

  // Build cookie header
  const deviceCookies = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  const cookieHeader = `__session=${freshJwt || sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;

  // Apply auth based on type
  if (endpoint.authType === 'bearer' || endpoint.authType === 'both') {
    headers['Authorization'] = `Bearer ${freshJwt || sessionCookie}`;
  }
  if (endpoint.authType === 'cookie' || endpoint.authType === 'both') {
    headers['Cookie'] = cookieHeader;
  }

  if (endpoint.body) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(url, {
      method: endpoint.method,
      headers,
      body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
    });

    const contentType = response.headers.get('content-type') || '';
    const responseBody = await response.text();
    
    const isJson = contentType.includes('application/json');
    const isHtml = responseBody.includes('<!DOCTYPE') || responseBody.includes('<html');
    const hasKey = responseBody.includes('sk-or-v1-');
    const hasError = responseBody.includes('"error"') || responseBody.includes('"message"');
    
    return {
      status: response.status,
      contentType,
      isJson,
      isHtml,
      hasKey,
      hasError,
      body: responseBody.slice(0, 500),
      success: response.status >= 200 && response.status < 300 && isJson && !isHtml,
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
  console.log('REST ENDPOINT DISCOVERY FOR OPENROUTER MANAGEMENT KEY CREATION');
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
  console.log('Testing endpoints...');
  console.log('='.repeat(80));

  const results = [];
  const workingEndpoints = [];

  for (const endpoint of ENDPOINTS_TO_TEST) {
    const testId = `${endpoint.method} ${endpoint.path} (${endpoint.authType})`;
    console.log(`\nTesting: ${testId}`);
    
    const result = await testEndpoint(endpoint, account.sessionCookie, account.clientCookie, freshJwt);
    results.push({ endpoint, result, testId });

    console.log(`  Status: ${result.status || 'ERROR'}`);
    console.log(`  Content-Type: ${result.contentType || 'N/A'}`);
    console.log(`  Is JSON: ${result.isJson}`);
    console.log(`  Is HTML: ${result.isHtml}`);
    console.log(`  Has Key: ${result.hasKey}`);
    console.log(`  Has Error: ${result.hasError}`);
    
    if (result.error) {
      console.log(`  ❌ Error: ${result.error}`);
    } else if (result.success) {
      console.log(`  ✅ SUCCESS`);
      if (result.hasKey) {
        console.log(`  🎉 KEY CREATED!`);
        workingEndpoints.push({ endpoint, result, testId });
      }
    } else if (result.isHtml) {
      console.log(`  ❌ HTML response (likely auth redirect)`);
    } else if (result.status === 404) {
      console.log(`  ⚠️ Endpoint not found (404)`);
    } else if (result.status === 401 || result.status === 403) {
      console.log(`  🔒 Auth required/invalid (${result.status})`);
    } else {
      console.log(`  ⚠️ Unexpected response (${result.status})`);
    }
    
    // Rate limiting - be nice to the server
    await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const successfulTests = results.filter(r => r.result.success);
  const keyCreatingTests = results.filter(r => r.result.hasKey);
  const jsonResponses = results.filter(r => r.result.isJson);
  const htmlResponses = results.filter(r => r.result.isHtml);

  console.log(`\nTotal endpoints tested: ${results.length}`);
  console.log(`Successful responses (2xx + JSON): ${successfulTests.length}`);
  console.log(`JSON responses: ${jsonResponses.length}`);
  console.log(`HTML responses: ${htmlResponses.length}`);
  console.log(`Endpoints that created keys: ${keyCreatingTests.length}`);

  if (keyCreatingTests.length > 0) {
    console.log('\n🎉 WORKING ENDPOINTS THAT CREATE KEYS:');
    console.log('-'.repeat(80));
    for (const test of keyCreatingTests) {
      console.log(`  ${test.testId}`);
      console.log(`  Response: ${test.result.body.slice(0, 200)}...`);
      console.log('');
    }
  }

  if (successfulTests.length > 0) {
    console.log('\n✅ ENDPOINTS WITH SUCCESSFUL JSON RESPONSES:');
    console.log('-'.repeat(80));
    for (const test of successfulTests) {
      if (!test.result.hasKey) {
        console.log(`  ${test.testId}`);
        console.log(`  Response: ${test.result.body.slice(0, 200)}...`);
        console.log('');
      }
    }
  }

  // Show 404s (non-existent endpoints)
  const notFoundTests = results.filter(r => r.result.status === 404);
  if (notFoundTests.length > 0) {
    console.log('\n⚠️  ENDPOINTS RETURNING 404 (likely do not exist):');
    console.log('-'.repeat(80));
    for (const test of notFoundTests.slice(0, 10)) {
      console.log(`  ${test.testId}`);
    }
    if (notFoundTests.length > 10) {
      console.log(`  ... and ${notFoundTests.length - 10} more`);
    }
  }

  // Show auth errors
  const authErrors = results.filter(r => r.result.status === 401 || r.result.status === 403);
  if (authErrors.length > 0) {
    console.log('\n🔒 ENDPOINTS REQUIRING AUTH (401/403):');
    console.log('-'.repeat(80));
    for (const test of authErrors.slice(0, 10)) {
      console.log(`  ${test.testId}`);
    }
    if (authErrors.length > 10) {
      console.log(`  ... and ${authErrors.length - 10} more`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('CONCLUSIONS');
  console.log('='.repeat(80));
  
  if (keyCreatingTests.length === 0) {
    console.log('\n❌ No REST endpoints for management key creation were found working.');
    console.log('The OpenRouter dashboard likely uses:');
    console.log('  1. tRPC endpoints (e.g., /api/trpc/managementKeys.create)');
    console.log('  2. Next.js Server Actions (with custom headers)');
    console.log('  3. GraphQL endpoints');
    console.log('\nRecommended next steps:');
    console.log('  - Check browser network logs when creating a management key');
    console.log('  - Look for POST requests to /api/trpc/*');
    console.log('  - Look for POST requests with Next-Action headers');
    console.log('  - Check for GraphQL queries/mutations');
  } else {
    console.log(`\n✅ Found ${keyCreatingTests.length} working endpoint(s)!`);
    console.log('See above for details.');
  }

  // Cleanup
  await store.prisma?.$disconnect?.();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
