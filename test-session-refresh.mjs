#!/usr/bin/env node
/**
 * Clerk Session Refresh Test Suite
 *
 * Tests session refresh mechanisms to ensure long-lived sessions work correctly.
 * This test verifies:
 * 1. Current sessions are valid
 * 2. Manual session refresh works via refreshSession()
 * 3. Session expiration times are reasonable
 * 4. Clerk client GET /v1/client returns proper cookies
 * 5. Session tokens get updated after refresh
 * 6. Cloudflare cookies are handled properly
 */

import https from 'node:https';
import { URL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Prisma
const prisma = new PrismaClient();

// Test accounts from context
const TEST_ACCOUNTS = [
  { alias: 'iam-zayd', id: 'cecff6a9-cbcc-4110-93ec-409299474b82' },
  { alias: 'zayd-zayd', id: '09f8cc49-9308-4977-9f18-15d1a7e13216' }
];

// Constants from clerk-auth.js
const CLERK_BASE = 'https://clerk.openrouter.ai/v1';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
const CLERK_ORIGIN = 'https://openrouter.ai';
const CLERK_REFERER = 'https://openrouter.ai/';

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function log(level, message) {
  const color = colors[level] || colors.reset;
  console.log(`${color}${message}${colors.reset}`);
}

// Load the storage codec module dynamically
async function loadStorageCodec() {
  try {
    const module = await import(join(__dirname, 'server/services/storage-codec.js'));
    return module;
  } catch (err) {
    log('red', `Failed to load storage codec: ${err.message}`);
    return null;
  }
}

// Load the clerk-auth module dynamically
async function loadClerkAuth() {
  try {
    const module = await import(join(__dirname, 'server/services/clerk-auth.js'));
    return module;
  } catch (err) {
    log('red', `Failed to load clerk-auth: ${err.message}`);
    return null;
  }
}

// Load the store module dynamically
async function loadStore() {
  try {
    const module = await import(join(__dirname, 'server/services/store.js'));
    return module;
  } catch (err) {
    log('red', `Failed to load store: ${err.message}`);
    return null;
  }
}

/**
 * Validate a session by calling OpenRouter credits API
 */
async function validateSessionViaAPI(sessionCookie) {
  return new Promise((resolve) => {
    const url = new URL('https://openrouter.ai/api/v1/credits');
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'GET',
        headers: {
          'Cookie': `__session=${sessionCookie}`,
          'User-Agent': USER_AGENT,
        },
      },
      (res) => {
        const status = res.statusCode;
        res.resume();
        resolve({ valid: status !== 401 && status !== 403, status });
      }
    );
    req.on('error', () => resolve({ valid: false, status: 0 }));
    req.end();
  });
}

/**
 * Get Clerk client with cookies (simulates refreshSession flow)
 */
async function getClerkClient(clientCookie, sessionCookie) {
  return new Promise((resolve) => {
    const url = new URL(`${CLERK_BASE}/client?_clerk_js_version=5.0.0`);
    const headers = {
      'User-Agent': USER_AGENT,
      'Origin': CLERK_ORIGIN,
      'Referer': CLERK_REFERER,
    };

    // Build cookie header
    let cookieHeader = '';
    if (sessionCookie) {
      cookieHeader = `__session=${sessionCookie}`;
    }
    if (clientCookie) {
      // Parse and add client cookies
      const clientCookies = clientCookie.split(';').map(c => c.trim()).filter(c => c);
      const clerkCookies = clientCookies.filter(c =>
        c.startsWith('__client') || c.startsWith('__client_uat')
      );
      if (clerkCookies.length > 0) {
        cookieHeader += cookieHeader ? '; ' + clerkCookies.join('; ') : clerkCookies.join('; ');
      }
    }

    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data;
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            data = { parseError: true, raw: text.slice(0, 200) };
          }

          const setCookie = res.headers['set-cookie'];
          const setCookieLines = setCookie ? (Array.isArray(setCookie) ? setCookie : [setCookie]) : [];

          resolve({
            statusCode: res.statusCode,
            data,
            setCookieLines,
            hasSessionCookie: setCookieLines.some(c => c.includes('__session=')),
            hasClientCookie: setCookieLines.some(c => c.includes('__client=')),
            cloudflareCookies: setCookieLines.filter(c =>
              c.includes('__cf_bm=') || c.includes('_cfuvid=') || c.includes('cf_clearance=')
            )
          });
        });
      }
    );
    req.on('error', (err) => resolve({ error: err.message }));
    req.end();
  });
}

/**
 * Decode JWT to get expiration
 */
function getJwtExpiry(jwt) {
  const DEFAULT_TTL = 86400000; // 24h
  if (!jwt || typeof jwt !== 'string' || !jwt.trim()) {
    return new Date(Date.now() + DEFAULT_TTL).toISOString();
  }
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return new Date(Date.now() + DEFAULT_TTL).toISOString();
    const payload = parts[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const exp = decoded?.exp;
    if (exp != null && Number.isFinite(Number(exp))) {
      return new Date(Number(exp) * 1000).toISOString();
    }
    return new Date(Date.now() + DEFAULT_TTL).toISOString();
  } catch {
    return new Date(Date.now() + DEFAULT_TTL).toISOString();
  }
}

/**
 * Extract session from Clerk response
 */
function extractSessionFromResponse(data) {
  // Try various paths where session might be
  const paths = [
    'client.last_active_session.last_active_token.jwt',
    'client.session.jwt',
    'client.sessions[0].jwt',
    'response.last_active_session.last_active_token.jwt',
    'response.session.jwt',
    'response.sessions[0].jwt'
  ];

  for (const path of paths) {
    const parts = path.split('.');
    let current = data;
    for (const part of parts) {
      if (part.includes('[')) {
        const [key, idx] = part.split('[');
        const index = parseInt(idx.replace(']', ''));
        current = current?.[key]?.[index];
      } else {
        current = current?.[part];
      }
      if (!current) break;
    }
    if (current && typeof current === 'string' && current.startsWith('eyJ')) {
      return current;
    }
  }

  // Check for session directly
  if (typeof data?.session === 'string' && data.session.startsWith('eyJ')) {
    return data.session;
  }

  return null;
}

/**
 * Parse cookie expiration from Set-Cookie header
 */
function parseCookieExpiration(setCookieHeader) {
  if (!setCookieHeader || typeof setCookieHeader !== 'string') return null;
  const parts = setCookieHeader.split(';').map(p => p.trim());

  // Check Max-Age first
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower.startsWith('max-age=')) {
      const maxAge = parseInt(part.slice(8), 10);
      if (!isNaN(maxAge) && maxAge > 0) {
        return Date.now() + (maxAge * 1000);
      }
      return null;
    }
  }

  // Check Expires
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower.startsWith('expires=')) {
      const expiresStr = part.slice(8);
      const expiresDate = new Date(expiresStr);
      if (!isNaN(expiresDate.getTime())) {
        return expiresDate.getTime();
      }
    }
  }

  return null;
}

/**
 * Test a single account's session
 */
async function testAccount(userId, accountInfo, storageCodec, clerkAuth, store) {
  log('blue', `\n${'='.repeat(60)}`);
  log('blue', `Testing Account: ${accountInfo.alias} (${accountInfo.id})`);
  log('blue', `${'='.repeat(60)}`);

  const results = {
    alias: accountInfo.alias,
    id: accountInfo.id,
    tests: {},
    errors: []
  };

  try {
    // Get account from database
    const account = await prisma.account.findFirst({
      where: { id: accountInfo.id, userId }
    });

    if (!account) {
      log('red', `  ❌ Account not found in database`);
      results.tests.accountExists = false;
      return results;
    }
    results.tests.accountExists = true;

    // Decrypt config
    let config;
    try {
      config = storageCodec.decryptConfig(account.config);
      log('green', `  ✅ Config decrypted successfully`);
      results.tests.configDecrypted = true;
    } catch (err) {
      log('red', `  ❌ Failed to decrypt config: ${err.message}`);
      results.tests.configDecrypted = false;
      return results;
    }

    // Decrypt session token
    let sessionCookie;
    try {
      sessionCookie = storageCodec.decrypt(account.sessionToken);
      if (sessionCookie) {
        log('green', `  ✅ Session token decrypted (${sessionCookie.length} chars)`);
        results.tests.sessionDecrypted = true;
        results.sessionLength = sessionCookie.length;
      } else {
        log('yellow', `  ⚠️  No session token stored`);
        results.tests.sessionDecrypted = false;
      }
    } catch (err) {
      log('red', `  ❌ Failed to decrypt session: ${err.message}`);
      results.tests.sessionDecrypted = false;
    }

    // Get client cookie from config
    const clientCookie = config.clientCookie;
    results.hasClientCookie = !!clientCookie;
    if (clientCookie) {
      log('green', `  ✅ Client cookie present (${clientCookie.length} chars)`);
    } else {
      log('yellow', `  ⚠️  No client cookie stored`);
    }

    // Test 1: Validate session via OpenRouter API
    log('cyan', `\n  📋 TEST 1: Validate Session via OpenRouter API`);
    if (sessionCookie) {
      const validation = await validateSessionViaAPI(sessionCookie);
      results.tests.sessionValidation = validation;
      if (validation.valid) {
        log('green', `    ✅ Session is valid (HTTP ${validation.status})`);
      } else {
        log('red', `    ❌ Session invalid (HTTP ${validation.status})`);
      }
    } else {
      log('yellow', `    ⚠️  Skipped - no session token`);
      results.tests.sessionValidation = { skipped: true };
    }

    // Test 2: Check session expiration
    log('cyan', `\n  📋 TEST 2: Session Expiration Analysis`);
    if (sessionCookie) {
      const expiry = getJwtExpiry(sessionCookie);
      const expiryMs = new Date(expiry).getTime();
      const nowMs = Date.now();
      const remainingMs = expiryMs - nowMs;
      const remainingHours = remainingMs / (1000 * 60 * 60);
      const remainingDays = remainingHours / 24;

      results.sessionExpiry = expiry;
      results.remainingMs = remainingMs;
      results.remainingHours = remainingHours;
      results.remainingDays = remainingDays;

      if (remainingMs > 0) {
        log('green', `    ✅ Session expires: ${expiry}`);
        log('green', `    ✅ Time remaining: ${remainingHours.toFixed(2)} hours (${remainingDays.toFixed(2)} days)`);
      } else {
        log('red', `    ❌ Session EXPIRED: ${expiry}`);
        log('red', `    ❌ Expired ${Math.abs(remainingHours).toFixed(2)} hours ago`);
      }

      // Check if it's a long-lived session (expected ~7 days)
      if (remainingDays >= 6) {
        log('green', `    ✅ Long-lived session detected (~7 days)`);
        results.tests.longLivedSession = true;
      } else if (remainingDays >= 1) {
        log('yellow', `    ⚠️  Short-lived session (${remainingDays.toFixed(2)} days)`);
        results.tests.longLivedSession = false;
      } else {
        log('red', `    ❌ Very short/expired session (${remainingHours.toFixed(2)} hours)`);
        results.tests.longLivedSession = false;
      }
    } else {
      log('yellow', `    ⚠️  Skipped - no session token`);
    }

    // Test 3: Clerk client GET /v1/client
    log('cyan', `\n  📋 TEST 3: Clerk Client GET /v1/client`);
    if (clientCookie) {
      const clerkResponse = await getClerkClient(clientCookie, sessionCookie);
      results.tests.clerkClient = clerkResponse;

      if (clerkResponse.statusCode === 200) {
        log('green', `    ✅ Clerk client returned 200`);
      } else if (clerkResponse.statusCode) {
        log('red', `    ❌ Clerk client returned ${clerkResponse.statusCode}`);
      } else {
        log('red', `    ❌ Clerk client error: ${clerkResponse.error}`);
      }

      // Check Set-Cookie headers
      if (clerkResponse.setCookieLines?.length > 0) {
        log('green', `    ✅ Received ${clerkResponse.setCookieLines.length} Set-Cookie headers`);
        log('gray', `       - __session: ${clerkResponse.hasSessionCookie ? 'YES' : 'NO'}`);
        log('gray', `       - __client: ${clerkResponse.hasClientCookie ? 'YES' : 'NO'}`);
        log('gray', `       - Cloudflare cookies: ${clerkResponse.cloudflareCookies.length}`);

        // Parse CF cookie expirations
        for (const cookie of clerkResponse.cloudflareCookies) {
          const exp = parseCookieExpiration(cookie);
          if (exp) {
            const expHours = (exp - Date.now()) / (1000 * 60 * 60);
            log('gray', `         · ${cookie.split('=')[0]}: ${expHours.toFixed(2)}h remaining`);
          }
        }
      } else {
        log('yellow', `    ⚠️  No Set-Cookie headers received`);
      }

      // Try to extract session from response
      const extractedSession = extractSessionFromResponse(clerkResponse.data);
      if (extractedSession) {
        log('green', `    ✅ Session JWT found in response body`);
        results.tests.sessionInResponse = true;
      } else {
        results.tests.sessionInResponse = false;
      }
    } else {
      log('yellow', `    ⚠️  Skipped - no client cookie`);
      results.tests.clerkClient = { skipped: true };
    }

    // Test 4: Manual refreshSession() test
    log('cyan', `\n  📋 TEST 4: Manual refreshSession() Test`);
    if (clientCookie && clerkAuth?.refreshSession) {
      log('gray', `    → Calling refreshSession()...`);
      const refreshed = await clerkAuth.refreshSession(clientCookie, sessionCookie);

      if (refreshed) {
        log('green', `    ✅ refreshSession() succeeded`);
        results.tests.refreshSession = { success: true };

        // Check if we got a new session
        if (refreshed.sessionCookie) {
          if (refreshed.sessionCookie !== sessionCookie) {
            log('green', `    ✅ New session token received`);
            results.tests.newTokenReceived = true;
          } else {
            log('yellow', `    ⚠️  Same session token returned`);
            results.tests.newTokenReceived = false;
          }

          const newExpiry = refreshed.sessionExpiry || getJwtExpiry(refreshed.sessionCookie);
          log('green', `    ✅ Refreshed session expiry: ${newExpiry}`);
          results.tests.refreshedExpiry = newExpiry;
        }

        if (refreshed.clientCookie) {
          log('green', `    ✅ Client cookie updated`);
        }
      } else {
        log('red', `    ❌ refreshSession() returned null`);
        results.tests.refreshSession = { success: false, error: 'Returned null' };
      }
    } else {
      log('yellow', `    ⚠️  Skipped - no client cookie or clerkAuth unavailable`);
      results.tests.refreshSession = { skipped: true };
    }

    // Test 5: Cloudflare cookies check
    log('cyan', `\n  📋 TEST 5: Cloudflare Cookie Status`);
    const cfExpirations = config.cfCookieExpirations || {};
    const cfCookies = ['__cf_bm', '_cfuvid', 'cf_clearance'];
    let anyExpiringSoon = false;
    let anyExpired = false;

    for (const name of cfCookies) {
      const hasCookie = clientCookie?.includes(`${name}=`);
      const exp = cfExpirations[name];

      if (hasCookie && exp) {
        const remainingMs = exp - Date.now();
        const remainingHours = remainingMs / (1000 * 60 * 60);

        if (remainingMs <= 0) {
          log('red', `    ❌ ${name}: EXPIRED`);
          anyExpired = true;
        } else if (remainingMs < 6 * 60 * 60 * 1000) { // 6 hours
          log('yellow', `    ⚠️  ${name}: Expiring soon (${remainingHours.toFixed(2)}h)`);
          anyExpiringSoon = true;
        } else {
          log('green', `    ✅ ${name}: Valid (${remainingHours.toFixed(2)}h)`);
        }
      } else if (hasCookie) {
        log('yellow', `    ⚠️  ${name}: Present but no expiration info`);
        anyExpiringSoon = true;
      } else {
        log('gray', `    · ${name}: Not present`);
      }
    }

    results.tests.cfCookies = { anyExpired, anyExpiringSoon };
    if (anyExpired) {
      log('red', `    ❌ Some Cloudflare cookies have expired - may cause issues`);
    } else if (anyExpiringSoon) {
      log('yellow', `    ⚠️  Some Cloudflare cookies expiring soon`);
    } else {
      log('green', `    ✅ Cloudflare cookies in good standing`);
    }

  } catch (err) {
    log('red', `  ❌ Unexpected error: ${err.message}`);
    results.errors.push(err.message);
  }

  return results;
}

/**
 * Main test runner
 */
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║         Clerk Session Refresh Test Suite v1.0                   ║
║         Testing session longevity and refresh mechanisms       ║
╚════════════════════════════════════════════════════════════════╝
`);

  const startTime = Date.now();
  const results = [];

  // Load modules
  log('blue', 'Loading modules...');
  const storageCodec = await loadStorageCodec();
  const clerkAuth = await loadClerkAuth();
  const store = await loadStore();

  if (!storageCodec) {
    log('red', 'Failed to load storage codec - cannot continue');
    process.exit(1);
  }

  log('green', 'Modules loaded successfully');

  // Get first user
  const user = await prisma.user.findFirst();
  if (!user) {
    log('red', 'No user found in database');
    process.exit(1);
  }
  log('blue', `Using user: ${user.id}`);

  // Test each account
  for (const accountInfo of TEST_ACCOUNTS) {
    const result = await testAccount(user.id, accountInfo, storageCodec, clerkAuth, store);
    results.push(result);
  }

  // Summary
  const duration = Date.now() - startTime;
  log('blue', `\n${'='.repeat(70)}`);
  log('blue', 'TEST SUMMARY');
  log('blue', `${'='.repeat(70)}`);
  log('gray', `Duration: ${(duration / 1000).toFixed(2)}s`);
  log('');

  let passedTests = 0;
  let failedTests = 0;
  let warnings = 0;

  for (const result of results) {
    log('cyan', `\nAccount: ${result.alias} (${result.id})`);

    if (!result.tests.accountExists) {
      log('red', `  ❌ Account not found`);
      failedTests++;
      continue;
    }

    if (result.tests.sessionValidation?.valid) {
      log('green', `  ✅ Session valid via API`);
      passedTests++;
    } else if (result.tests.sessionValidation?.skipped) {
      log('yellow', `  ⚠️  No session to validate`);
      warnings++;
    } else {
      log('red', `  ❌ Session invalid`);
      failedTests++;
    }

    if (result.tests.longLivedSession) {
      log('green', `  ✅ Long-lived session (7 days)`);
      passedTests++;
    } else if (result.remainingDays !== undefined) {
      log('yellow', `  ⚠️  Short session (${result.remainingDays.toFixed(2)} days)`);
      warnings++;
    }

    if (result.tests.refreshSession?.success) {
      log('green', `  ✅ refreshSession() works`);
      passedTests++;
    } else if (result.tests.refreshSession?.skipped) {
      log('yellow', `  ⚠️  Refresh test skipped`);
    } else {
      log('red', `  ❌ refreshSession() failed`);
      failedTests++;
    }

    if (result.tests.cfCookies?.anyExpired) {
      log('red', `  ❌ CF cookies expired`);
      failedTests++;
    } else if (result.tests.cfCookies?.anyExpiringSoon) {
      log('yellow', `  ⚠️  CF cookies expiring`);
      warnings++;
    } else {
      log('green', `  ✅ CF cookies valid`);
      passedTests++;
    }

    // Session duration info
    if (result.remainingDays !== undefined) {
      log('gray', `  · Session expires in: ${result.remainingDays.toFixed(2)} days`);
    }
  }

  log('blue', `\n${'='.repeat(70)}`);
  log('green', `Passed: ${passedTests}`);
  log('red', `Failed: ${failedTests}`);
  log('yellow', `Warnings: ${warnings}`);
  log('blue', `${'='.repeat(70)}`);

  // Final verdict
  if (failedTests === 0) {
    log('green', '\n✅ ALL TESTS PASSED - Sessions are healthy');
    log('green', 'Sessions should NOT randomly expire requiring re-OTP');
  } else {
    log('red', '\n❌ SOME TESTS FAILED - Session issues detected');
    log('red', 'Review failures above - some sessions may need attention');
  }

  await prisma.$disconnect();
  process.exit(failedTests > 0 ? 1 : 0);
}

// Run tests
main().catch(err => {
  log('red', `Fatal error: ${err.message}`);
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
