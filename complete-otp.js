#!/usr/bin/env node
// Complete OTP for a specific account: node complete-otp.js delilah-zayd 123456

import { PrismaClient } from '@prisma/client';
import { encrypt, encryptConfig, decrypt } from './server/services/storage-codec.js';
import * as clerkAuth from './server/services/clerk-auth.js';

const prisma = new PrismaClient();
const deviceId = '26d94c8c-5294-4841-855c-2ae12d4490fe';

const ACCOUNTS = {
  'delilah-zayd': { id: '529c3bc9-d8b4-49c7-8fee-957e54db4c50', email: 'delilah@zayd.wtf' },
  'zayd-zayd': { id: '09f8cc49-9308-4977-9f18-15d1a7e13216', email: 'zayd@zayd.wtf' },
  'iam-zayd': { id: 'cecff6a9-cbcc-4110-93ec-409299474b82', email: 'iam@zayd.wtf' }
};

async function completeOtp(alias, otpCode) {
  console.log(`🔐 Completing OTP for ${alias} with code ${otpCode}...`);
  
  const account = ACCOUNTS[alias];
  if (!account) {
    console.log(`❌ Unknown alias: ${alias}`);
    console.log(`Available: ${Object.keys(ACCOUNTS).join(', ')}`);
    process.exit(1);
  }
  
  try {
    // Start OTP flow
    const startRes = await clerkAuth.startEmailOTP(account.email);
    if (!startRes.success) {
      console.log(`❌ Failed to start OTP: ${startRes.message}`);
      process.exit(1);
    }
    
    console.log(`✅ OTP flow started`);
    console.log(`  SignIn ID: ${startRes.signInId?.slice(0, 20)}...`);
    
    // Complete with code
    const completeRes = await clerkAuth.completeEmailOTP(
      startRes.signInId,
      otpCode,
      startRes.clientCookie
    );
    
    if (!completeRes.success || !completeRes.sessionToken) {
      console.log(`❌ OTP verification failed: ${completeRes.message}`);
      process.exit(1);
    }
    
    console.log(`✅ OTP verified! Got session.`);
    
    // Get dashboard cookies
    const dashboardRes = await fetch('https://openrouter.ai/settings/management-keys', {
      headers: {
        'Cookie': `__session=${completeRes.sessionToken}; ${startRes.clientCookie}`,
        'Accept': 'text/html'
      },
      redirect: 'manual'
    });
    
    // Capture additional cookies
    const setCookies = dashboardRes.headers.getSetCookie?.() || [];
    let fullClientCookie = startRes.clientCookie;
    setCookies.forEach(c => {
      const key = c.split('=')[0];
      if (!fullClientCookie.includes(key)) {
        fullClientCookie += '; ' + c.split(';')[0];
      }
    });
    
    // Save session
    const acc = await prisma.account.findFirst({ where: { id: account.id } });
    let config = {};
    try {
      config = JSON.parse(decrypt(acc.config));
    } catch(e) {
      config = { email: account.email, authMethod: 'otp' };
    }
    
    config.clientCookie = fullClientCookie;
    config.sessionExpiry = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
    
    await prisma.account.update({
      where: { id: account.id },
      data: {
        sessionToken: encrypt(completeRes.sessionToken),
        config: encryptConfig(config)
      }
    });
    
    console.log(`✅ Session saved for ${alias}!`);
    console.log(`✅ Account ready for testing!`);
    
    await prisma.$disconnect();
    process.exit(0);
  } catch(e) {
    console.log(`💥 Error: ${e.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }
}

const [alias, code] = process.argv.slice(2);
if (!alias || !code) {
  console.log('Usage: node complete-otp.js <alias> <otp-code>');
  console.log('Examples:');
  console.log('  node complete-otp.js delilah-zayd 123456');
  console.log('  node complete-otp.js zayd-zayd 654321');
  process.exit(1);
}

completeOtp(alias, code);
