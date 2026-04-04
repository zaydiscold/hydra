#!/usr/bin/env node
/**
 * Deep dive into Server Action responses to verify actual key creation
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

async function main() {
  console.log('='.repeat(80));
  console.log('SERVER ACTION RESPONSE DEEP DIVE');
  console.log('='.repeat(80));
  
  // Get account
  const account = await store.getAccountWithKey(USER_ID, ACCOUNT_ID);
  if (!account) {
    console.error('Account not found');
    process.exit(1);
  }
  
  const freshJwt = await getFreshJwt(account.sessionCookie, account.clientCookie || '');
  const deviceCookies = account.clientCookie ? openRouterDashboardDeviceCookies(account.clientCookie) : '';
  const cookieHeader = `__session=${freshJwt || account.sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;
  
  console.log('\n1. First, GET the management-keys page to see initial state:');
  
  const getResponse = await fetch(`${OR_BASE}/settings/management-keys`, {
    method: 'GET',
    headers: {
      'Cookie': cookieHeader,
      'User-Agent': USER_AGENT,
    }
  });
  
  const getBody = await getResponse.text();
  const initialKeys = getBody.match(/sk-or-v1-[a-zA-Z0-9_.-]+/g) || [];
  console.log(`\nKeys found in initial GET: ${initialKeys.length}`);
  initialKeys.forEach((key, i) => console.log(`  ${i + 1}: ${key.slice(0, 40)}...`));
  
  console.log('\n2. POST with JSON payload to create a new key:');
  
  const uniqueKeyName = `Hydra Test ${Date.now()}`;
  const postResponse = await fetch(`${OR_BASE}/settings/management-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'Cookie': cookieHeader,
      'User-Agent': USER_AGENT,
      'Origin': OR_BASE,
      'Referer': `${OR_BASE}/settings/management-keys`,
      'Accept': 'text/x-component, */*',
    },
    body: JSON.stringify([{ name: uniqueKeyName }])
  });
  
  console.log(`\nPOST Status: ${postResponse.status}`);
  console.log(`POST Content-Type: ${postResponse.headers.get('content-type')}`);
  
  const postBody = await postResponse.text();
  
  // Check if it's a redirect
  if (postResponse.status === 302 || postResponse.headers.get('location')) {
    console.log(`Redirect location: ${postResponse.headers.get('location')}`);
  }
  
  // Look for the key in the response
  const postKeys = postBody.match(/sk-or-v1-[a-zA-Z0-9_.-]+/g) || [];
  console.log(`\nKeys found in POST response: ${postKeys.length}`);
  postKeys.forEach((key, i) => console.log(`  ${i + 1}: ${key.slice(0, 60)}${key.length > 60 ? '...' : ''}`));
  
  // Check for success indicators
  console.log('\n3. Analyzing response for success indicators:');
  
  const hasSuccessIndicator = postBody.includes('success') || 
                              postBody.includes('created') ||
                              postBody.includes('added');
  console.log(`Has success indicator: ${hasSuccessIndicator}`);
  
  // Check for error indicators
  const hasErrorIndicator = postBody.includes('error') ||
                            postBody.includes('Error') ||
                            postBody.includes('unauthorized');
  console.log(`Has error indicator: ${hasErrorIndicator}`);
  
  // Check if response contains the key name we sent
  const hasKeyName = postBody.includes(uniqueKeyName);
  console.log(`Response contains our key name "${uniqueKeyName}": ${hasKeyName}`);
  
  // Look for JSON in the response that might contain API results
  console.log('\n4. Looking for JSON structures in response:');
  
  const jsonMatches = postBody.match(/\{[^}]*"(?:key|id|name|token)[^}]*\}/g) || [];
  console.log(`Found ${jsonMatches.length} potential JSON structures`);
  jsonMatches.slice(0, 5).forEach((match, i) => {
    console.log(`  ${i + 1}: ${match.slice(0, 100)}...`);
  });
  
  // Look for RSC (React Server Components) specific format
  console.log('\n5. Looking for RSC stream markers:');
  
  const rscLines = postBody.split('\n').filter(line => line.trim().length > 0);
  console.log(`Total lines in response: ${rscLines.length}`);
  
  // RSC streams often start with markers like "0:", "1:", etc.
  const rscMarkers = rscLines.filter(line => /^\d+:/.test(line));
  console.log(`Lines with RSC markers (N:): ${rscMarkers.length}`);
  
  if (rscMarkers.length > 0) {
    console.log('\nFirst few RSC markers:');
    rscMarkers.slice(0, 5).forEach((line, i) => {
      console.log(`  ${i + 1}: ${line.slice(0, 100)}...`);
    });
  }
  
  // Save the full response for manual inspection
  console.log('\n6. Saving full response to /tmp/server-action-response.html...');
  const fs = await import('fs');
  fs.writeFileSync('/tmp/server-action-response.html', postBody);
  console.log('Response saved. You can inspect it manually.');
  
  // Test 3: Try to make another POST to see if we get a different key
  console.log('\n7. Making second POST to verify key uniqueness:');
  
  const secondResponse = await fetch(`${OR_BASE}/settings/management-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'Cookie': cookieHeader,
      'User-Agent': USER_AGENT,
      'Origin': OR_BASE,
      'Referer': `${OR_BASE}/settings/management-keys`,
      'Accept': 'text/x-component, */*',
    },
    body: JSON.stringify([{ name: `Second Test ${Date.now()}` }])
  });
  
  const secondBody = await secondResponse.text();
  const secondKeys = secondBody.match(/sk-or-v1-[a-zA-Z0-9_.-]+/g) || [];
  
  console.log(`\nSecond POST keys: ${secondKeys.length}`);
  secondKeys.forEach((key, i) => console.log(`  ${i + 1}: ${key.slice(0, 60)}...`));
  
  // Check if keys are the same
  const sameKeys = postKeys.length === secondKeys.length && 
                   postKeys.every((key, i) => key === secondKeys[i]);
  console.log(`\nAre the keys from both POSTs identical? ${sameKeys}`);
  
  if (sameKeys) {
    console.log('\n⚠️ WARNING: Keys are identical. This suggests the keys were not newly created');
    console.log('           but are instead embedded in the page (existing keys).');
  } else {
    console.log('\n✅ Keys are different. This suggests new keys may be being created!');
  }
  
  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Initial GET keys: ${initialKeys.length}`);
  console.log(`First POST keys: ${postKeys.length}`);
  console.log(`Second POST keys: ${secondKeys.length}`);
  console.log(`Keys identical: ${sameKeys}`);
  console.log(`Has key name in response: ${hasKeyName}`);
  console.log(`Has success indicator: ${hasSuccessIndicator}`);
  
  if (!sameKeys && !hasKeyName) {
    console.log('\n❌ Cannot confirm key creation. The endpoint may be creating keys but');
    console.log('   not returning them in a format we can extract.');
  } else if (sameKeys) {
    console.log('\n❌ Server Action appears to NOT create new keys. The keys in the');
    console.log('   response are already-existing keys embedded in the page HTML.');
  }
  
  await store.prisma?.$disconnect?.();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
