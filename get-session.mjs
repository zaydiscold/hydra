import * as store from './server/services/store.js';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = 'cecff6a9-cbcc-4110-93ec-409299474b82';

async function main() {
  console.log('Getting account session data...');
  
  const account = await store.getAccountWithKey(USER_ID, ACCOUNT_ID);
  if (!account) {
    console.error('Account not found');
    process.exit(1);
  }
  
  console.log('\nAccount:', account.alias || account.email);
  console.log('Session status:', account.sessionStatus);
  
  if (account._sessionPlain) {
    console.log('\nSession token (JWT) found!');
    console.log('Length:', account._sessionPlain.length);
    // Save to file for use in Playwright
    const fs = await import('fs');
    fs.writeFileSync('session-jwt.txt', account._sessionPlain);
    console.log('Saved to session-jwt.txt');
  } else {
    console.log('\nNo session token found');
  }
  
  // Check if there are cookies
  if (account.config) {
    const fs = await import('fs');
    fs.writeFileSync('account-config.json', JSON.stringify(account.config, null, 2));
    console.log('\nConfig saved to account-config.json');
    
    if (account.config.sessionCookie) {
      console.log('Session cookie found in config');
    }
    if (account.config.cfCookies) {
      console.log('Cloudflare cookies found:', Object.keys(account.config.cfCookies).join(', '));
      fs.writeFileSync('cf-cookies.json', JSON.stringify(account.config.cfCookies, null, 2));
      console.log('Saved to cf-cookies.json');
    }
  }
  
  await store.prisma?.$disconnect?.();
}

main().catch(console.error);
