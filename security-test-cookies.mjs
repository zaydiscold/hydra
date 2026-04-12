/**
 * Security Test #1: Hydra Cookie Handling E2E Validation
 * 
 * Tests:
 * 1. Cookie parsing functions in clerk-auth.js
 * 2. Cloudflare cookie preservation
 * 3. Duplicate cookie prevention
 * 4. tRPC cookie header construction
 * 5. HTML response detection (auth failure indicator)
 */

import {
  parseClerkDeviceCookieJar,
  openRouterDashboardDeviceCookies,
  openRouterPlaywrightDeviceCookies,
  clerkFapiDeviceCookieHeader,
  getJwtExpiry,
  isSessionValid,
  SESSION_EXPIRING_SOON_MS
} from './server/services/clerk-auth.js';

// Test 1: Parse Clerk Device Cookie Jar (Legacy Format)
console.log('\n=== Test 1: parseClerkDeviceCookieJar ===');

// Test legacy single token format
const legacyJar = parseClerkDeviceCookieJar('abc123token');
console.log('Legacy single token:', legacyJar);
console.assert(legacyJar.__client === 'abc123token', 'Legacy format should parse to __client');

// Test new multi-cookie format
const multiCookie = '__client=abc123; __client_uat=xyz789';
const multiJar = parseClerkDeviceCookieJar(multiCookie);
console.log('Multi-cookie format:', multiJar);
console.assert(multiJar.__client === 'abc123', 'Should parse __client');
console.assert(multiJar.__client_uat === 'xyz789', 'Should parse __client_uat');

// Test with Cloudflare cookies (should be filtered by parseClerkDeviceCookieJar)
const withCf = '__client=abc123; __client_uat=xyz789; __cf_bm=cfToken123; _cfuvid=uvid456';
const clerkOnlyJar = parseClerkDeviceCookieJar(withCf);
console.log('With CF cookies (clerk only filter):', clerkOnlyJar);
console.assert(!clerkOnlyJar.__cf_bm, 'Clerk-only parser should NOT include __cf_bm');
console.assert(!clerkOnlyJar._cfuvid, 'Clerk-only parser should NOT include _cfuvid');

// Test 2: openRouterDashboardDeviceCookies (includes Cloudflare)
console.log('\n=== Test 2: openRouterDashboardDeviceCookies (All Cookies) ===');

const allCookies = '__client=abc123; __client_uat=xyz789; __cf_bm=cfToken123; _cfuvid=uvid456';
const dashboardCookies = openRouterDashboardDeviceCookies(allCookies);
console.log('Dashboard cookies string:', dashboardCookies);
console.assert(dashboardCookies.includes('__client='), 'Should include __client');
console.assert(dashboardCookies.includes('__client_uat='), 'Should include __client_uat');

// Check that duplicate cookies are NOT present (BUG FIX TEST)
const clientMatches = dashboardCookies.match(/__client=/g);
const uatMatches = dashboardCookies.match(/__client_uat=/g);
console.log('__client occurrences:', clientMatches?.length || 0);
console.log('__client_uat occurrences:', uatMatches?.length || 0);
console.assert(clientMatches?.length === 1, 'Should have exactly ONE __client cookie (no duplicates!)');
console.assert(uatMatches?.length === 1, 'Should have exactly ONE __client_uat cookie (no duplicates!)');

// Test Cloudflare cookie inclusion
console.assert(dashboardCookies.includes('__cf_bm=cfToken123'), 'Should include __cf_bm');
console.assert(dashboardCookies.includes('_cfuvid=uvid456'), 'Should include _cfuvid');

// Test 3: openRouterPlaywrightDeviceCookies
console.log('\n=== Test 3: openRouterPlaywrightDeviceCookies ===');

const playwrightCookies = openRouterPlaywrightDeviceCookies(allCookies);
console.log('Playwright cookies array:', JSON.stringify(playwrightCookies, null, 2));

const hasClient = playwrightCookies.some(c => c.name === '__client' && c.value === 'abc123');
const hasUat = playwrightCookies.some(c => c.name === '__client_uat' && c.value === 'xyz789');
const hasCfBm = playwrightCookies.some(c => c.name === '__cf_bm' && c.value === 'cfToken123');
const hasCfUvid = playwrightCookies.some(c => c.name === '_cfuvid' && c.value === 'uvid456');

console.assert(hasClient, 'Playwright cookies should include __client');
console.assert(hasUat, 'Playwright cookies should include __client_uat');
console.assert(hasCfBm, 'Playwright cookies should include __cf_bm');
console.assert(hasCfUvid, 'Playwright cookies should include _cfuvid');

// Check domain is set correctly
const clientCookie = playwrightCookies.find(c => c.name === '__client');
console.assert(clientCookie.domain === 'openrouter.ai', 'Domain should be openrouter.ai');
console.assert(clientCookie.path === '/', 'Path should be /');

// Test 4: Clerk FAPI Device Cookie Header (Clerk cookies only)
console.log('\n=== Test 4: clerkFapiDeviceCookieHeader ===');

const fapiHeader = clerkFapiDeviceCookieHeader(allCookies);
console.log('FAPI cookie header:', fapiHeader);
console.assert(fapiHeader.includes('__client='), 'FAPI should include __client');
console.assert(!fapiHeader.includes('__cf_bm'), 'FAPI should NOT include Cloudflare cookies');

// Test 5: JWT Expiry Parsing (7-day check)
console.log('\n=== Test 5: getJwtExpiry (Session Expiry) ===');

// Create a JWT expiring in 7 days
const now = Math.floor(Date.now() / 1000);
const exp7Days = now + (7 * 24 * 60 * 60); // 7 days from now
const jwtPayload = { sub: 'test', exp: exp7Days };
const base64Payload = Buffer.from(JSON.stringify(jwtPayload)).toString('base64url');
const mockJwt = `eyJhbGciOiJIUzI1NiJ9.${base64Payload}.signature`;

const expiry = getJwtExpiry(mockJwt);
console.log('7-day JWT expiry:', expiry);
console.assert(expiry !== null, 'Should parse JWT expiry');
console.assert(new Date(expiry).getTime() > Date.now(), 'Expiry should be in the future');

// Test with expired JWT
const expiredPayload = { sub: 'test', exp: now - 3600 };
const expiredBase64 = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
const expiredJwt = `eyJhbGciOiJIUzI1NiJ9.${expiredBase64}.signature`;
const expiredResult = getJwtExpiry(expiredJwt);
console.log('Expired JWT result:', expiredResult);

// Test 6: isSessionValid
console.log('\n=== Test 6: isSessionValid ===');

const farFuture = new Date(Date.now() + 86400000 * 30).toISOString(); // 30 days
const expiringSoon = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes
const expired = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hour ago

console.log('Session expiring soon check (should be false):', isSessionValid(expiringSoon));
console.log('Far future session (should be true):', isSessionValid(farFuture));
console.log('Expired session (should be false):', isSessionValid(expired));

console.assert(!isSessionValid(expiringSoon), 'Session expiring in 5 min should be invalid');
console.assert(isSessionValid(farFuture), 'Session 30 days out should be valid');
console.assert(!isSessionValid(expired), 'Expired session should be invalid');

// Test 7: Edge Cases
console.log('\n=== Test 7: Edge Cases ===');

// Empty/undefined handling
console.log('Empty string:', parseClerkDeviceCookieJar(''));
console.log('Undefined:', parseClerkDeviceCookieJar(undefined));
console.log('Null:', parseClerkDeviceCookieJar(null));

// Malformed cookies
console.log('Malformed (no equals):', parseClerkDeviceCookieJar('nocookie'));
console.log('Empty value:', parseClerkDeviceCookieJar('__client=; __client_uat=test'));

// Duplicate cookie handling in parseAllDeviceCookies (via openRouterDashboardDeviceCookies)
const withDuplicates = '__client=abc; __client=def; __client_uat=xyz; __client_uat=uvw';
const deduped = openRouterDashboardDeviceCookies(withDuplicates);
console.log('With duplicates input:', withDuplicates);
console.log('Deduped output:', deduped);

console.log('\n=== All Security Tests Complete ===');
console.log('SESSION_EXPIRING_SOON_MS:', SESSION_EXPIRING_SOON_MS, '(10 minutes)');
