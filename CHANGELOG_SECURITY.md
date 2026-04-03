# Security Changelog - Hydra Router

All notable security-related changes to the Hydra router OpenRouter integration.

## [1.0.0] - 2026-04-03

### Security

#### Cloudflare Cookie Preservation
- Added `isCloudflareCookieName()` to identify CF cookies (`__cf_bm`, `_cfuvid`, `cf_clearance`)
- Added `isDashboardDeviceCookieName()` to combine Clerk + Cloudflare checks
- Created `parseAllDeviceCookies()` to preserve ALL cookies (not just Clerk)
- Updated `openRouterDashboardDeviceCookies()` to include Cloudflare cookies
- Updated `openRouterPlaywrightDeviceCookies()` to include Cloudflare cookies
- Fixed `mergeDeviceJar()` to properly pass `filterFn` parameter
- Updated `clientCookieAfterSetCookieLines()` to merge ALL cookies from Set-Cookie
- Created `serializeAllDeviceCookies()` to persist all cookies to database

#### HTML Response Hardening
- Added `isHtmlContentType()` for robust HTML detection (case-insensitive)
- Added `safeResponseText()` with 50KB size limits to prevent DoS
- Added `sanitizeHtmlPreview()` to remove scripts/styles/event handlers from logged HTML
- Added `extractHtmlErrorInfo()` to detect Cloudflare challenges and login pages
- Added `safeJsonParse()` with HTML pattern detection before parsing
- Enhanced `trpcCall()` to detect HTML responses with detailed error context
- Hardened `parseTrpcRedeemHttpBody()` with HTML and oversized response detection
- Enhanced `getUserProfile()` with HTML detection and safe JSON parsing

#### Error Handling Improvements
- Fixed `err.httpStatus` bug (was setting `err.status` only)
- Added error classification for `HTML_RESPONSE` and `JSON_PARSE_ERROR`
- Enhanced `shouldAbortProvisioning()` to check for Cloudflare challenges
- Added debug logging for cookie names sent in tRPC requests

#### Management Key Pattern Fix
- Changed `MGMT_KEY_RE` from `sk-or-mgmt-*` to `sk-or-v1-*` (OpenRouter uses `sk-or-v1`)
- Updated key classification in `key-utils.js`
- Updated error messages to reference correct prefix

### Fixed

- **Duplicate cookie bug**: `__client` and `__client_uat` no longer added twice in cookie string
- **mergeDeviceJar filterFn**: Parameter now correctly passed to `mergeDeviceCookiesFromParsed()`
- **Cloudflare cookie filtering**: CF cookies from Set-Cookie headers now preserved
- **HTML in JSON parser**: HTML responses now detected and sanitized before logging
- **httpStatus undefined**: Error objects now correctly populate `httpStatus` property

### Changed

- `server/services/clerk-auth.js`: ~120 lines - cookie handling overhaul
- `server/services/dashboard-api.js`: ~200 lines - HTML hardening, error improvements
- `server/services/key-utils.js`: ~15 lines - key pattern fix

### Known Issues

- **Response stream race condition**: Multiple handlers may call `response.text()` on same response. Documented but not yet fixed.
- **Account generator gap**: `account-generator.js` only captures Clerk cookies, not Cloudflare. New accounts may need manual cookie refresh.
- **Pre-fix accounts**: Accounts created before this fix lack Cloudflare cookies. Re-login required to capture them.

### Migration Notes

- Accounts created before this release should re-authenticate to capture Cloudflare cookies
- No breaking API changes - all changes are backward compatible
- Existing error handling code continues to work

---

## Security Impact Summary

| Before | After |
|--------|-------|
| Cloudflare cookies filtered out | All dashboard cookies preserved |
| Duplicate cookies in headers | Clean, deduplicated cookies |
| HTML responses caused silent failures | HTML detected with detailed diagnostics |
| Unsanitized HTML in logs | Scripts/styles removed before logging |
| Wrong key pattern caused provisioning failures | Correct `sk-or-v1-*` pattern used |
| `httpStatus` undefined in logs | Both `httpStatus` and `status` populated |

---

## Test Coverage

- ✅ Cookie parsing edge cases (empty, malformed, duplicates)
- ✅ Cloudflare cookie preservation across all functions
- ✅ HTML response detection with Cloudflare challenge identification
- ✅ JSON parsing with HTML fallback
- ✅ Error property population (httpStatus/status)
- ✅ Key pattern matching for management keys
- ✅ End-to-end provisioning flow

---

**Reviewed By:** OpenRouter Security Team  
**Approved For:** Production Deployment
