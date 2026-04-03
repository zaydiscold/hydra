#!/usr/bin/env node
/**
 * tRPC Cookie Testing Script
 * Tests different cookie combinations against OpenRouter's tRPC endpoint
 * to determine which cookies are required for authentication.
 */

import * as store from './server/services/store.js';
import { openRouterDashboardDeviceCookies } from './server/services/clerk-auth.js';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = '409dc5b2-9a05-4850-99d4-ebcea164368d';

const TRPC_ENDPOINT = 'https://openrouter.ai/api/trpc/managementKeys.list';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function testTrpcWithCookies(testName, cookieHeader) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${testName}`);
  console.log(`Cookie header: ${cookieHeader.slice(0, 100)}${cookieHeader.length > 100 ? '...' : ''}`);
  
  try {
    const response = await fetch(TRPC_ENDPOINT, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Cookie': cookieHeader,
        'Origin': 'https://openrouter.ai',
        'Referer': 'https://openrouter.ai/settings/management-keys',
        'Accept': 'application/json',
      },
    });

    const contentType = response.headers.get('content-type') || 'unknown';
    const isJson = contentType.includes('application/json');
    const body = await response.text();
    
    // Check for success indicators
    const isHtml = body.includes('<!DOCTYPE') || body.includes('<html');
    const hasTrpcResult = body.includes('"result"') || body.includes('"data"');
    const looksLikeAuthError = body.includes('UNAUTHORIZED') || body.includes('FORBIDDEN') || response.status === 401;
    const isCloudflareChallenge = body.includes('cf-challenge') || body.includes('__cf_bm') || response.status === 403;
    
    console.log(`Status: ${response.status}`);
    console.log(`Content-Type: ${contentType}`);
    console.log(`Body preview: ${body.slice(0, 150).replace(/\n/g, ' ')}...`);
    console.log(`Is HTML: ${isHtml}`);
    console.log(`Has tRPC result: ${hasTrpcResult}`);
    console.log(`Looks like auth error: ${looksLikeAuthError}`);
    console.log(`Cloudflare challenge: ${isCloudflareChallenge}`);
    
    // Determine success
    if (response.status === 200 && isJson && hasTrpcResult && !isHtml) {
      console.log('✅ SUCCESS: Valid tRPC JSON response');
      return { success: true, status: response.status, body };
    } else if (isHtml) {
      console.log('❌ FAILED: Got HTML instead of JSON (likely redirect to login)');
      return { success: false, status: response.status, reason: 'html_response' };
    } else if (looksLikeAuthError) {
      console.log('❌ FAILED: Authentication error');
      return { success: false, status: response.status, reason: 'auth_error' };
    } else if (isCloudflareChallenge) {
      console.log('❌ FAILED: Cloudflare challenge/bot detection');
      return { success: false, status: response.status, reason: 'cloudflare' };
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
  console.log('=== tRPC Cookie Testing ===');
  console.log('Testing various cookie combinations against OpenRouter tRPC\n');

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

  const results = [];

  // Test 1: Just __session
  results.push(await testTrpcWithCookies(
    'Just __session',
    `__session=${sessionCookie}`
  ));

  // Test 2: __session + __client
  const client = allCookies['__client'];
  if (client) {
    results.push(await testTrpcWithCookies(
      '__session + __client',
      `__session=${sessionCookie}; __client=${client}`
    ));
  }

  // Test 3: __session + __client_uat
  const clientUat = allCookies['__client_uat'];
  if (clientUat) {
    results.push(await testTrpcWithCookies(
      '__session + __client_uat',
      `__session=${sessionCookie}; __client_uat=${clientUat}`
    ));
  }

  // Test 4: __session + __client + __client_uat
  if (client && clientUat) {
    results.push(await testTrpcWithCookies(
      '__session + __client + __client_uat',
      `__session=${sessionCookie}; __client=${client}; __client_uat=${clientUat}`
    ));
  }

  // Test 5: __session + all Clerk device cookies
  const deviceCookies = openRouterDashboardDeviceCookies(clientCookieJar);
  if (deviceCookies) {
    results.push(await testTrpcWithCookies(
      '__session + all Clerk device cookies (via openRouterDashboardDeviceCookies)',
      `__session=${sessionCookie}; ${deviceCookies}`
    ));
  }

  // Test 6: __session + __cf_bm (Cloudflare bot management)
  const cfBm = allCookies['__cf_bm'];
  if (cfBm) {
    results.push(await testTrpcWithCookies(
      '__session + __cf_bm',
      `__session=${sessionCookie}; __cf_bm=${cfBm}`
    ));
  }

  // Test 7: __session + _cfuvid (Cloudflare unique visitor)
  const cfUvid = allCookies['_cfuvid'];
  if (cfUvid) {
    results.push(await testTrpcWithCookies(
      '__session + _cfuvid',
      `__session=${sessionCookie}; _cfuvid=${cfUvid}`
    ));
  }

  // Test 8: __session + all Cloudflare cookies
  if (cfBm || cfUvid) {
    let cfCookies = [];
    if (cfBm) cfCookies.push(`__cf_bm=${cfBm}`);
    if (cfUvid) cfCookies.push(`_cfuvid=${cfUvid}`);
    results.push(await testTrpcWithCookies(
      '__session + all Cloudflare cookies',
      `__session=${sessionCookie}; ${cfCookies.join('; ')}`
    ));
  }

  // Test 9: ALL cookies (current implementation)
  if (clientCookieJar) {
    results.push(await testTrpcWithCookies(
      '__session + complete clientCookieJar (as stored)',
      `__session=${sessionCookie}; ${clientCookieJar}`
    ));
  }

  // Test 10: Check if cookie ordering matters - put device cookies first
  if (deviceCookies) {
    results.push(await testTrpcWithCookies(
      'Device cookies FIRST, then __session (ordering test)',
      `${deviceCookies}; __session=${sessionCookie}`
    ));
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  let successCount = 0;
  results.forEach((r, i) => {
    const status = r.success ? '✅' : '❌';
    console.log(`${status} Test ${i + 1}: ${r.success ? 'SUCCESS' : r.reason || 'FAILED'}`);
    if (r.success) successCount++;
  });
  
  console.log(`\nTotal: ${successCount}/${results.length} combinations worked`);
  
  if (successCount === 0) {
    console.log('\n⚠️ WARNING: No cookie combination worked. Possible issues:');
    console.log('  1. Session may be expired');
    console.log('  2. Additional headers may be required');
    console.log('  3. Cloudflare may be blocking the request');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
