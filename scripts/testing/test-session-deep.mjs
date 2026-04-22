#!/usr/bin/env node
/**
 * Deep Session Analysis Test
 *
 * Analyzes the session refresh mechanism in detail to understand
 * why sessions are short-lived and verify if 7-day sessions are possible.
 */

import https from 'node:https';
import { URL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const prisma = new PrismaClient();

const CLERK_BASE = 'https://clerk.openrouter.ai/v1';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
const CLERK_ORIGIN = 'https://openrouter.ai';
const CLERK_REFERER = 'https://openrouter.ai/';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m'
};

function log(level, message) {
  const color = colors[level] || colors.reset;
  console.log(`${color}${message}${colors.reset}`);
}

async function loadStorageCodec() {
  try {
    const module = await import(join(__dirname, 'server/services/storage-codec.js'));
    return module;
  } catch (err) {
    log('red', `Failed to load storage codec: ${err.message}`);
    return null;
  }
}

async function loadClerkAuth() {
  try {
    const module = await import(join(__dirname, 'server/services/clerk-auth.js'));
    return module;
  } catch (err) {
    log('red', `Failed to load clerk-auth: ${err.message}`);
    return null;
  }
}

/**
 * Decode JWT and show all claims
 */
function decodeJwtFull(jwt) {
  if (!jwt || typeof jwt !== 'string' || !jwt.trim()) return null;
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));

    return { header, payload, full: jwt };
  } catch {
    return null;
  }
}

/**
 * Get detailed Clerk client response
 */
async function getClerkClientDetailed(clientCookie, sessionCookie) {
  return new Promise((resolve) => {
    const url = new URL(`${CLERK_BASE}/client?_clerk_js_version=5.0.0`);
    const headers = {
      'User-Agent': USER_AGENT,
      'Origin': CLERK_ORIGIN,
      'Referer': CLERK_REFERER,
    };

    let cookieHeader = '';
    if (sessionCookie) {
      cookieHeader = `__session=${sessionCookie}`;
    }
    if (clientCookie) {
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
            data = { parseError: true, raw: text.slice(0, 500) };
          }

          const setCookie = res.headers['set-cookie'];
          const setCookieLines = setCookie ? (Array.isArray(setCookie) ? setCookie : [setCookie]) : [];

          resolve({
            statusCode: res.statusCode,
            data,
            setCookieLines,
            headers: res.headers
          });
        });
      }
    );
    req.on('error', (err) => resolve({ error: err.message }));
    req.end();
  });
}

/**
 * Extract session from various Clerk response formats
 */
function extractSessionDeep(data) {
  const sessions = [];

  // Check response object
  if (data?.response) {
    const r = data.response;

    // Check last_active_session
    if (r.last_active_session) {
      sessions.push({
        source: 'response.last_active_session',
        data: r.last_active_session
      });
    }

    // Check sessions array
    if (Array.isArray(r.sessions)) {
      for (const s of r.sessions) {
        sessions.push({
          source: 'response.sessions[]',
          data: s
        });
      }
    }

    // Check direct session
    if (r.session) {
      sessions.push({
        source: 'response.session',
        data: r.session
      });
    }
  }

  // Check client object
  if (data?.client) {
    const c = data.client;

    if (c.last_active_session) {
      sessions.push({
        source: 'client.last_active_session',
        data: c.last_active_session
      });
    }

    if (Array.isArray(c.sessions)) {
      for (const s of c.sessions) {
        sessions.push({
          source: 'client.sessions[]',
          data: s
        });
      }
    }
  }

  return sessions;
}

/**
 * Test session refresh patterns
 */
async function testRefreshPatterns(userId, accountId, storageCodec) {
  log('blue', `\n${'='.repeat(70)}`);
  log('blue', `Deep Session Analysis for Account: ${accountId}`);
  log('blue', `${'='.repeat(70)}`);

  const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!account) {
    log('red', 'Account not found');
    return;
  }

  const config = storageCodec.decryptConfig(account.config);
  const sessionCookie = storageCodec.decrypt(account.sessionToken);
  const clientCookie = config.clientCookie;

  log('cyan', '\n📊 CURRENT SESSION STATE:');
  log('gray', `  Stored session: ${sessionCookie ? `${sessionCookie.substring(0, 30)}... (${sessionCookie.length} chars)` : 'NONE'}`);
  log('gray', `  Client cookie: ${clientCookie ? `${clientCookie.substring(0, 30)}... (${clientCookie.length} chars)` : 'NONE'}`);

  if (sessionCookie) {
    const decoded = decodeJwtFull(sessionCookie);
    if (decoded) {
      log('gray', `  JWT Header: ${JSON.stringify(decoded.header)}`);
      log('gray', `  JWT Payload exp: ${decoded.payload.exp} (${new Date(decoded.payload.exp * 1000).toISOString()})`);
      log('gray', `  JWT Payload iat: ${decoded.payload.iat} (${new Date(decoded.payload.iat * 1000).toISOString()})`);
      if (decoded.payload.sid) log('gray', `  JWT Session ID: ${decoded.payload.sid}`);
      if (decoded.payload.sub) log('gray', `  JWT Subject: ${decoded.payload.sub}`);
    }
  }

  // Get Clerk client response
  log('cyan', '\n📋 CLERK GET /v1/client RESPONSE:');
  const response = await getClerkClientDetailed(clientCookie, sessionCookie);

  if (response.statusCode === 200) {
    log('green', `  Status: 200 OK`);

    // Extract session data
    const sessions = extractSessionDeep(response.data);
    log('gray', `  Found ${sessions.length} session(s) in response`);

    for (const sess of sessions) {
      log('magenta', `\n  Session from: ${sess.source}`);

      const s = sess.data;
      log('gray', `    Session ID: ${s.id || 'N/A'}`);
      log('gray', `    Status: ${s.status || 'N/A'}`);
      log('gray', `    Expire At: ${s.expire_at || 'N/A'}`);

      if (s.expire_at) {
        const expMs = new Date(s.expire_at).getTime();
        const remainingHours = (expMs - Date.now()) / (1000 * 60 * 60);
        log('gray', `    Remaining: ${remainingHours.toFixed(2)} hours`);
      }

      // Check for JWT in various places
      let jwt = null;
      if (s.last_active_token?.jwt) {
        jwt = s.last_active_token.jwt;
        log('gray', `    JWT from last_active_token.jwt`);
      } else if (s.jwt) {
        jwt = s.jwt;
        log('gray', `    JWT from session.jwt`);
      }

      if (jwt) {
        const decoded = decodeJwtFull(jwt);
        if (decoded) {
          const expMs = decoded.payload.exp * 1000;
          const remainingHours = (expMs - Date.now()) / (1000 * 60 * 60);
          log('yellow', `    JWT Expires: ${new Date(expMs).toISOString()} (${remainingHours.toFixed(2)}h)`);

          if (decoded.payload.iat) {
            const issuedAtMs = decoded.payload.iat * 1000;
            const sessionDuration = (expMs - issuedAtMs) / (1000 * 60 * 60);
            log('gray', `    JWT Issued: ${new Date(issuedAtMs).toISOString()}`);
            log('gray', `    JWT Duration: ${sessionDuration.toFixed(2)} hours`);

            if (sessionDuration >= 24) {
              log('green', `    ✅ Long-lived session detected!`);
            } else if (sessionDuration < 1) {
              log('red', `    ❌ Very short-lived session (${sessionDuration.toFixed(2)}h)`);
            }
          }
        }
      }
    }
  } else {
    log('red', `  Status: ${response.statusCode || 'ERROR'}`);
    if (response.data?.parseError) {
      log('red', `  Raw response: ${response.data.raw}`);
    }
  }

  // Test multiple refreshes to see if we get different session durations
  log('cyan', '\n📋 REFRESH SESSION TEST:');
  const clerkAuth = await loadClerkAuth();

  if (clerkAuth?.refreshSession) {
    const refreshed = await clerkAuth.refreshSession(clientCookie, sessionCookie);

    if (refreshed?.sessionCookie) {
      log('green', `  ✅ Got new session from refreshSession()`);

      const decoded = decodeJwtFull(refreshed.sessionCookie);
      if (decoded) {
        const expMs = decoded.payload.exp * 1000;
        const remainingHours = (expMs - Date.now()) / (1000 * 60 * 60);
        log('yellow', `  New JWT Expires: ${new Date(expMs).toISOString()} (${remainingHours.toFixed(2)}h)`);

        if (decoded.payload.iat) {
          const issuedAtMs = decoded.payload.iat * 1000;
          const sessionDuration = (expMs - issuedAtMs) / (1000 * 60 * 60);
          log('gray', `  New JWT Issued: ${new Date(issuedAtMs).toISOString()}`);
          log('gray', `  New JWT Duration: ${sessionDuration.toFixed(2)} hours`);

          if (sessionDuration >= 24) {
            log('green', `  ✅ Long-lived session! (~${(sessionDuration/24).toFixed(1)} days)`);
          } else {
            log('red', `  ❌ Short-lived session (${sessionDuration.toFixed(2)}h) - will need frequent refresh`);
          }
        }
      }
    }
  }

  // Check Set-Cookie headers from response
  log('cyan', '\n📋 SET-COOKIE ANALYSIS:');
  if (response.setCookieLines?.length > 0) {
    for (const cookie of response.setCookieLines) {
      const name = cookie.split('=')[0];
      const exp = cookie.match(/expires=([^;]+)/i)?.[1];
      const maxAge = cookie.match(/max-age=([^;]+)/i)?.[1];

      let expStr = '';
      if (maxAge) {
        const seconds = parseInt(maxAge);
        expStr = ` (expires in ${(seconds/3600).toFixed(2)}h)`;
      } else if (exp) {
        expStr = ` (expires: ${exp})`;
      }

      if (name === '__session') {
        log('yellow', `  __session: present${expStr}`);
      } else if (name.startsWith('__client')) {
        log('gray', `  ${name}: present${expStr}`);
      } else if (name.includes('cf_')) {
        log('gray', `  ${name}: present${expStr}`);
      } else {
        log('gray', `  ${name}: present${expStr}`);
      }
    }
  } else {
    log('yellow', '  No Set-Cookie headers received');
  }

  // Summary
  log('blue', '\n' + '='.repeat(70));
  log('blue', 'SUMMARY');
  log('blue', '='.repeat(70));

  const nowMs = Date.now();
  const decoded = sessionCookie ? decodeJwtFull(sessionCookie) : null;

  if (decoded) {
    const expMs = decoded.payload.exp * 1000;
    const remainingHours = (expMs - nowMs) / (1000 * 60 * 60);

    if (remainingHours > 0) {
      log('green', `  Current session valid for ${remainingHours.toFixed(2)} more hours`);
    } else {
      log('red', `  Current session EXPIRED ${Math.abs(remainingHours).toFixed(2)} hours ago`);
    }

    if (decoded.payload.iat) {
      const issuedAtMs = decoded.payload.iat * 1000;
      const sessionDuration = (expMs - issuedAtMs) / (1000 * 60 * 60);
      log('gray', `  Session lifetime: ${sessionDuration.toFixed(2)} hours`);

      if (sessionDuration < 1) {
        log('yellow', `  ⚠️  These are SHORT-LIVED sessions - they will expire quickly`);
        log('yellow', `  ⚠️  Refresh mechanism works, but sessions need constant refreshing`);
      } else if (sessionDuration >= 7 * 24) {
        log('green', `  ✅ These are long-lived (7-day) sessions`);
      }
    }
  }

  log('gray', `\n  Key Findings:`);
  log('gray', `  - refreshSession() returns a session from Clerk's GET /v1/client`);
  log('gray', `  - The session comes from the response body (last_active_session)`);
  log('gray', `  - NOT from a Set-Cookie __session header (which would be more reliable)`);
  log('gray', `  - Session duration is determined by Clerk's JWT exp/iat claims`);
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║            Deep Session Refresh Analysis v1.0                        ║
║            Understanding session duration and refresh                ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const storageCodec = await loadStorageCodec();
  if (!storageCodec) {
    log('red', 'Failed to load storage codec');
    process.exit(1);
  }

  const user = await prisma.user.findFirst();
  if (!user) {
    log('red', 'No user found');
    process.exit(1);
  }

  // Test both accounts
  const accounts = [
    'cecff6a9-cbcc-4110-93ec-409299474b82',
    '09f8cc49-9308-4977-9f18-15d1a7e13216'
  ];

  for (const accountId of accounts) {
    await testRefreshPatterns(user.id, accountId, storageCodec);
  }

  log('blue', '\n\n' + '='.repeat(70));
  log('blue', 'OVERALL FINDINGS');
  log('blue', '='.repeat(70));
  log('gray', `
The session refresh mechanism works as follows:

1. refreshSession() calls Clerk's GET /v1/client with clientCookie
2. Clerk returns a session in the response body (not Set-Cookie)
3. The session is extracted from last_active_session.jwt
4. Session duration is controlled by Clerk's JWT exp/iat claims

CURRENT BEHAVIOR:
- Sessions are SHORT-LIVED (sub-1-hour based on test results)
- refreshSession() successfully retrieves new sessions
- But these sessions still have short lifetimes

This suggests either:
a) Clerk/OpenRouter is issuing short-lived sessions
b) The account/device has restrictions causing short sessions
c) Sessions need to be "touched" regularly to extend lifetime

RECOMMENDATION:
The current ensureSession() flow in dashboard-api.js handles this by:
- Checking session validity before each operation
- Calling refreshSession() when sessions are expired or expiring
- This should work, but causes more frequent refresh calls
`);

  await prisma.$disconnect();
}

main().catch(err => {
  log('red', `Fatal error: ${err.message}`);
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
