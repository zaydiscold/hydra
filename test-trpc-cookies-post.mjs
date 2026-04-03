#!/usr/bin/env node
/**
 * tRPC Cookie Testing Script - POST with batch format
 * Tests different cookie combinations using proper tRPC POST batch format
 */

import * as store from './server/services/store.js';
import { openRouterDashboardDeviceCookies, validateSession } from './server/services/clerk-auth.js';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = '409dc5b2-9a05-4850-99d4-ebcea164368d';

const TRPC_ENDPOINT = 'https://openrouter.ai/api/trpc/managementKeys.list';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function testTrpcPostWithCookies(testName, cookieHeader, body = null) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${testName}`);
  console.log(`Cookie header: ${cookieHeader.slice(0, 100)}${cookieHeader.length > 100 ? '...' : ''}`);
  
  const headers = {
    'User-Agent': USER_AGENT,
    'Cookie': cookieHeader,
    'Origin': 'https://openrouter.ai',
    'Referer': 'https://openrouter.ai/settings/management-keys',
    'Accept': '*/*',
  };

  const url = body ? `${TRPC_ENDPOINT}?batch=1` : TRPC_ENDPOINT;
  
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  
  try {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const contentType = response.headers.get('content-type') || 'unknown';
    const isJson = contentType.includes('application/json');
    const responseBody = await response.text();
    
    // Check for success indicators
    const isHtml = responseBody.includes('<!DOCTYPE') || responseBody.includes('<html');
    const hasTrpcResult = responseBody.includes('"result"') || responseBody.includes('"data"');
    const hasError = responseBody.includes('"error"');
    const looksLikeAuthError = responseBody.includes('UNAUTHORIZED') || responseBody.includes('FORBIDDEN') || response.status === 401;
    const isCloudflareChallenge = responseBody.includes('cf-challenge') || responseBody.includes('cf_bm') || response.status === 403;
    
    console.log(`Status: ${response.status}`);
    console.log(`Content-Type: ${contentType}`);
    console.log(`Body preview: ${responseBody.slice(0, 200).replace(/\n/g, ' ')}...`);
    console.log(`Is HTML: ${isHtml}`);
    console.log(`Has tRPC result: ${hasTrpcResult}`);
    console.log(`Has error: ${hasError}`);
    console.log(`Looks like auth error: ${looksLikeAuthError}`);
    console.log(`Cloudflare challenge: ${isCloudflareChallenge}`);
    
    // Determine success
    if (response.status === 200 && isJson && hasTrpcResult && !isHtml) {
      console.log('✅ SUCCESS: Valid tRPC JSON response');
      return { success: true, status: response.status, body: responseBody };
    } else if (isHtml) {
      console.log('❌ FAILED: Got HTML instead of JSON (likely redirect to login)');
      return { success: false, status: response.status, reason: 'html_response' };
    } else if (hasError && !hasTrpcResult) {
      console.log('❌ FAILED: tRPC returned error');
      return { success: false, status: response.status, reason: 'trpc_error', body: responseBody };
    } else if (looksLikeAuthError) {
      console.log('❌ FAILED: Authentication error');
      return { success: false, status: response.status, reason: 'auth_error' };
    } else if (isCloudflareChallenge) {
      console.log('❌ FAILED: Cloudflare challenge/bot detection');
      return { success: false, status: response.status, reason: 'cloudflare' };
    } else if (response.status === 200 && isJson) {
      console.log('✅ SUCCESS: JSON response (may be tRPC)');
      return { success: true, status: response.status, body: responseBody };
    } else {
      console.log('⚠️ UNKNOWN: Unexpected response');
      return { success: false, status: response.status, reason: 'unknown' };
    }
  } catch (err) {
    console.log(`❌ ERROR: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function main() {
  console.log('=== tRPC POST Cookie Testing ===');
  console.log('Testing cookie combinations with proper tRPC POST batch format\n');

  // Get account with session
  let account;
  try {
    account = await store.getAccountWithKey(USER_ID, ACCOUNT_ID);
    console.log('Account retrieved:', account.alias || account.id);
  } catch (err) {
    console.error('Failed to get account:', err.message);
    process.exit(1);
  }

  if (!account.sessionCookie) {
    console.error('No sessionCookie found for account');
    process.exit(1);
  }

  // Validate session first
  console.log('\nValidating session...');
  const isValid = await validateSession(account.sessionCookie);
  console.log('Session valid:', isValid);

  // Parse the cookies we have
  const sessionCookie = account.sessionCookie;
  const clientCookieJar = account.clientCookie || '';
  
  console.log('\nSession cookie present:', !!sessionCookie);
  console.log('Session cookie length:', sessionCookie?.length);
  console.log('Client cookie jar present:', !!clientCookieJar);
  console.log('Client cookie jar length:', clientCookieJar?.length);
  
  // Parse individual cookies from the jar
  const allCookies = {};
  if (clientCookieJar) {
    for (const part of clientCookieJar.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) {
        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        allCookies[name] = value;
      }
    }
  }
  
  console.log('\nAvailable cookies in jar:');
  for (const name of Object.keys(allCookies)) {
    console.log(`  - ${name}: ${allCookies[name].slice(0, 30)}...`);
  }

  // tRPC batch body format for managementKeys.list
  const batchBody = {
    "0": {
      "json": {}
    }
  };

  const results = [];

  // Test 1: Just __session with POST
  results.push(await testTrpcPostWithCookies(
    'POST: Just __session',
    `__session=${sessionCookie}`,
    batchBody
  ));

  // Test 2: __session + __client
  const client = allCookies['__client'];
  if (client) {
    results.push(await testTrpcPostWithCookies(
      'POST: __session + __client',
      `__session=${sessionCookie}; __client=${client}`,
      batchBody
    ));
  }

  // Test 3: __session + __client + __client_uat
  const clientUat = allCookies['__client_uat'];
  if (client && clientUat) {
    results.push(await testTrpcPostWithCookies(
      'POST: __session + __client + __client_uat',
      `__session=${sessionCookie}; __client=${client}; __client_uat=${clientUat}`,
      batchBody
    ));
  }

  // Test 4: __session + all Clerk device cookies
  const deviceCookies = openRouterDashboardDeviceCookies(clientCookieJar);
  if (deviceCookies) {
    results.push(await testTrpcPostWithCookies(
      'POST: __session + all Clerk device cookies',
      `__session=${sessionCookie}; ${deviceCookies}`,
      batchBody
    ));
  }

  // Test 5: __session + all Cloudflare cookies
  const cfBm = allCookies['__cf_bm'];
  const cfUvid = allCookies['_cfuvid'];
  if (cfBm || cfUvid) {
    let cfCookies = [];
    if (cfBm) cfCookies.push(`__cf_bm=${cfBm}`);
    if (cfUvid) cfCookies.push(`_cfuvid=${cfUvid}`);
    results.push(await testTrpcPostWithCookies(
      'POST: __session + all Cloudflare cookies',
      `__session=${sessionCookie}; ${cfCookies.join('; ')}`,
      batchBody
    ));
  }

  // Test 6: ALL cookies (current implementation)
  if (clientCookieJar) {
    results.push(await testTrpcPostWithCookies(
      'POST: __session + complete clientCookieJar',
      `__session=${sessionCookie}; ${clientCookieJar}`,
      batchBody
    ));
  }

  // Test 7: ALL cookies + x-trpc-source header
  if (clientCookieJar) {
    console.log('\n--- Testing with x-trpc-source header ---');
    const cookieHeader = `__session=${sessionCookie}; ${clientCookieJar}`;
    console.log(`Cookie header: ${cookieHeader.slice(0, 100)}...`);
    
    try {
      const response = await fetch(`${TRPC_ENDPOINT}?batch=1`, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Cookie': cookieHeader,
          'Origin': 'https://openrouter.ai',
          'Referer': 'https://openrouter.ai/settings/management-keys',
          'Accept': '*/*',
          'Content-Type': 'application/json',
          'x-trpc-source': 'nextjs-react',
        },
        body: JSON.stringify(batchBody),
      });

      const contentType = response.headers.get('content-type') || 'unknown';
      const responseBody = await response.text();
      const isHtml = responseBody.includes('<!DOCTYPE') || responseBody.includes('<html');
      const hasTrpcResult = responseBody.includes('"result"') || responseBody.includes('"data"');
      
      console.log(`Status: ${response.status}`);
      console.log(`Content-Type: ${contentType}`);
      console.log(`Is HTML: ${isHtml}`);
      console.log(`Has tRPC result: ${hasTrpcResult}`);
      console.log(`Body preview: ${responseBody.slice(0, 200)}...`);
      
      if (response.status === 200 && !isHtml && hasTrpcResult) {
        console.log('✅ SUCCESS with x-trpc-source header');
        results.push({ success: true, status: response.status, test: 'x-trpc-source' });
      } else {
        console.log('❌ FAILED even with x-trpc-source header');
        results.push({ success: false, reason: isHtml ? 'html_response' : 'no_result', test: 'x-trpc-source' });
      }
    } catch (err) {
      console.log(`❌ ERROR: ${err.message}`);
      results.push({ success: false, error: err.message, test: 'x-trpc-source' });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  let successCount = 0;
  results.forEach((r, i) => {
    const status = r.success ? '✅' : '❌';
    const testName = r.test || `Test ${i + 1}`;
    console.log(`${status} ${testName}: ${r.success ? 'SUCCESS' : r.reason || 'FAILED'}`);
    if (r.success) successCount++;
  });
  
  console.log(`\nTotal: ${successCount}/${results.length} combinations worked`);
  
  if (successCount === 0) {
    console.log('\n⚠️ All cookie combinations returned HTML. The session may be expired or');
    console.log('   additional authentication headers/cookies may be required.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
