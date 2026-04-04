#!/usr/bin/env node
/**
 * Session Validation Test
 * Tests if the current session cookies are valid for tRPC calls
 */

import * as store from './server/services/store.js';
import { openRouterDashboardDeviceCookies } from './server/services/clerk-auth.js';

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

async function testTrpcList(route, sessionCookie, clientCookie, freshJwt, usePost = true) {
  const url = `${OR_BASE}/api/trpc/${route}${usePost ? '?batch=1' : ''}`;
  const body = usePost ? JSON.stringify({ '0': { json: {} } }) : undefined;
  
  const deviceCookies = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
  const cookieHeader = `__session=${freshJwt || sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;

  try {
    const response = await fetch(url, {
      method: usePost ? 'POST' : 'GET',
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
    const hasResult = responseBody.includes('"result"');
    const hasError = responseBody.includes('"error"');
    
    return {
      status: response.status,
      contentType,
      isJson,
      isHtml,
      hasResult,
      hasError,
      body: responseBody.slice(0, 500),
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
  console.log('SESSION VALIDATION TEST');
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
    console.error('No session cookie found');
    process.exit(1);
  }

  // Show session cookie info (redacted)
  const sessionParts = account.sessionCookie.split('.');
  console.log('Session Cookie:');
  console.log('  Parts:', sessionParts.length);
  if (sessionParts.length >= 2) {
    try {
      const payload = JSON.parse(Buffer.from(sessionParts[1], 'base64url').toString());
      console.log('  Subject:', payload.sub || 'N/A');
      console.log('  Issuer:', payload.iss || 'N/A');
      console.log('  Expiry:', payload.exp ? new Date(payload.exp * 1000).toISOString() : 'N/A');
    } catch (e) {
      console.log('  Could not parse payload');
    }
  }
  console.log('');

  // Get fresh JWT
  console.log('Fetching fresh JWT from Clerk...');
  const freshJwt = await getFreshJwt(account.sessionCookie, account.clientCookie || '');
  if (freshJwt) {
    console.log('✅ Fresh JWT obtained');
    const freshParts = freshJwt.split('.');
    if (freshParts.length >= 2) {
      try {
        const payload = JSON.parse(Buffer.from(freshParts[1], 'base64url').toString());
        console.log('Fresh JWT Expiry:', payload.exp ? new Date(payload.exp * 1000).toISOString() : 'N/A');
      } catch (e) {}
    }
  } else {
    console.log('❌ Could not get fresh JWT');
  }
  console.log('');

  // Test various tRPC list endpoints
  const listRoutes = [
    'managementKeys.list',
    'apiKeys.list',
    'keys.list',
    'user.keys',
    'account.keys',
    'settings.keys',
  ];

  console.log('Testing tRPC list endpoints...');
  console.log('='.repeat(80));

  for (const route of listRoutes) {
    console.log(`\nTesting: ${route}`);
    
    // Try POST
    const postResult = await testTrpcList(route, account.sessionCookie, account.clientCookie, freshJwt, true);
    console.log(`  POST Status: ${postResult.status}`);
    console.log(`  POST Is JSON: ${postResult.isJson}`);
    console.log(`  POST Is HTML: ${postResult.isHtml}`);
    console.log(`  POST Has Result: ${postResult.hasResult}`);
    
    if (postResult.success) {
      console.log(`  ✅ POST SUCCESS`);
    } else if (postResult.isHtml) {
      console.log(`  ❌ POST returned HTML (auth issue)`);
    } else if (postResult.hasError) {
      console.log(`  ⚠️ POST returned error`);
    }

    // Try GET
    const getResult = await testTrpcList(route, account.sessionCookie, account.clientCookie, freshJwt, false);
    console.log(`  GET Status: ${getResult.status}`);
    console.log(`  GET Is JSON: ${getResult.isJson}`);
    console.log(`  GET Is HTML: ${getResult.isHtml}`);
    console.log(`  GET Has Result: ${getResult.hasResult}`);
    
    if (getResult.success) {
      console.log(`  ✅ GET SUCCESS`);
    } else if (getResult.isHtml) {
      console.log(`  ❌ GET returned HTML (auth issue)`);
    } else if (getResult.hasError) {
      console.log(`  ⚠️ GET returned error`);
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n' + '='.repeat(80));
  console.log('CONCLUSION');
  console.log('='.repeat(80));
  console.log('');
  console.log('If all endpoints return HTML, the session may be expired.');
  console.log('If any endpoint returns JSON with result, the session is valid.');
  console.log('');
  console.log('Next steps:');
  console.log('  1. If session is invalid, re-authenticate via OTP');
  console.log('  2. Check if Cloudflare cookies (__cf_bm, cf_clearance) are required');
  console.log('  3. Try with a browser automation tool to capture live network traffic');

  // Cleanup
  await store.prisma?.$disconnect?.();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
