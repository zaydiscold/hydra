#!/usr/bin/env node
/**
 * Focused investigation of Server Action approach
 * Following up on: "Server Action (ID: none)" returning 200 with key indication
 */

import * as store from './server/services/store.js';
import { openRouterDashboardDeviceCookies } from './server/services/clerk-auth.js';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = 'cecff6a9-cbcc-4110-93ec-409299474b82';
const OR_BASE = 'https://openrouter.ai';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    return null;
  } catch (err) {
    return null;
  }
}

async function makeRequest(url, options) {
  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    const bodyText = await response.text();
    
    const hasKey = bodyText.includes('sk-or-v1-');
    const keyMatch = bodyText.match(/sk-or-v1-[a-zA-Z0-9_.-]+/);
    
    return {
      status: response.status,
      ok: response.ok,
      contentType,
      bodyPreview: bodyText.slice(0, 1000),
      hasKey,
      extractedKey: keyMatch ? keyMatch[0] : null,
      isRsc: bodyText.includes('$'),  // RSC (React Server Components) format check
      isHtml: bodyText.includes('<!DOCTYPE') || bodyText.includes('<html'),
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('FOCUSED SERVER ACTION INVESTIGATION');
  console.log('='.repeat(80));
  
  // Get account
  const account = await store.getAccountWithKey(USER_ID, ACCOUNT_ID);
  if (!account) {
    console.error('Account not found');
    process.exit(1);
  }
  
  console.log('\nAccount:', account.alias || account.email);
  
  // Get fresh JWT
  const freshJwt = await getFreshJwt(account.sessionCookie, account.clientCookie || '');
  if (freshJwt) {
    console.log('✅ Fresh JWT obtained');
  }
  
  const deviceCookies = account.clientCookie ? openRouterDashboardDeviceCookies(account.clientCookie) : '';
  const cookieHeader = `__session=${freshJwt || account.sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;
  
  // Test 1: POST to /settings/management-keys without action ID (text/plain)
  console.log('\n--- Test 1: POST /settings/management-keys (text/plain, no Next-Action) ---');
  
  const payloads = [
    JSON.stringify([{ name: 'Hydra Test Key 1' }]),
    JSON.stringify([{ name: 'Hydra Test Key 2', label: 'Hydra Test' }]),
    JSON.stringify([{ json: { name: 'Hydra Test Key 3' } }]),
    JSON.stringify([]),
    'name=Hydra+Test+Key+4',
  ];
  
  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    console.log(`\nPayload ${i + 1}: ${payload.slice(0, 60)}...`);
    
    const result = await makeRequest(`${OR_BASE}/settings/management-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'Cookie': cookieHeader,
        'User-Agent': USER_AGENT,
        'Origin': OR_BASE,
        'Referer': `${OR_BASE}/settings/management-keys`,
        'Accept': 'text/x-component, application/json, */*',
      },
      body: payload
    });
    
    console.log(`  Status: ${result.status}`);
    console.log(`  Content-Type: ${result.contentType}`);
    console.log(`  Is HTML: ${result.isHtml}`);
    console.log(`  Is RSC: ${result.isRsc}`);
    console.log(`  Has Key Pattern: ${result.hasKey}`);
    if (result.extractedKey) {
      console.log(`  🎉 EXTRACTED KEY: ${result.extractedKey.slice(0, 30)}...`);
    }
    if (result.isHtml) {
      console.log(`  HTML Preview: ${result.bodyPreview.slice(0, 200)}...`);
    } else if (!result.isRsc) {
      console.log(`  Body Preview: ${result.bodyPreview.slice(0, 300)}...`);
    }
  }
  
  // Test 2: Try with different Accept headers
  console.log('\n--- Test 2: Different Accept headers ---');
  
  const acceptHeaders = [
    'text/x-component',
    'application/json',
    '*/*',
    'text/html',
    'text/plain',
  ];
  
  for (const accept of acceptHeaders) {
    console.log(`\nAccept: ${accept}`);
    
    const result = await makeRequest(`${OR_BASE}/settings/management-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'Cookie': cookieHeader,
        'User-Agent': USER_AGENT,
        'Origin': OR_BASE,
        'Referer': `${OR_BASE}/settings/management-keys`,
        'Accept': accept,
      },
      body: JSON.stringify([{ name: 'Accept Test Key' }])
    });
    
    console.log(`  Status: ${result.status}, Has Key: ${result.hasKey}`);
  }
  
  // Test 3: Try alternative endpoints that might be Server Actions
  console.log('\n--- Test 3: Alternative Server Action endpoints ---');
  
  const endpoints = [
    '/settings/management-keys',
    '/api/settings/management-keys',
    '/api/keys',
    '/settings/keys',
  ];
  
  for (const endpoint of endpoints) {
    console.log(`\nEndpoint: ${endpoint}`);
    
    const result = await makeRequest(`${OR_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'Cookie': cookieHeader,
        'User-Agent': USER_AGENT,
        'Origin': OR_BASE,
        'Referer': `${OR_BASE}/settings/management-keys`,
        'Accept': 'text/x-component, */*',
      },
      body: JSON.stringify([{ name: 'Endpoint Test Key' }])
    });
    
    console.log(`  Status: ${result.status}, Has Key: ${result.hasKey}`);
    if (result.extractedKey) {
      console.log(`  🎉 KEY: ${result.extractedKey}`);
    }
  }
  
  // Test 4: Try to decode RSC response if we get one
  console.log('\n--- Test 4: Analyzing RSC format responses ---');
  
  const rscResult = await makeRequest(`${OR_BASE}/settings/management-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'Cookie': cookieHeader,
      'User-Agent': USER_AGENT,
      'Origin': OR_BASE,
      'Referer': `${OR_BASE}/settings/management-keys`,
      'Accept': 'text/x-component',
    },
    body: JSON.stringify([{ name: 'RSC Analysis Key' }])
  });
  
  if (rscResult.isRsc || rscResult.bodyPreview.includes('$')) {
    console.log('\nDetected RSC format. Analyzing...');
    console.log('RSC response preview:');
    console.log(rscResult.bodyPreview);
    
    // Try to extract any encoded data from RSC
    const lines = rscResult.bodyPreview.split('\n');
    for (const line of lines.slice(0, 20)) {
      if (line.includes('sk-or-v1-') || line.includes('key') || line.includes('id')) {
        console.log(`  -> ${line.slice(0, 100)}`);
      }
    }
  }
  
  // Test 5: Try with form data approach (multipart/form-data simulation)
  console.log('\n--- Test 5: Simulated form data ---');
  
  const formResult = await makeRequest(`${OR_BASE}/settings/management-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader,
      'User-Agent': USER_AGENT,
      'Origin': OR_BASE,
      'Referer': `${OR_BASE}/settings/management-keys`,
    },
    body: 'name=Form+Test+Key&action=create'
  });
  
  console.log(`Form data status: ${formResult.status}`);
  console.log(`Has key: ${formResult.hasKey}`);
  if (formResult.extractedKey) {
    console.log(`🎉 KEY: ${formResult.extractedKey}`);
  }
  
  // Test 6: Try Next.js action with random ID but correct format
  console.log('\n--- Test 6: Trying various Next-Action header values ---');
  
  const actionIds = [
    'a1b2c3d4e5f6789012345678',  // Random 24-char hex
    'abcd1234efgh5678ijkl9012',
    '000000000000000000000001',
  ];
  
  for (const actionId of actionIds) {
    const result = await makeRequest(`${OR_BASE}/settings/management-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'Cookie': cookieHeader,
        'User-Agent': USER_AGENT,
        'Origin': OR_BASE,
        'Referer': `${OR_BASE}/settings/management-keys`,
        'Accept': 'text/x-component, */*',
        'Next-Action': actionId,
      },
      body: JSON.stringify([{ name: `Action ID ${actionId.slice(0, 8)}` }])
    });
    
    console.log(`Action ID ${actionId.slice(0, 16)}...: Status ${result.status}, Has Key: ${result.hasKey}`);
  }
  
  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('INVESTIGATION COMPLETE');
  console.log('='.repeat(80));
  
  await store.prisma?.$disconnect?.();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
