# HTML-to-JSON Response Handling Hardening Summary

## Overview
Hardened the HTML-to-JSON response handling in Hydra's dashboard-api.js to make it more robust against Cloudflare challenges, authentication failures, and malformed responses.

## Changes Made

### 1. New Utility Functions (Lines 468-660)

#### `isHtmlContentType(contentType)`
- Robust content-type detection for HTML responses
- Handles variations: `text/html`, `application/xhtml+xml`, case-insensitive matching
- Catches malformed HTML content-types that start with `text/` and contain `html`

#### `safeResponseText(res, maxLength = 50000)`
- Safely extracts response text with size limits
- Prevents memory issues with large responses
- Checks Content-Length header before reading
- Handles stream reading errors gracefully
- Returns `{text, truncated, error}` structure

#### `sanitizeHtmlPreview(html, maxLength = 2000)`
- Sanitizes HTML for safe error logging
- Removes `<script>` and `<style>` tags and their contents
- Strips event handlers (onclick, etc.)
- Limits length and normalizes whitespace

#### `safeJsonParse(text, context = {})`
- Defensive JSON parsing with detailed error context
- Pre-validates for HTML patterns (`<!DOCTYPE`, `<html`) before parsing
- Provides preview of what failed to parse
- Enriches errors with `isHtml`, `isParseError`, `responsePreview` properties

#### `extractHtmlErrorInfo(html)`
- Analyzes HTML responses to detect common patterns:
  - **Cloudflare indicators**: `cf-browser-verification`, `__cf_bm`, `cf_clearance`, "checking your browser"
  - **Login page indicators**: "sign in", "login", "clerk", "session"
  - **Generic error indicators**: "error", "forbidden", "unauthorized"
- Extracts `<title>` tag content for debugging
- Returns structured info with `hints` array for diagnostics

### 2. Hardened `trpcCall()` Function (Lines 675-786)

**Before:**
- Simple content-type check: `contentType.includes('text/html')`
- Direct `res.json()` call without error handling
- Limited error information

**After:**
- Uses `isHtmlContentType()` for robust HTML detection
- Reads and analyzes HTML body using `safeResponseText()` and `extractHtmlErrorInfo()`
- Enhanced error messages with Cloudflare/login page detection
- Logs detailed debug info when `provisionStepLogEnabled()`
- Safely extracts response text before parsing
- Uses `safeJsonParse()` with route context for better error messages
- Error objects include: `isHtml`, `httpStatus`, `contentType`, `responsePreview`, `htmlInfo`

### 3. Hardened `parseTrpcRedeemHttpBody()` Function (Lines 1651-1714)

**Before:**
- Direct `JSON.parse()` without pre-validation
- Silent failure returning `{kind: 'unparseable'}`

**After:**
- HTML pattern detection before JSON parsing
- Returns detailed error with `trpcCode: 'HTML_RESPONSE'` for HTML responses
- Size limit check (100KB) with `trpcCode: 'OVERSIZED_RESPONSE'`
- Enhanced JSON parse errors with preview of failed content
- Returns structured error with `trpcCode`, `isHtml`, `isParseError`

### 4. Hardened `getUserProfile()` Function (Lines 2081-2107)

**Before:**
- Simple JSON content-type check
- Direct `res.json()` call
- Silent fallback to null on errors

**After:**
- HTML detection using `isHtmlContentType()`
- HTML responses logged with title and hints
- Safe JSON parsing with `safeResponseText()` and `safeJsonParse()`
- Parse errors logged before falling back to tRPC

### 5. Enhanced Error Classification (Lines 835-855)

**`classifyRedeemFailure()` updates:**
- Added handling for `trpcCode === 'HTML_RESPONSE'`
- Added handling for `trpcCode === 'JSON_PARSE_ERROR'`
- Maps HTML responses to `REDEEM_ERROR_CODES.SESSION`
- Maps parse errors to `REDEEM_ERROR_CODES.UPSTREAM`

### 6. Enhanced Provisioning Abort Logic (Lines 900-920)

**`shouldAbortProvisioning()` updates:**
- Added handling for HTML responses with HTTP 200 (Cloudflare challenges)
- Checks `htmlInfo.looksLikeCloudflare` and `htmlInfo.looksLikeLoginPage`
- Aborts on `trpcCode === 'HTML_RESPONSE'` or `trpcCode === 'OVERSIZED_RESPONSE'`

## Benefits

### 1. **Better Debugging**
- HTML responses now include sanitized previews in error logs
- Cloudflare challenges are explicitly detected and reported
- Page titles are extracted from HTML for context
- Response size issues are reported before attempting parse

### 2. **Robustness**
- No more silent failures when HTML is returned instead of JSON
- Memory protection against oversized responses
- Graceful handling of stream read errors
- Case-insensitive content-type matching

### 3. **Security**
- HTML sanitization removes scripts and event handlers from logged content
- Size limits prevent DoS from massive responses
- Structured error properties prevent information leakage

### 4. **Maintainability**
- Centralized utility functions for response handling
- Consistent error structure across all functions
- Clear separation between content detection, extraction, and parsing

## Testing Recommendations

1. **Simulate HTML responses:**
   ```javascript
   // Mock a Cloudflare challenge response
   mockFetch.mockResolvedValue({
     headers: { get: () => 'text/html' },
     status: 403,
     text: () => Promise.resolve('<html><title>Just a moment...</title>...</html>')
   });
   ```

2. **Test oversized responses:**
   ```javascript
   // Verify 100KB+ responses are rejected
   ```

3. **Test malformed JSON:**
   ```javascript
   // Verify JSON parse errors include preview
   ```

4. **Test case variations:**
   ```javascript
   // Test 'TEXT/HTML', 'Application/XHTML+xml', etc.
   ```

## Files Modified
- `server/services/dashboard-api.js` - Main hardening implementation

## Backward Compatibility
All changes are backward compatible:
- Existing error properties (`isHtml`, `httpStatus`, `status`) are preserved
- New properties are additive only
- Functions return same types/shapes as before
- Existing error handling code continues to work
