#!/usr/bin/env node
/**
 * tRPC Cookie Testing with Session Refresh
 * First tries to refresh the session, then tests tRPC endpoint
 */

import * as store from './server/services/store.js';
import { openRouterDashboardDeviceCookies, refreshSession, signInWithPassword } from './server/services/clerk-auth.js';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = '409dc5b2-9a05-4850-99d4-ebcea164368d';

const TRPC_ENDPOINT = 'https://openrouter.ai/api/trpc/managementKeys.list';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function testTrpcWithCookies(testName, cookieHeader) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${testName}`);
  console.log(`Cookie header: ${cookieHeader.slice(0, 100)}${cookieHeader.length > 100 ? '...' : ''}`);
  
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
      body: JSON.stringify({ "0": { "json": {} } }),
    });

    const contentType = response.headers.get('content-type') || 'unknown';
    const isJson = contentType.includes('application/json');
    const body = await response.text();
    
    const isHtml = body.includes('<!DOCTYPE') || body.includes('<html');
    const hasTrpcResult = body.includes('"result"') || body.includes('"data"');
    const hasError = body.includes('"error"');
    
    console.log(`Status: ${response.status}`);
    console.log(`Content-Type: ${contentType}`);
    console.log(`Body preview: ${body.slice(0, 200).replace(/\n/g, ' ')}...`);
    console.log(`Is HTML: ${isHtml}`);
    console.log(`Has tRPC result: ${hasTrpcResult}`);
    console.log(`Has error: ${hasError}`);
    
    if (response.status === 200 && isJson && hasTrpcResult && !isHtml) {
      console.log('✅ SUCCESS: Valid tRPC JSON response');
      return { success: true, status: response.status, body };
    } else if (isHtml) {
      console.log('❌ FAILED: Got HTML instead of JSON');
      return { success: false, status: response.status, reason: 'html_response' };
    } else if (hasError && !hasTrpcResult) {
      console.log('❌ FAILED: tRPC error');
      return { success: false, status: response.status, reason: 'trpc_error', body };
    } else {
      console.log('⚠️ UNKNOWN response');
      return { success: false, status: response.status, reason: 'unknown', body };
    }
  } catch (err) {
    console.log(`❌ ERROR: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function main() {
  console.log('=== tRPC Cookie Testing with Session Refresh ===\n');

  // Get account with session
  let account;
  try {
    account = await store.getAccountWithKey(USER_ID, ACCOUNT_ID);
    console.log('Account retrieved:', account.alias || account.id);
    console.log('Has password:', !!account.password);
    console.log('Has session:', !!account.sessionCookie);
    console.log('Has clientCookie:', !!account.clientCookie);
  } catch (err) {
    console.error('Failed to get account:', err.message);
    process.exit(1);
  }

  let sessionCookie = account.sessionCookie;
  let clientCookie = account.clientCookie;

  // Try to refresh the session
  console.log('\n--- Attempting to refresh session ---');
  if (clientCookie) {
    try {
      const refreshed = await refreshSession(clientCookie);
      if (refreshed) {
        console.log('✅ Session refreshed successfully!');
        console.log('New session length:', refreshed.sessionCookie?.length);
        console.log('Session expiry:', refreshed.sessionExpiry);
        sessionCookie = refreshed.sessionCookie;
        clientCookie = refreshed.clientCookie || clientCookie;
        
        // Update the stored session
        await store.updateAccountSession(
          USER_ID,
          ACCOUNT_ID,
          refreshed.sessionCookie,
          clientCookie,
          refreshed.sessionExpiry
        );
        console.log('Updated stored session');
      } else {
        console.log('❌ Session refresh returned null');
      }
    } catch (err) {
      console.log('❌ Session refresh failed:', err.message);
    }
  }

  // If no session and we have password, try sign in
  if (!sessionCookie && account.password && account.email) {
    console.log('\n--- Attempting password sign-in ---');
    try {
      const signInResult = await signInWithPassword(account.email, account.password);
      console.log('✅ Sign-in successful!');
      console.log('Session length:', signInResult.sessionCookie?.length);
      sessionCookie = signInResult.sessionCookie;
      clientCookie = signInResult.clientCookie;
      
      // Update the stored session
      await store.updateAccountSession(
        USER_ID,
        ACCOUNT_ID,
        signInResult.sessionCookie,
        clientCookie,
        signInResult.sessionExpiry
      );
      console.log('Updated stored session');
    } catch (err) {
      console.log('❌ Sign-in failed:', err.message);
    }
  }

  if (!sessionCookie) {
    console.log('\n❌ No valid session available. Cannot test tRPC.');
    process.exit(1);
  }

  console.log('\n=== Testing tRPC with fresh session ===');

  // Parse individual cookies from the jar
  const allCookies = {};
  if (clientCookie) {
    for (const part of clientCookie.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) {
        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        allCookies[name] = value;
      }
    }
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

  // Test 3: __session + __client + __client_uat
  const clientUat = allCookies['__client_uat'];
  if (client && clientUat) {
    results.push(await testTrpcWithCookies(
      '__session + __client + __client_uat',
      `__session=${sessionCookie}; __client=${client}; __client_uat=${clientUat}`
    ));
  }

  // Test 4: __session + __cf_bm
  const cfBm = allCookies['__cf_bm'];
  if (cfBm) {
    results.push(await testTrpcWithCookies(
      '__session + __cf_bm (Cloudflare)',
      `__session=${sessionCookie}; __cf_bm=${cfBm}`
    ));
  }

  // Test 5: __session + all Cloudflare cookies
  const cfUvid = allCookies['_cfuvid'];
  if (cfBm || cfUvid) {
    let cfCookies = [];
    if (cfBm) cfCookies.push(`__cf_bm=${cfBm}`);
    if (cfUvid) cfCookies.push(`_cfuvid=${cfUvid}`);
    results.push(await testTrpcWithCookies(
      '__session + all Cloudflare cookies',
      `__session=${sessionCookie}; ${cfCookies.join('; ')}`
    ));
  }

  // Test 6: __session + all Clerk device cookies
  const deviceCookies = openRouterDashboardDeviceCookies(clientCookie);
  if (deviceCookies) {
    results.push(await testTrpcWithCookies(
      '__session + all Clerk device cookies',
      `__session=${sessionCookie}; ${deviceCookies}`
    ));
  }

  // Test 7: ALL cookies (current implementation)
  if (clientCookie) {
    results.push(await testTrpcWithCookies(
      '__session + complete clientCookieJar',
      `__session=${sessionCookie}; ${clientCookie}`
    ));
  }

  // Test 8: Cookie ordering - Clerk first
  if (deviceCookies) {
    results.push(await testTrpcWithCookies(
      'Device cookies FIRST (ordering test)',
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
  
  if (successCount > 0) {
    console.log('\n✅ At least one cookie combination works with tRPC!');
    
    // Find which combination worked
    const working = results.find(r => r.success);
    if (working) {
      console.log('Working combination identified above.');
    }
  } else {
    console.log('\n❌ No cookie combination worked even with fresh session.');
    console.log('This suggests tRPC may need additional headers or cookies.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
