import { startEmailOTP, completeEmailOTP } from './server/services/clerk-auth.js';
import { logger } from './server/services/logger.js';
import fs from 'node:fs';

const email = 'iam@zayd.wtf';

console.log('========================================');
console.log('STEP 1: startEmailOTP()');
console.log('========================================');
console.log('Calling startEmailOTP for:', email);
console.log('This will trigger Clerk to send OTP email...');

try {
  const result = await startEmailOTP(email);
  
  console.log('\n✅ OTP EMAIL SENT!');
  console.log('signInId:', result.signInId);
  console.log('clientCookie (first 100 chars):', result.clientCookie?.slice(0, 100));
  console.log('emailAddressId:', result.emailAddressId);
  
  // Save to temp file for next step
  fs.writeFileSync('/tmp/otp-session.json', JSON.stringify({
    signInId: result.signInId,
    clientCookie: result.clientCookie,
    emailAddressId: result.emailAddressId,
    email: email
  }, null, 2));
  
  console.log('\n========================================');
  console.log('CHECK YOUR EMAIL: iam@zayd.wtf');
  console.log('Give me the 6-digit code when you have it');
  console.log('Session saved to /tmp/otp-session.json');
  console.log('========================================');
  
} catch (err) {
  console.error('❌ FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
}
