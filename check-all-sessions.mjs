#!/usr/bin/env node
/**
 * Check all OpenRouter sessions in Hydra database
 * Reports: account ID, alias, email, session expiry, status (live/expired), minutes remaining
 */

import * as store from './server/services/store.js';
import { prisma } from './server/services/db.js';
import { openRouterDashboardDeviceCookies, getJwtExpiry } from './server/services/clerk-auth.js';

const OR_BASE = 'https://openrouter.ai';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Get fresh JWT from Clerk /client endpoint
async function getFreshJwt(sessionCookie, clientCookie) {
  try {
    const deviceCookies = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
    const cookieHeader = `__session=${sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;
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
    
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    
    const data = await res.json();
    const session = data?.response?.sessions?.[0] || data?.client?.sessions?.[0];
    
    if (session?.last_active_token?.jwt) {
      return { success: true, jwt: session.last_active_token.jwt };
    }
    if (session?.jwt) {
      return { success: true, jwt: session.jwt };
    }
    return { success: false, error: 'No JWT in response' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Make test request to OpenRouter /api/health or similar
async function testOpenRouterRequest(sessionCookie, clientCookie, freshJwt = null) {
  try {
    const deviceCookies = clientCookie ? openRouterDashboardDeviceCookies(clientCookie) : '';
    const cookieHeader = `__session=${freshJwt || sessionCookie}${deviceCookies ? `; ${deviceCookies}` : ''}`;
    
    // Try health endpoint first
    const healthRes = await fetch(`${OR_BASE}/api/health`, {
      method: 'GET',
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': USER_AGENT,
        'Origin': OR_BASE,
        'Accept': 'application/json',
      },
    });
    
    const healthContentType = healthRes.headers.get('content-type') || '';
    const healthBody = await healthRes.text();
    const healthIsJson = healthContentType.includes('application/json') || healthBody.startsWith('{');
    
    // If health returns redirect/HTML, try tRPC endpoint
    if (!healthIsJson && (healthRes.status === 302 || healthBody.includes('<!DOCTYPE') || healthBody.includes('<html'))) {
      const trpcRes = await fetch(`${OR_BASE}/api/trpc/user.info`, {
        method: 'GET',
        headers: {
          'Cookie': cookieHeader,
          'User-Agent': USER_AGENT,
          'Origin': OR_BASE,
          'Accept': 'application/json',
        },
      });
      
      const trpcContentType = trpcRes.headers.get('content-type') || '';
      const trpcBody = await trpcRes.text();
      const trpcIsJson = trpcContentType.includes('application/json') || trpcBody.includes('"result"') || trpcBody.includes('"error"');
      const trpcIsHtml = trpcBody.includes('<!DOCTYPE') || trpcBody.includes('<html');
      
      return {
        endpoint: '/api/trpc/user.info',
        status: trpcRes.status,
        isJson: trpcIsJson,
        isHtml: trpcIsHtml,
        hasResult: trpcBody.includes('"result"'),
        hasError: trpcBody.includes('"error"'),
        success: trpcIsJson && !trpcIsHtml && trpcRes.status === 200,
      };
    }
    
    return {
      endpoint: '/api/health',
      status: healthRes.status,
      isJson: healthIsJson,
      isHtml: healthBody.includes('<!DOCTYPE') || healthBody.includes('<html'),
      hasResult: healthIsJson,
      success: healthIsJson && healthRes.status === 200,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}

// Format time remaining
function formatTimeRemaining(expiryIso) {
  if (!expiryIso) return 'N/A';
  const expiry = new Date(expiryIso).getTime();
  const now = Date.now();
  const diff = expiry - now;
  
  if (diff <= 0) return 'EXPIRED';
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

// Get session status label
function getStatusLabel(status, minutesRemaining) {
  if (status === 'expired' || minutesRemaining === 'EXPIRED') return 'EXPIRED';
  if (status === 'expiring') return 'EXPIRING SOON';
  if (status === 'active') return 'LIVE';
  if (status === 'none') return 'NO SESSION';
  if (status === 'error') return 'ERROR';
  return status.toUpperCase();
}

async function main() {
  console.log('='.repeat(120));
  console.log('OPENROUTER SESSION VALIDATION REPORT');
  console.log('Generated:', new Date().toISOString());
  console.log('='.repeat(120));
  console.log('');
  
  // Get all users
  const users = await prisma.user.findMany();
  console.log(`Found ${users.length} user(s) in database`);
  console.log('');
  
  const results = [];
  
  for (const user of users) {
    console.log(`Checking user: ${user.username} (${user.id})`);
    
    // Get all accounts for this user
    const accounts = await store.getAccounts(user.id);
    console.log(`  Found ${accounts.length} account(s)`);
    
    for (const account of accounts) {
      console.log(`\n  Processing account: ${account.alias || account.id}`);
      
      try {
        // Get full account with decrypted session
        const fullAccount = await store.getAccountWithKey(user.id, account.id);
        
        // Check session status
        const sessionStatus = account.sessionStatus;
        const sessionCookie = fullAccount.sessionCookie;
        const clientCookie = fullAccount.clientCookie;
        const email = fullAccount.email || 'N/A';
        
        // Get session expiry from JWT or config
        const jwtExpiry = getJwtExpiry(sessionCookie);
        const configExpiry = fullAccount.sessionExpiry;
        
        // Use the earlier of JWT expiry or stored config expiry
        let sessionExpiry = null;
        if (jwtExpiry && configExpiry) {
          sessionExpiry = new Date(Math.min(new Date(jwtExpiry).getTime(), new Date(configExpiry).getTime())).toISOString();
        } else {
          sessionExpiry = jwtExpiry || configExpiry || null;
        }
        
        // Calculate minutes remaining
        let minutesRemaining = 'N/A';
        if (sessionExpiry) {
          const expiryTime = new Date(sessionExpiry).getTime();
          const now = Date.now();
          minutesRemaining = Math.floor((expiryTime - now) / 60000);
        }
        
        // Check if we can get fresh JWT (only if we have session)
        let jwtRefreshStatus = 'N/A';
        let freshJwt = null;
        if (sessionCookie && sessionStatus !== 'none') {
          const jwtResult = await getFreshJwt(sessionCookie, clientCookie);
          jwtRefreshStatus = jwtResult.success ? 'SUCCESS' : `FAILED: ${jwtResult.error}`;
          if (jwtResult.success) {
            freshJwt = jwtResult.jwt;
          }
        }
        
        // Make test request to OpenRouter
        let testRequestStatus = 'N/A';
        if (sessionCookie && sessionStatus !== 'none') {
          const testResult = await testOpenRouterRequest(sessionCookie, clientCookie, freshJwt);
          if (testResult.success) {
            testRequestStatus = 'SUCCESS (JSON)';
          } else if (testResult.isHtml) {
            testRequestStatus = 'FAILED: Redirect/HTML (auth required)';
          } else if (testResult.hasError) {
            testRequestStatus = 'FAILED: Error response';
          } else {
            testRequestStatus = `FAILED: HTTP ${testResult.status}`;
          }
        }
        
        // Determine final status
        const statusLabel = getStatusLabel(sessionStatus, formatTimeRemaining(sessionExpiry));
        
        results.push({
          accountId: account.id,
          alias: account.alias || 'N/A',
          email: email,
          sessionExpiry: sessionExpiry || 'N/A',
          minutesRemaining: typeof minutesRemaining === 'number' && minutesRemaining < 0 ? 'EXPIRED' : minutesRemaining,
          status: statusLabel,
          jwtRefresh: jwtRefreshStatus,
          testRequest: testRequestStatus,
          hasSession: !!sessionCookie,
        });
        
        console.log(`    Session status: ${sessionStatus}`);
        console.log(`    Expiry: ${sessionExpiry || 'N/A'}`);
        console.log(`    Minutes remaining: ${typeof minutesRemaining === 'number' ? minutesRemaining : minutesRemaining}`);
        console.log(`    JWT refresh: ${jwtRefreshStatus}`);
        console.log(`    Test request: ${testRequestStatus}`);
        
      } catch (err) {
        console.error(`    ERROR: ${err.message}`);
        results.push({
          accountId: account.id,
          alias: account.alias || 'N/A',
          email: 'ERROR',
          sessionExpiry: 'ERROR',
          minutesRemaining: 'ERROR',
          status: 'ERROR',
          jwtRefresh: 'ERROR',
          testRequest: err.message,
          hasSession: false,
        });
      }
    }
    
    console.log('');
  }
  
  // Print summary table
  console.log('='.repeat(120));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(120));
  console.log('');
  
  // Header
  console.log(
    'ACCOUNT ID'.padEnd(40) + 
    'ALIAS'.padEnd(20) + 
    'EMAIL'.padEnd(25) + 
    'STATUS'.padEnd(15) + 
    'EXPIRY'.padEnd(25) + 
    'MINUTES LEFT'.padEnd(15) + 
    'JWT REFRESH'.padEnd(20) + 
    'TEST REQUEST'
  );
  console.log('-'.repeat(120));
  
  // Rows
  for (const r of results) {
    const expiryStr = r.sessionExpiry !== 'N/A' && r.sessionExpiry !== 'ERROR' 
      ? new Date(r.sessionExpiry).toLocaleString() 
      : r.sessionExpiry;
    
    console.log(
      r.accountId.substring(0, 38).padEnd(40) + 
      r.alias.substring(0, 18).padEnd(20) + 
      r.email.substring(0, 23).padEnd(25) + 
      r.status.padEnd(15) + 
      expiryStr.padEnd(25) + 
      String(r.minutesRemaining).padEnd(15) + 
      r.jwtRefresh.substring(0, 18).padEnd(20) + 
      r.testRequest
    );
  }
  
  console.log('');
  console.log('='.repeat(120));
  console.log('STATISTICS');
  console.log('='.repeat(120));
  
  const total = results.length;
  const live = results.filter(r => r.status === 'LIVE').length;
  const expired = results.filter(r => r.status === 'EXPIRED').length;
  const expiringSoon = results.filter(r => r.status === 'EXPIRING SOON').length;
  const noSession = results.filter(r => r.status === 'NO SESSION').length;
  const errors = results.filter(r => r.status === 'ERROR').length;
  const jwtWorking = results.filter(r => r.jwtRefresh === 'SUCCESS').length;
  const testWorking = results.filter(r => r.testRequest === 'SUCCESS (JSON)').length;
  
  console.log(`Total accounts:        ${total}`);
  console.log(`Live sessions:         ${live}`);
  console.log(`Expired sessions:      ${expired}`);
  console.log(`Expiring soon:         ${expiringSoon}`);
  console.log(`No session:            ${noSession}`);
  console.log(`Errors:                ${errors}`);
  console.log(`JWT refresh working:   ${jwtWorking}`);
  console.log(`Test requests working: ${testWorking}`);
  
  console.log('');
  console.log('='.repeat(120));
  console.log('LEGEND');
  console.log('='.repeat(120));
  console.log('Status:');
  console.log('  LIVE           - Session is active and valid');
  console.log('  EXPIRED        - Session has expired');
  console.log('  EXPIRING SOON  - Session expires within 6 hours');
  console.log('  NO SESSION     - No session token stored');
  console.log('  ERROR          - Error reading session data');
  console.log('');
  console.log('JWT Refresh:');
  console.log('  SUCCESS        - Successfully obtained fresh JWT from Clerk');
  console.log('  FAILED: ...    - Could not get fresh JWT (session likely expired)');
  console.log('');
  console.log('Test Request:');
  console.log('  SUCCESS (JSON)         - OpenRouter returned JSON (session valid)');
  console.log('  FAILED: Redirect/HTML  - Got redirect or HTML (authentication required)');
  console.log('  FAILED: Error response  - Got error JSON from API');
  console.log('');
  
  // Cleanup
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
