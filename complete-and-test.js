#!/usr/bin/env node
// Full automation: Complete OTP sign-in + test all 3 accounts
// Run: node complete-and-test.js

import { PrismaClient } from '@prisma/client';
import { encrypt, encryptConfig, decrypt } from './server/services/storage-codec.js';
import * as dashboardApi from './server/services/dashboard-api.js';
import * as clerkAuth from './server/services/clerk-auth.js';
import fs from 'fs';

const prisma = new PrismaClient();
const deviceId = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const LOG_FILE = '/tmp/hydra-complete-test.log';

// Account definitions
const ACCOUNTS = [
  { id: 'cecff6a9-cbcc-4110-93ec-409299474b82', email: 'iam@zayd.wtf', alias: 'iam-zayd' },
  { id: '529c3bc9-d8b4-49c7-8fee-957e54db4c50', email: 'delilah@zayd.wtf', alias: 'delilah-zayd' },
  { id: '09f8cc49-9308-4977-9f18-15d1a7e13216', email: 'zayd@zayd.wtf', alias: 'zayd-zayd' }
];

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// Check if account needs OTP completion
async function needsOtpCompletion(account) {
  const acc = await prisma.account.findFirst({ where: { id: account.id } });
  if (!acc || !acc.sessionToken) return true;
  
  // Check if session token is empty (just has encryption wrapper)
  const decrypted = decrypt(acc.sessionToken);
  return !decrypted || decrypted.length < 10;
}

// Complete OTP sign-in
async function completeOtp(account, otpCode) {
  log(`🔐 Completing OTP for ${account.alias}...`);
  
  try {
    // Get pending sign-in state from config or start fresh
    const acc = await prisma.account.findFirst({ where: { id: account.id } });
    let config = {};
    try {
      config = JSON.parse(decrypt(acc.config));
    } catch(e) {}
    
    // Start OTP flow
    const startRes = await clerkAuth.startEmailOTP(account.email);
    if (!startRes.success) {
      log(`  ❌ Failed to start OTP: ${startRes.message}`);
      return false;
    }
    
    // Complete with provided code
    const completeRes = await clerkAuth.completeEmailOTP(
      startRes.signInId,
      otpCode,
      startRes.clientCookie
    );
    
    if (!completeRes.success || !completeRes.sessionToken) {
      log(`  ❌ OTP verification failed: ${completeRes.message}`);
      return false;
    }
    
    log(`  ✅ OTP verified! Got session token.`);
    
    // Get dashboard cookies
    const dashboardRes = await fetch('https://openrouter.ai/settings/management-keys', {
      headers: {
        'Cookie': `__session=${completeRes.sessionToken}; ${startRes.clientCookie}`,
        'Accept': 'text/html'
      },
      redirect: 'manual'
    });
    
    // Capture any additional cookies
    const setCookies = dashboardRes.headers.getSetCookie?.() || [];
    let fullClientCookie = startRes.clientCookie;
    setCookies.forEach(c => {
      const key = c.split('=')[0];
      if (!fullClientCookie.includes(key)) {
        fullClientCookie += '; ' + c.split(';')[0];
      }
    });
    
    // Save session
    config.email = account.email;
    config.authMethod = 'otp';
    config.clientCookie = fullClientCookie;
    config.sessionExpiry = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
    
    await prisma.account.update({
      where: { id: account.id },
      data: {
        sessionToken: encrypt(completeRes.sessionToken),
        config: encryptConfig(config)
      }
    });
    
    log(`  ✅ Session saved for ${account.alias}`);
    return true;
  } catch(e) {
    log(`  ❌ Error: ${e.message}`);
    return false;
  }
}

// Refresh session if needed
async function refreshSession(account) {
  const session = await getAccountSession(account.id);
  if (!session) return false;
  
  // Test if session works
  const testRes = await fetch('https://openrouter.ai/settings/management-keys', {
    headers: {
      'Cookie': `__session=${session.sessionCookie}; ${session.clientCookie}`,
      'Accept': 'text/html'
    },
    redirect: 'manual'
  });
  
  if (testRes.status === 200) return true;
  
  // Try to refresh via Clerk
  const clerkRes = await fetch('https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0', {
    headers: {
      'Cookie': session.clientCookie,
      'Origin': 'https://openrouter.ai'
    }
  });
  
  const clerkData = await clerkRes.json();
  const newJwt = clerkData.response?.sessions?.[0]?.last_active_token?.jwt;
  
  if (!newJwt) return false;
  
  // Save new session
  const acc = await prisma.account.findFirst({ where: { id: account.id } });
  let config = JSON.parse(decrypt(acc.config));
  config.sessionExpiry = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
  
  await prisma.account.update({
    where: { id: account.id },
    data: {
      sessionToken: encrypt(newJwt),
      config: encryptConfig(config)
    }
  });
  
  return true;
}

// Get account session
async function getAccountSession(accountId) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId: deviceId }
  });
  if (!account) return null;
  
  const { decrypt } = await import('./server/services/storage-codec.js');
  const sessionCookie = decrypt(account.sessionToken);
  const config = JSON.parse(decrypt(account.config));
  
  return {
    sessionCookie,
    clientCookie: config.clientCookie || '',
    sessionExpiry: config.sessionExpiry
  };
}

// Test Playwright provision
async function testPlaywrightProvision(account) {
  log(`🎭 Testing Playwright provision for ${account.alias}...`);
  
  try {
    const result = await dashboardApi.createManagementKey(
      deviceId,
      account.id,
      `Auto Key ${new Date().toLocaleTimeString()}`
    );
    
    if (result.key) {
      log(`  ✅ SUCCESS: ${result.key.substring(0, 30)}...`);
      return true;
    } else {
      log(`  ❌ FAILED: ${result.message}`);
      return false;
    }
  } catch(e) {
    log(`  ❌ Error: ${e.message}`);
    return false;
  }
}

// Test request-based alternatives
async function testRequestBased(account) {
  log(`🌐 Testing request-based for ${account.alias}...`);
  
  const session = await getAccountSession(account.id);
  if (!session) {
    log(`  ❌ No session`);
    return false;
  }
  
  const cookieHeader = `__session=${session.sessionCookie}; ${session.clientCookie}`;
  const endpoints = [
    'https://openrouter.ai/trpc/managementKeys.create',
    'https://openrouter.ai/trpc/managementKey.create',
    'https://openrouter.ai/api/v1/management-keys'
  ];
  
  for (const url of endpoints) {
    const isTrpc = url.includes('trpc');
    const body = isTrpc
      ? JSON.stringify({ "0": { "json": { "name": "Test Key" } } })
      : JSON.stringify({ name: "Test Key" });
    
    try {
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
        log(`  ✅ REQUEST-BASED WORKS! ${url}`);
        return true;
      }
    } catch(e) {}
  }
  
  log(`  ❌ All endpoints return HTML (React SPA)`);
  return false;
}

// Main test loop
async function runTests() {
  log('='.repeat(70));
  log('🚀 FULL AUTOMATION: 3 ACCOUNTS + PLAYWRIGHT + REQUEST-BASED');
  log('='.repeat(70));
  
  let iteration = 0;
  
  while (true) {
    iteration++;
    log(`\\n📊 ITERATION ${iteration}`);
    log('-'.repeat(70));
    
    for (const account of ACCOUNTS) {
      log(`\\n📧 ${account.alias}`);
      
      // Check if needs OTP completion
      const needsOtp = await needsOtpCompletion(account);
      if (needsOtp) {
        log(`  ⏳ Needs OTP - check email ${account.email}`);
        log(`  ⏳ Run: node complete-otp.js ${account.alias} <CODE>`);
        continue;
      }
      
      // Ensure session valid
      const sessionOk = await refreshSession(account);
      if (!sessionOk) {
        log(`  ❌ Session invalid - needs OTP`);
        continue;
      }
      log(`  ✅ Session valid`);
      
      // Test Playwright
      await testPlaywrightProvision(account);
      
      // Test request-based
      await testRequestBased(account);
    }
    
    log(`\\n⏳ Waiting 30s before iteration ${iteration + 1}...`);
    await new Promise(r => setTimeout(r, 30000));
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  log('\\n🛑 Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

runTests().catch(async (e) => {
  log(`\\n💥 FATAL: ${e.message}`);
  await prisma.$disconnect();
  process.exit(1);
});
