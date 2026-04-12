#!/usr/bin/env node
// Non-stop automated testing for Hydra session management & provisioning
// Run this and it will keep testing until everything works

import * as store from './server/services/store.js';
import * as dashboardApi from './server/services/dashboard-api.js';
import { PrismaClient } from '@prisma/client';
import { encrypt, encryptConfig, decrypt } from './server/services/storage-codec.js';
import fs from 'fs';

const prisma = new PrismaClient();
const deviceId = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const LOG_FILE = '/tmp/hydra-automated-test.log';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function refreshSession(account) {
  log(`🔄 Refreshing ${account.alias}...`);
  
  try {
    const session = await store.getAccountSession(deviceId, account.id);
    if (!session || !session.clientCookie) {
      log(`  ❌ No session or clientCookie for ${account.alias}`);
      return false;
    }
    
    // Get fresh JWT from Clerk
    const clerkRes = await fetch('https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0', {
      headers: {
        'Cookie': session.clientCookie,
        'Origin': 'https://openrouter.ai'
      }
    });
    
    const clerkData = await clerkRes.json();
    const newJwt = clerkData.response?.sessions?.[0]?.last_active_token?.jwt;
    
    if (!newJwt) {
      log(`  ❌ Clerk didn't return JWT for ${account.alias}`);
      return false;
    }
    
    // Test the new JWT
    const testRes = await fetch('https://openrouter.ai/settings/management-keys', {
      headers: {
        'Cookie': `__session=${newJwt}; ${session.clientCookie}`,
        'Accept': 'text/html'
      },
      redirect: 'manual'
    });
    
    if (testRes.status === 200) {
      // Save it
      const config = JSON.parse(decrypt(account.config));
      config.sessionExpiry = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
      
      await prisma.account.update({
        where: { id: account.id },
        data: {
          sessionToken: encrypt(newJwt),
          config: encryptConfig(config)
        }
      });
      
      log(`  ✅ ${account.alias} session refreshed!`);
      return true;
    } else {
      log(`  ❌ Fresh JWT failed with status ${testRes.status}`);
      return false;
    }
  } catch (e) {
    log(`  ❌ Error refreshing ${account.alias}: ${e.message}`);
    return false;
  }
}

async function testPlaywrightProvision(account) {
  log(`🎭 Testing Playwright provision for ${account.alias}...`);
  
  try {
    const result = await dashboardApi.createManagementKey(
      deviceId,
      account.id,
      `Auto Test ${new Date().toLocaleTimeString()}`
    );
    
    if (result.key) {
      log(`  ✅ Playwright SUCCESS - Key: ${result.key.substring(0, 30)}...`);
      return true;
    } else {
      log(`  ❌ Playwright FAILED: ${result.message}`);
      return false;
    }
  } catch (e) {
    log(`  ❌ Playwright error: ${e.message}`);
    return false;
  }
}

async function testRequestBasedProvision(account) {
  log(`🌐 Testing request-based provision for ${account.alias}...`);
  
  try {
    const session = await store.getAccountSession(deviceId, account.id);
    if (!session) {
      log(`  ❌ No session for request-based test`);
      return false;
    }
    
    const cookieHeader = `__session=${session.sessionCookie}; ${session.clientCookie}`;
    
    // Try all known endpoints
    const endpoints = [
      'https://openrouter.ai/trpc/managementKeys.create',
      'https://openrouter.ai/trpc/managementKey.create',
      'https://openrouter.ai/api/v1/management-keys',
      'https://openrouter.ai/api/management-keys'
    ];
    
    for (const url of endpoints) {
      const isTrpc = url.includes('trpc');
      const body = isTrpc
        ? JSON.stringify({ "0": { "json": { "name": "Request Test Key" } } })
        : JSON.stringify({ name: "Request Test Key" });
      
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Cookie': cookieHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': 'https://openrouter.ai',
          'Referer': 'https://openrouter.ai/settings/management-keys'
        },
        body
      });
      
      const text = await res.text();
      
      if (res.status === 200 && text.includes('sk-or')) {
        log(`  ✅ REQUEST-BASED WORKS! Endpoint: ${url}`);
        log(`  Key: ${text.substring(0, 100)}`);
        return true;
      }
    }
    
    log(`  ❌ All request-based endpoints failed (return HTML)`);
    return false;
  } catch (e) {
    log(`  ❌ Request-based error: ${e.message}`);
    return false;
  }
}

async function runTestLoop() {
  log('\\n' + '='.repeat(70));
  log('🚀 STARTING NON-STOP AUTOMATED TEST LOOP');
  log('='.repeat(70));
  
  let iteration = 0;
  
  while (true) {
    iteration++;
    log(`\\n📊 ITERATION ${iteration}`);
    log('-'.repeat(70));
    
    // Get all accounts
    const accounts = await prisma.account.findMany({
      where: { userId: deviceId }
    });
    
    log(`Found ${accounts.length} accounts`);
    
    for (const acc of accounts) {
      // Step 1: Ensure session is valid
      const session = await store.getAccountSession(deviceId, acc.id);
      let sessionValid = false;
      
      if (session) {
        const testRes = await fetch('https://openrouter.ai/settings/management-keys', {
          headers: {
            'Cookie': `__session=${session.sessionCookie}; ${session.clientCookie}`,
            'Accept': 'text/html'
          },
          redirect: 'manual'
        });
        sessionValid = testRes.status === 200;
      }
      
      if (!sessionValid) {
        await refreshSession(acc);
      } else {
        log(`  ✅ ${acc.alias} session already valid`);
      }
      
      // Step 2: Test Playwright provision
      const playwrightWorked = await testPlaywrightProvision(acc);
      
      // Step 3: Test request-based (if Playwright worked, session is definitely good)
      if (playwrightWorked) {
        await testRequestBasedProvision(acc);
      }
    }
    
    // Wait before next iteration
    log(`\\n⏳ Waiting 30 seconds before iteration ${iteration + 1}...`);
    await new Promise(r => setTimeout(r, 30000));
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  log('\\n🛑 Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

runTestLoop().catch(async (e) => {
  log(`\\n💥 FATAL ERROR: ${e.message}`);
  log(e.stack);
  await prisma.$disconnect();
  process.exit(1);
});
