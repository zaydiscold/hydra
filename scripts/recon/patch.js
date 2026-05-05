const fs = require('fs');

let content = fs.readFileSync('server/services/clerk-auth.js', 'utf8');
let lines = content.split('\n');

const importStr = `import {
  parseCookies,
  clientCookieAfterSetCookieLines
} from '../utils/cookie-utils.js';

export {
  CF_COOKIE_EXPIRING_SOON_MS,
  checkCloudflareCookieExpiration,
  areCloudflareCookiesExpired,
  parseClerkDeviceCookieJar,
  clerkFapiDeviceCookieHeader,
  openRouterDashboardDeviceCookies,
  openRouterPlaywrightDeviceCookies,
  extractNewClientCookie,
  extractCloudflareCookieExpirations,
  mergeCloudflareCookieExpirations
} from '../utils/cookie-utils.js';`;

// Ensure we are modifying the right lines.
// lines[24] is // =============================================================================
// lines[88] is } (validateCookieHeaderSize)
// lines[100] is // Parse a Set-Cookie header string into { name, value } pairs
// lines[725] is } (serializeAllDeviceCookies)

if (lines[24].includes('COOKIE SECURITY LIMITS') || lines[24] === '// =============================================================================') {
  // First, splice out 100 to 725 (index 100 to 725 length 626 items)
  lines.splice(100, 626);
  // Then, splice out 24 to 88 (index 24 length 65)
  lines.splice(24, 65, importStr);
  
  fs.writeFileSync('server/services/clerk-auth.js', lines.join('\n'));
  console.log('Successfully patched clerk-auth.js');
} else {
  console.error('Lines did not match expected anchors:', lines[24]);
  process.exit(1);
}
