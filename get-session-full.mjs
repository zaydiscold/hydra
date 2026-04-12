import * as store from './server/services/store.js';
import fs from 'fs';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = 'cecff6a9-cbcc-4110-93ec-409299474b82';

async function main() {
  console.log('Getting full account session data...\n');
  
  // Get raw account from prisma
  const { prisma } = await import('./server/services/db.js');
  const rawAccount = await prisma.account.findUnique({
    where: { id: ACCOUNT_ID }
  });
  
  if (!rawAccount) {
    console.error('Account not found in database');
    process.exit(1);
  }
  
  console.log('Raw account found:', rawAccount.alias || rawAccount.email);
  console.log('Has sessionToken:', !!rawAccount.sessionToken);
  console.log('Has managementKey:', !!rawAccount.managementKey);
  console.log('');
  
  // Now use store to get decrypted version
  const account = await store.getAccountWithKey(USER_ID, ACCOUNT_ID);
  
  // Extract and save session data
  const sessionData = {
    alias: account.alias,
    email: account.email,
    sessionStatus: account.sessionStatus,
    hasSessionToken: !!account._sessionPlain,
    sessionTokenLength: account._sessionPlain?.length || 0,
    sessionTokenPreview: account._sessionPlain ? account._sessionPlain.substring(0, 100) + '...' : null,
    config: account.config
  };
  
  console.log('Session Data:');
  console.log(JSON.stringify(sessionData, null, 2));
  
  // Save to files for Playwright script
  if (account._sessionPlain) {
    fs.writeFileSync('session-jwt.txt', account._sessionPlain);
    console.log('\n✅ Session JWT saved to session-jwt.txt');
  }
  
  // Extract cookies if available
  if (account.config) {
    const { decryptConfig } = await import('./server/services/storage-codec.js');
    const config = account._configDecrypted || account.config;
    
    const cookies = [];
    
    // If there's a session cookie
    if (config?.sessionCookie) {
      cookies.push({
        name: '__session',
        value: config.sessionCookie,
        domain: '.openrouter.ai',
        path: '/'
      });
    }
    
    // If there are Cloudflare cookies
    if (config?.cfCookies) {
      for (const [name, value] of Object.entries(config.cfCookies)) {
        cookies.push({
          name,
          value,
          domain: '.openrouter.ai',
          path: '/'
        });
      }
    }
    
    if (cookies.length > 0) {
      fs.writeFileSync('session-cookies.json', JSON.stringify(cookies, null, 2));
      console.log('✅ Cookies saved to session-cookies.json');
      console.log('Cookies:', cookies.map(c => c.name).join(', '));
    }
    
    fs.writeFileSync('account-full.json', JSON.stringify({
      alias: account.alias,
      email: account.email,
      hasManagementKey: !!account.managementKey,
      managementKeyPreview: account.managementKey ? account.managementKey.substring(0, 20) + '...' : null,
      config: config
    }, null, 2));
    console.log('✅ Full account saved to account-full.json');
  }
  
  await store.prisma?.$disconnect?.();
  console.log('\nDone!');
}

main().catch(console.error);
