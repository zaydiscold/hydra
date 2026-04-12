#!/usr/bin/env node
/**
 * Comprehensive HTTP Request Testing for Management Key Provisioning
 * 
 * Tries multiple creative approaches:
 * 1. Various content-types and body formats
 * 2. Different authentication combinations
 * 3. Clerk FAPI endpoints directly
 * 4. Simulated browser requests with full headers
 * 5. tRPC with various payload structures
 * 6. CSRF token extraction and usage
 */

import * as store from './server/services/store.js';
import { openRouterDashboardDeviceCookies } from './server/services/clerk-auth.js';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = 'cecff6a9-cbcc-4110-93ec-409299474b82';
const OR_BASE = 'https://openrouter.ai';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Results tracking
const results = {
  testsRun: 0,
  testsSucceeded: 0,
  keysCreated: 0,
  byCategory: {}
};

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

async function makeRequest(url, options) {
  results.testsRun++;
  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    let body;
    
    try {
      if (contentType.includes('application/json')) {
        body = await response.json();
      } else {
        body = await response.text();
      }
    } catch (e) {
      body = await response.text().catch(() => '');
    }
    
    const hasKey = typeof body === 'string' 
      ? body.includes('sk-or-v1-')
      : JSON.stringify(body).includes('sk-or-v1-');
    
    if (response.ok && hasKey) {
      results.keysCreated++;
    }
    if (response.ok) {
      results.testsSucceeded++;
    }
    
    return {
      status: response.status,
      ok: response.ok,
      contentType,
      body,
      hasKey,
      isHtml: typeof body === 'string' && (body.includes('<!DOCTYPE') || body.includes('<html')),
      headers: Object.fromEntries(response.headers.entries())
    };
  } catch (err) {
    return {
      error: err.message,
      ok: false
    };
  }
}

async function testCategory(name, testFn) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`CATEGORY: ${name}`);
  console.log('='.repeat(80));
  results.byCategory[name] = { tests: 0, success: 0, keys: 0 };
  const startTests = results.testsRun;
  const startSuccess = results.testsSucceeded;
  const startKeys = results.keysCreated;
  
  await testFn();
  
  results.byCategory[name].tests = results.testsRun - startTests;
  results.byCategory[name].success = results.testsSucceeded - startSuccess;
  results.byCategory[name].keys = results.keysCreated - startKeys;
}

// Category 1: Standard REST with variations
async function testStandardRest(sessionCookie, clientCookie, freshJwt) {
  const deviceCookies = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  const cookieHeader = `__session=${freshJwt || sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;
  
  const endpoints = [
    '/api/v1/management-keys',
    '/api/v1/keys',
    '/api/auth/keys',
    '/api/user/keys',
    '/api/account/keys',
    '/api/management/keys',
    '/api/keys/management',
    '/api/settings/keys',
    '/api/dashboard/keys',
  ];
  
  const authMethods = [
    { name: 'Bearer only', headers: { 'Authorization': `Bearer ${freshJwt || sessionCookie}` } },
    { name: 'Cookie only', headers: { 'Cookie': cookieHeader } },
    { name: 'Both', headers: { 'Authorization': `Bearer ${freshJwt || sessionCookie}`, 'Cookie': cookieHeader } },
  ];
  
  for (const endpoint of endpoints) {
    for (const auth of authMethods) {
      const url = `${OR_BASE}${endpoint}`;
      const result = await makeRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'Origin': OR_BASE,
          'Referer': `${OR_BASE}/settings/management-keys`,
          'Accept': 'application/json',
          ...auth.headers
        },
        body: JSON.stringify({ name: 'Test Key' })
      });
      
      console.log(`POST ${endpoint} (${auth.name}): ${result.status || result.error} ${result.hasKey ? '🔑 KEY!' : ''}`);
      if (result.isHtml) console.log('  -> HTML response (auth redirect)');
    }
  }
}

// Category 2: Different Content Types
async function testContentTypes(sessionCookie, clientCookie, freshJwt) {
  const deviceCookies = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  const cookieHeader = `__session=${freshJwt || sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;
  
  const contentTypes = [
    { type: 'application/json', body: JSON.stringify({ name: 'Test Key' }) },
    { type: 'application/x-www-form-urlencoded', body: 'name=Test+Key' },
    { type: 'text/plain', body: JSON.stringify({ name: 'Test Key' }) },
    { type: 'application/json; charset=utf-8', body: JSON.stringify({ name: 'Test Key' }) },
  ];
  
  for (const ct of contentTypes) {
    const url = `${OR_BASE}/api/v1/management-keys`;
    const result = await makeRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': ct.type,
        'Cookie': cookieHeader,
        'User-Agent': USER_AGENT,
        'Origin': OR_BASE,
        'Referer': `${OR_BASE}/settings/management-keys`,
        'Accept': 'application/json',
      },
      body: ct.body
    });
    
    console.log(`Content-Type: ${ct.type}: ${result.status || result.error} ${result.hasKey ? '🔑 KEY!' : ''}`);
  }
}

// Category 3: tRPC Variations
async function testTrpcVariations(sessionCookie, clientCookie, freshJwt) {
  const deviceCookies = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  const cookieHeader = `__session=${freshJwt || sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;
  
  const routes = [
    'managementKeys.create',
    'managementKeys.createKey',
    'keys.createManagement',
    'apiKeys.create',
    'user.createApiKey',
    'settings.createKey',
  ];
  
  const payloadFormats = [
    // Standard tRPC batch format
    (route) => ({
      url: `${OR_BASE}/api/trpc/${route}`,
      body: JSON.stringify({
        json: { name: 'Test Key' }
      })
    }),
    // Batch format with multiple procedures
    (route) => ({
      url: `${OR_BASE}/api/trpc/${route},managementKeys.list`,
      body: JSON.stringify([
        { json: { name: 'Test Key' } },
        { json: {} }
      ])
    }),
    // Alternative body structure
    (route) => ({
      url: `${OR_BASE}/api/trpc/${route}`,
      body: JSON.stringify({
        0: { json: { name: 'Test Key' } }
      })
    }),
    // Query format (GET)
    (route) => ({
      url: `${OR_BASE}/api/trpc/${route}?input=${encodeURIComponent(JSON.stringify({ json: { name: 'Test Key' } }))}`,
      body: null
    }),
  ];
  
  for (const route of routes) {
    for (let i = 0; i < payloadFormats.length; i++) {
      const format = payloadFormats[i];
      const { url, body } = format(route);
      
      const options = {
        method: body ? 'POST' : 'GET',
        headers: {
          'Cookie': cookieHeader,
          'User-Agent': USER_AGENT,
          'Origin': OR_BASE,
          'Referer': `${OR_BASE}/settings/management-keys`,
          'Accept': 'application/json',
          'x-trpc-source': 'nextjs-react',
        }
      };
      
      if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = body;
      }
      
      const result = await makeRequest(url, options);
      console.log(`tRPC ${route} (format ${i + 1}): ${result.status || result.error} ${result.hasKey ? '🔑 KEY!' : ''}`);
    }
  }
}

// Category 4: Next.js Server Actions Simulation
async function testServerActions(sessionCookie, clientCookie, freshJwt) {
  const deviceCookies = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  const cookieHeader = `__session=${freshJwt || sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;
  
  const actionIds = [
    'a0ca7f34a1f80b3f9f5f5f5f5f5f5f5f5f5f5f5f',  // placeholder
    'createManagementKey',
    'createKey',
    '',  // Try without action ID
  ];
  
  const payloads = [
    JSON.stringify([{ name: 'Test Key' }]),
    JSON.stringify([{ json: { name: 'Test Key' } }]),
    JSON.stringify([]),
    'name=Test+Key',  // Form encoded
  ];
  
  for (const actionId of actionIds) {
    for (const payload of payloads) {
      const headers = {
        'Content-Type': payload.startsWith('{') ? 'text/plain;charset=UTF-8' : 'application/x-www-form-urlencoded',
        'Cookie': cookieHeader,
        'User-Agent': USER_AGENT,
        'Origin': OR_BASE,
        'Referer': `${OR_BASE}/settings/management-keys`,
        'Accept': 'text/x-component, application/json',
      };
      
      if (actionId) {
        headers['Next-Action'] = actionId;
      }
      
      const result = await makeRequest(`${OR_BASE}/settings/management-keys`, {
        method: 'POST',
        headers,
        body: payload
      });
      
      console.log(`Server Action (ID: ${actionId || 'none'}, Payload: ${payload.slice(0, 30)}...): ${result.status || result.error} ${result.hasKey ? '🔑 KEY!' : ''}`);
    }
  }
}

// Category 5: Direct Clerk FAPI calls
async function testClerkDirect(sessionCookie, clientCookie) {
  const cookieHeader = `__session=${sessionCookie}; ${clientCookie}`;
  
  // Try various Clerk endpoints
  const clerkEndpoints = [
    'https://clerk.openrouter.ai/v1/client',
    'https://clerk.openrouter.ai/v1/me',
    'https://clerk.openrouter.ai/v1/sessions',
  ];
  
  for (const endpoint of clerkEndpoints) {
    const result = await makeRequest(`${endpoint}?_clerk_js_version=5.0.0`, {
      method: 'GET',
      headers: {
        'Cookie': cookieHeader,
        'Origin': 'https://openrouter.ai',
        'Referer': 'https://openrouter.ai/',
        'User-Agent': USER_AGENT,
      }
    });
    
    console.log(`Clerk ${endpoint.split('/').pop()}: ${result.status || result.error}`);
    if (result.ok && typeof result.body === 'object') {
      console.log('  -> Response keys:', Object.keys(result.body).join(', '));
    }
  }
}

// Category 6: CSRF Extraction and Form Submit
async function testCsrfAndForm(sessionCookie, clientCookie, freshJwt) {
  const deviceCookies = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  const cookieHeader = `__session=${freshJwt || sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;
  
  // First try to get the page to extract any CSRF tokens
  const pageResult = await makeRequest(`${OR_BASE}/settings/management-keys`, {
    method: 'GET',
    headers: {
      'Cookie': cookieHeader,
      'User-Agent': USER_AGENT,
    }
  });
  
  console.log(`GET management-keys page: ${pageResult.status || pageResult.error}`);
  
  if (typeof pageResult.body === 'string') {
    // Try to extract CSRF token
    const csrfMatch = pageResult.body.match(/csrf[_-]token["']?\s*[:=]\s*["']([^"']+)/i) ||
                       pageResult.body.match(/name=["']csrf-token["']\s+value=["']([^"']*)/i) ||
                       pageResult.body.match(/data-csrf=["']([^"']*)/i);
    
    if (csrfMatch) {
      console.log(`Found CSRF token: ${csrfMatch[1].slice(0, 20)}...`);
      
      // Try POST with CSRF token
      const result = await makeRequest(`${OR_BASE}/api/v1/management-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader,
          'X-CSRF-Token': csrfMatch[1],
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({ name: 'Test Key', csrf_token: csrfMatch[1] })
      });
      
      console.log(`POST with CSRF: ${result.status || result.error} ${result.hasKey ? '🔑 KEY!' : ''}`);
    } else {
      console.log('No CSRF token found in page');
    }
  }
}

// Category 7: GraphQL attempts
async function testGraphQL(sessionCookie, clientCookie, freshJwt) {
  const deviceCookies = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  const cookieHeader = `__session=${freshJwt || sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;
  
  const graphqlEndpoints = [
    '/api/graphql',
    '/graphql',
    '/api/gql',
  ];
  
  const mutations = [
    `mutation { createManagementKey(name: "Test Key") { id key } }`,
    `mutation { createKey(name: "Test Key", type: MANAGEMENT) { id key } }`,
    `mutation CreateKey($name: String!) { createManagementKey(input: {name: $name}) { key } }`,
  ];
  
  for (const endpoint of graphqlEndpoints) {
    for (const mutation of mutations) {
      const result = await makeRequest(`${OR_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader,
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({ query: mutation })
      });
      
      console.log(`GraphQL ${endpoint}: ${result.status || result.error} ${result.hasKey ? '🔑 KEY!' : ''}`);
    }
  }
}

// Category 8: Headers manipulation
async function testHeaderVariations(sessionCookie, clientCookie, freshJwt) {
  const deviceCookies = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  const cookieHeader = `__session=${freshJwt || sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;
  
  const headerSets = [
    { 'X-Requested-With': 'XMLHttpRequest' },
    { 'Accept': 'application/json, text/plain, */*' },
    { 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin' },
    { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
    { 'X-TRPC-Source': 'nextjs-react' },
    { 'X-TRPC-Source': 'rsc' },
  ];
  
  for (const extraHeaders of headerSets) {
    const result = await makeRequest(`${OR_BASE}/api/v1/management-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
        'User-Agent': USER_AGENT,
        ...extraHeaders
      },
      body: JSON.stringify({ name: 'Test Key' })
    });
    
    console.log(`Headers ${JSON.stringify(extraHeaders)}: ${result.status || result.error} ${result.hasKey ? '🔑 KEY!' : ''}`);
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('COMPREHENSIVE HTTP REQUEST TESTING');
  console.log(`Account: ${ACCOUNT_ID}`);
  console.log('='.repeat(80));
  
  // Get account
  const account = await store.getAccountWithKey(USER_ID, ACCOUNT_ID);
  if (!account) {
    console.error('Account not found');
    process.exit(1);
  }
  
  console.log('\nAccount:', account.alias || account.email);
  console.log('Has sessionCookie:', !!account.sessionCookie);
  console.log('Has clientCookie:', !!account.clientCookie);
  
  // Get fresh JWT
  console.log('\nFetching fresh JWT from Clerk...');
  const freshJwt = await getFreshJwt(account.sessionCookie, account.clientCookie || '');
  if (freshJwt) {
    console.log('✅ Fresh JWT obtained');
  } else {
    console.log('⚠️ Using original session cookie');
  }
  
  // Run all test categories
  await testCategory('1. Standard REST Endpoints', 
    () => testStandardRest(account.sessionCookie, account.clientCookie, freshJwt));
  
  await testCategory('2. Different Content Types',
    () => testContentTypes(account.sessionCookie, account.clientCookie, freshJwt));
  
  await testCategory('3. tRPC Variations',
    () => testTrpcVariations(account.sessionCookie, account.clientCookie, freshJwt));
  
  await testCategory('4. Next.js Server Actions',
    () => testServerActions(account.sessionCookie, account.clientCookie, freshJwt));
  
  await testCategory('5. Direct Clerk FAPI',
    () => testClerkDirect(account.sessionCookie, account.clientCookie));
  
  await testCategory('6. CSRF and Form Submit',
    () => testCsrfAndForm(account.sessionCookie, account.clientCookie, freshJwt));
  
  await testCategory('7. GraphQL Attempts',
    () => testGraphQL(account.sessionCookie, account.clientCookie, freshJwt));
  
  await testCategory('8. Header Variations',
    () => testHeaderVariations(account.sessionCookie, account.clientCookie, freshJwt));
  
  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(80));
  console.log(`\nTotal tests run: ${results.testsRun}`);
  console.log(`Successful responses: ${results.testsSucceeded}`);
  console.log(`Keys created: ${results.keysCreated}`);
  
  console.log('\nBy category:');
  for (const [name, data] of Object.entries(results.byCategory)) {
    console.log(`  ${name}: ${data.tests} tests, ${data.success} success, ${data.keys} keys`);
  }
  
  if (results.keysCreated === 0) {
    console.log('\n❌ No management keys were created via HTTP requests.');
    console.log('\nThis confirms that OpenRouter management key creation likely requires:');
    console.log('  1. Browser automation (Playwright/Puppeteer), or');
    console.log('  2. A specific internal API not exposed publicly');
  } else {
    console.log(`\n✅ SUCCESS! Created ${results.keysCreated} management key(s) via HTTP!`);
  }
  
  // Cleanup
  await store.prisma?.$disconnect?.();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
