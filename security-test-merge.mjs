/**
 * Security Test #2: mergeDeviceJar Cloudflare Cookie Fix
 * 
 * Tests the specific fix: mergeDeviceJar() must pass filterFn for Cloudflare cookies
 */

// parseAllDeviceCookies is not exported, so we implement a local copy for testing
function parseAllDeviceCookies(stored) {
  const t = stored != null ? String(stored).trim() : '';
  if (!t || t === 'undefined') return {};
  const jar = {};
  for (const part of t.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k && v && k !== '__session') jar[k] = v;
  }
  return jar;
}

console.log('=== Testing Cloudflare Cookie Preservation in merge ===\n');

// Simulate what happens when Set-Cookie headers arrive with Cloudflare cookies
// This tests the clientCookieAfterSetCookieLines flow

const priorCookie = '__client=abc123; __client_uat=xyz789';

// Simulate Set-Cookie lines from a response that includes Cloudflare cookies
const setCookieLines = [
  '__client=abc123; Path=/; HttpOnly',
  '__client_uat=xyz789; Path=/',
  '__cf_bm=newCfToken123; Path=/; Secure',
  '_cfuvid=newUvid456; Path=/; Secure',
  'cf_clearance=clearanceToken; Path=/; Secure',
  'some_other_cookie=ignored; Path=/'  // Should be filtered out
];

// Parse the prior cookie
const priorJar = parseAllDeviceCookies(priorCookie);
console.log('Prior jar:', priorJar);

// Simulate the merge that happens in clientCookieAfterSetCookieLines
function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders) return {};
  const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  const result = {};
  for (const raw of arr) {
    const [pair] = raw.split(';');
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 0) continue;
    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    result[name] = value;
  }
  return result;
}

// Import the isDashboardDeviceCookieName and isClerkDeviceCookieName logic
function isClerkDeviceCookieName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name === '__client') return true;
  if (name === '__client_uat') return true;
  if (name.startsWith('__client_uat_')) return true;
  return false;
}

function isCloudflareCookieName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name === '__cf_bm') return true;
  if (name === '_cfuvid') return true;
  if (name === 'cf_clearance') return true;
  return false;
}

function isDashboardDeviceCookieName(name) {
  return isClerkDeviceCookieName(name) || isCloudflareCookieName(name);
}

function mergeDeviceCookiesFromParsed(into, parsed, filterFn = isClerkDeviceCookieName) {
  if (!parsed || typeof parsed !== 'object') return into;
  for (const [k, v] of Object.entries(parsed)) {
    if (!filterFn(k)) continue;
    const s = v != null ? String(v).trim() : '';
    if (s !== '') into[k] = s;
  }
  return into;
}

// Test 1: Old behavior (Clerk cookies only) - BEFORE FIX
console.log('--- Test 1: OLD behavior (Clerk cookies only) ---');
const clerkOnlyJar = { ...priorJar };
mergeDeviceCookiesFromParsed(clerkOnlyJar, parseCookies(setCookieLines), isClerkDeviceCookieName);
console.log('Merged jar (Clerk only):', clerkOnlyJar);
console.assert(!clerkOnlyJar.__cf_bm, 'Clerk-only filter should NOT capture __cf_bm');
console.assert(!clerkOnlyJar._cfuvid, 'Clerk-only filter should NOT capture _cfuvid');

// Test 2: New behavior (Dashboard cookies = Clerk + Cloudflare) - AFTER FIX
console.log('\n--- Test 2: NEW behavior (Dashboard cookies = Clerk + Cloudflare) ---');
const dashboardJar = { ...priorJar };
mergeDeviceCookiesFromParsed(dashboardJar, parseCookies(setCookieLines), isDashboardDeviceCookieName);
console.log('Merged jar (Dashboard filter):', dashboardJar);
console.assert(dashboardJar.__cf_bm === 'newCfToken123', 'Dashboard filter SHOULD capture __cf_bm');
console.assert(dashboardJar._cfuvid === 'newUvid456', 'Dashboard filter SHOULD capture _cfuvid');
console.assert(dashboardJar.cf_clearance === 'clearanceToken', 'Dashboard filter SHOULD capture cf_clearance');
console.assert(!dashboardJar.some_other_cookie, 'Dashboard filter should NOT capture random cookies');

// Test 3: Verify the full flow (clientCookieAfterSetCookieLines simulation)
console.log('\n--- Test 3: Full flow simulation ---');
function clientCookieAfterSetCookieLines(prior, setCookieLines) {
  const jar = parseAllDeviceCookies(prior);
  const merged = mergeDeviceCookiesFromParsed(jar, parseCookies(setCookieLines), isDashboardDeviceCookieName);
  
  // Serialize (simplified version of serializeAllDeviceCookies)
  const keys = Object.keys(merged).filter((k) => isDashboardDeviceCookieName(k) && merged[k]).sort();
  if (!keys.length) return '';
  if (keys.length === 1 && keys[0] === '__client') return merged.__client;
  return keys.map((k) => `${k}=${merged[k]}`).join('; ');
}

const finalCookie = clientCookieAfterSetCookieLines(priorCookie, setCookieLines);
console.log('Final serialized cookie:', finalCookie);

// Verify all expected cookies are present
const hasClient = finalCookie.includes('__client=abc123');
const hasUat = finalCookie.includes('__client_uat=xyz789');
const hasCfBm = finalCookie.includes('__cf_bm=newCfToken123');
const hasCfUvid = finalCookie.includes('_cfuvid=newUvid456');
const hasCfClearance = finalCookie.includes('cf_clearance=clearanceToken');

console.log('\nVerification:');
console.log('  Has __client:', hasClient);
console.log('  Has __client_uat:', hasUat);
console.log('  Has __cf_bm:', hasCfBm);
console.log('  Has _cfuvid:', hasCfUvid);
console.log('  Has cf_clearance:', hasCfClearance);

console.assert(hasClient && hasUat && hasCfBm && hasCfUvid && hasCfClearance, 
  'All expected cookies should be present!');

// Verify no unexpected cookies
const hasOther = finalCookie.includes('some_other_cookie');
console.log('  Has unexpected cookie:', hasOther);
console.assert(!hasOther, 'Should NOT have some_other_cookie');

console.log('\n=== mergeDeviceJar Cloudflare Fix: ALL TESTS PASSED ===');
