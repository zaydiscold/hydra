#!/usr/bin/env node
/**
 * Test OpenRouter Server Action for Management Key Creation
 * Attempts to directly call the discovered Next.js Server Action endpoint
 */

import * as store from './server/services/store.js';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = 'cecff6a9-cbcc-4110-93ec-409299474b82';

// Action ID discovered from network capture
const ACTION_ID = '00ba0cca67cdca18c29a01625210c65fbda7039b6d';

async function getFreshJwt(sessionCookie, clientCookie) {
  const fullCookie = `__session=${sessionCookie}; ${clientCookie}`;
  try {
    const res = await fetch("https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0", {
      headers: {
        "Cookie": fullCookie,
        "Origin": "https://openrouter.ai",
        "Referer": "https://openrouter.ai/",
      }
    });
    const data = await res.json();
    return data?.response?.sessions?.[0]?.last_active_token?.jwt;
  } catch(e) {
    console.error("Failed to get fresh JWT:", e.message);
    return null;
  }
}

async function testServerAction(session) {
  const freshJwt = await getFreshJwt(session.sessionCookie, session.clientCookie);
  
  console.log('='.repeat(80));
  console.log('TESTING NEXT.JS SERVER ACTION');
  console.log('='.repeat(80));
  console.log('Account ID:', ACCOUNT_ID);
  console.log('Action ID:', ACTION_ID);
  console.log('Fresh JWT:', freshJwt ? '✅ Obtained' : '❌ Failed');
  console.log('');

  // Parse client cookies
  const clientParts = {};
  if (session.clientCookie) {
    for (const part of session.clientCookie.split("; ")) {
      if (part.includes("=")) {
        const idx = part.indexOf("=");
        clientParts[part.slice(0, idx)] = part.slice(idx + 1);
      }
    }
  }

  const cookieHeader = [
    `__session=${freshJwt || session.sessionCookie}`,
    clientParts["__client"] ? `__client=${clientParts["__client"]}` : '',
    clientParts["__client_uat"] ? `__client_uat=${clientParts["__client_uat"]}` : '',
    clientParts["__cf_bm"] ? `__cf_bm=${clientParts["__cf_bm"]}` : '',
    clientParts["_cfuvid"] ? `_cfuvid=${clientParts["_cfuvid"]}` : ''
  ].filter(Boolean).join('; ');

  // Headers from the captured network request
  const headers = {
    'accept': 'text/x-component',
    'content-type': 'text/plain;charset=UTF-8',
    'next-action': ACTION_ID,
    'origin': 'https://openrouter.ai',
    'referer': 'https://openrouter.ai/settings/management-keys',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'cookie': cookieHeader,
    'sec-ch-ua': '"Not:A-Brand";v="99", "Chromium";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
  };

  console.log('Request Headers:');
  console.log(JSON.stringify(headers, null, 2));
  console.log('');

  // Test 1: Empty body (initial call)
  console.log('Test 1: Empty body []');
  try {
    const response = await fetch('https://openrouter.ai/settings/management-keys', {
      method: 'POST',
      headers,
      body: '[]',
    });

    const responseText = await response.text();
    console.log('Status:', response.status);
    console.log('Content-Type:', response.headers.get('content-type'));
    console.log('Response (first 500 chars):', responseText.substring(0, 500));
    
    if (response.status === 200 && responseText.includes('"__kind":"OK"')) {
      console.log('✅ SUCCESS - Server Action accepted the request');
    } else if (responseText.includes('error') || response.status >= 400) {
      console.log('❌ ERROR - Server rejected the request');
    } else {
      console.log('⚠️ UNKNOWN - Unexpected response');
    }
  } catch (err) {
    console.log('❌ REQUEST FAILED:', err.message);
  }

  console.log('');
  console.log('='.repeat(80));

  // Test 2: With mutation arguments
  console.log('Test 2: With mutation arguments ["create", {"name": "Test Key"}]');
  try {
    const mutationBody = JSON.stringify(["$K1", { "name": "Test Server Action Key", "description": "" }]);
    
    const response = await fetch('https://openrouter.ai/settings/management-keys', {
      method: 'POST',
      headers,
      body: mutationBody,
    });

    const responseText = await response.text();
    console.log('Status:', response.status);
    console.log('Content-Type:', response.headers.get('content-type'));
    console.log('Response (first 1000 chars):', responseText.substring(0, 1000));
    
    // Check for the created key in response
    if (responseText.includes('sk-or-v1-')) {
      console.log('✅ SUCCESS - Key appears to have been created!');
      // Try to extract the key
      const keyMatch = responseText.match(/sk-or-v1-[a-zA-Z0-9]+/);
      if (keyMatch) {
        console.log('🔑 Key found:', keyMatch[0].substring(0, 20) + '...');
      }
    } else if (response.status === 200) {
      console.log('✅ Request succeeded but no key in response');
    } else {
      console.log('❌ Request failed');
    }
  } catch (err) {
    console.log('❌ REQUEST FAILED:', err.message);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('CONCLUSION');
  console.log('='.repeat(80));
  console.log('The Server Action endpoint requires the exact same-page context and');
  console.log('possibly additional state (next-router-state-tree) to work correctly.');
  console.log('');
  console.log('Next steps:');
  console.log('1. Capture the full request including next-router-state-tree header');
  console.log('2. Decode the Server Action arguments format');
  console.log('3. Consider using browser automation for full fidelity');
}

async function main() {
  const session = await store.getAccountSession(USER_ID, ACCOUNT_ID);
  if (!session) {
    console.error('❌ Session not found');
    process.exit(1);
  }

  await testServerAction(session);
  
  await store.prisma?.$disconnect?.();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
