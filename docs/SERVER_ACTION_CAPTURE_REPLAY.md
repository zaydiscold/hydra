# Next.js Server Action Capture and Replay

This document describes how to capture and replay Next.js Server Actions for management key creation in OpenRouter's dashboard.

## Overview

OpenRouter's dashboard may use Next.js Server Actions (instead of tRPC) for creating management keys. Hydra can replay these Server Actions to create keys programmatically.

## How It Works

### Server Action Request Format

When the OpenRouter dashboard creates a management key via Server Action:

```http
POST /settings/management-keys HTTP/1.1
Host: openrouter.ai
Content-Type: text/plain;charset=UTF-8
Next-Action: <action-id>
Cookie: __session=<jwt>; __client=<device>
Accept: text/x-component

[{"name":"My Management Key"}]
```

Key characteristics:
- **Method**: POST
- **URL**: `/settings/management-keys`
- **Headers**:
  - `Next-Action`: A unique action ID (hex string, e.g., `abc123def456...`)
  - `Content-Type`: Usually `text/plain;charset=UTF-8` for Server Actions
  - `Cookie`: `__session` JWT + Clerk device cookies
  - `Accept`: `text/x-component` (RSC format)
- **Body**: JSON array with action arguments

### Response Format

Server Action responses are in React Server Components (RSC) format:

```
0:{"success":true,"key":"sk-or-v1-..."}
1:["$","$1",null,{"key":"sk-or-v1-..."}]
```

The management key may be embedded in JSON-encoded strings or appear directly in the response.

## Capturing Server Actions

### Using the Capture Script

Run the standalone capture script with a live OpenRouter session:

```bash
# Export your session from the Hydra vault or browser
export HYDRA_CAPTURE_OR_SESSION='eyJ...'  # __session JWT value
export HYDRA_CAPTURE_OR_CLIENT='__client=...; __client_uat=...'  # optional device cookies
export HYDRA_PLAYWRIGHT_HEADED=1  # show browser (recommended for first capture)
export HYDRA_CAPTURE_KEY_NAME='Test capture key'

# Run the capture
node scripts/capture-mgmt-key-network.mjs
```

The script will:
1. Open `/settings/management-keys`
2. Click **Create**
3. Fill the **Name** field
4. Click **Save**
5. Log all POST requests to OpenRouter
6. Extract and document Server Action details

### What to Look For

In the capture output, look for:

```
POST 200 https://openrouter.ai/settings/management-keys
postData: [{"name":"Test capture key"}]
headers: content-type=text/plain;charset=UTF-8 next-action=abc123def456...
```

Copy the `Next-Action` header value for use in Hydra.

### Captured Output Location

The capture saves detailed logs to:

```
$TMPDIR/hydra-provision-debug/capture-mgmt-<timestamp>.log
```

On macOS: `/var/folders/.../T/hydra-provision-debug/`
On Linux: `/tmp/hydra-provision-debug/`

## Enabling Server Action Replay in Hydra

### 1. Set Environment Variables

Add to your `.env` file:

```bash
# Enable Server Action replay
HYDRA_PROVISION_SERVER_ACTION_REPLAY=1

# Set the captured action ID
HYDRA_MGMT_KEY_SERVER_ACTION_ID=abc123def456...
```

### 2. Provision as Normal

Use the standard Hydra provision endpoint:

```bash
curl -X POST "http://localhost:3001/api/accounts/ACCOUNT_ID/provision" \
  -H "Authorization: Bearer $HYDRA_JWT" \
  -H "Content-Type: application/json" \
  -d '{"keyName":"My Key"}'
```

Hydra will now:
1. Try tRPC routes first (cached and candidates)
2. **Try Server Action replay** (if enabled)
3. Fall back to Playwright browser automation

### Debug Output

With `HYDRA_PROVISION_VERBOSE=1`, you'll see:

```
[dashboard-api] Attempting Server Action replay for management key creation
[tryManagementKeyServerActionReplay] Using fresh JWT
[tryManagementKeyServerActionReplay] POST https://openrouter.ai/settings/management-keys with content-type=text/plain;charset=UTF-8, body=[{"name":"My Key"}]
[tryManagementKeyServerActionReplay] Response: 200 OK, content-type=text/x-component
[dashboard-api] Server Action replay: captured management key
```

## Implementation Details

### Request Variants Tried

The replay implementation tries multiple body formats to maximize compatibility:

1. `[{"name":"key-name"}]` - Standard shape
2. `[{"json":{"name":"key-name"}}]` - tRPC-like wrapper
3. `[{"label":"key-name"}]` - Alternative field
4. `[{"title":"key-name"}]` - Alternative field
5. `[]` - Empty (name may be set elsewhere)
6. `["key-name"]` - Direct string argument

Also tries both content types:
- `text/plain;charset=UTF-8` (standard for Server Actions)
- `application/json` (fallback)

### Response Parsing

The implementation handles multiple RSC response formats:

1. **Direct regex**: Searches for `sk-or-v1-...` pattern anywhere in response
2. **JSON string decoding**: Unescapes and searches JSON-encoded strings
3. **RSC chunk parsing**: Parses line-delimited chunks with IDs
4. **Deep object search**: Recursively searches parsed JSON for key fields

### Error Handling

- **401/403**: Auth failed, continues to next attempt
- **Non-200**: Skipped (Server Actions often return 200 with errors in body)
- **No key found**: Logs warning, returns null (fallback to Playwright)

## Troubleshooting

### "HYDRA_MGMT_KEY_SERVER_ACTION_ID not set"

The replay will still attempt requests but without the `Next-Action` header. Capture the real ID and set the environment variable.

### "Server Action replay: all attempts failed"

Possible causes:
1. Wrong action ID (capture again with `HYDRA_PLAYWRIGHT_HEADED=1` to verify)
2. Body format changed (check capture log for actual payload)
3. Response format changed (enable debug logging to inspect)
4. Session expired (re-authenticate in Hydra)

### How to Verify the Action ID

1. Run capture with headed browser:
   ```bash
   HYDRA_PLAYWRIGHT_HEADED=1 HYDRA_CAPTURE_OR_SESSION=... node scripts/capture-mgmt-key-network.mjs
   ```

2. Watch the browser and manually verify the key is created

3. Check the capture log for the `Next-Action` header

4. Test with curl:
   ```bash
   curl -X POST "https://openrouter.ai/settings/management-keys" \
     -H "Next-Action: <captured-id>" \
     -H "Cookie: __session=<jwt>" \
     -H "Content-Type: text/plain;charset=UTF-8" \
     -d '[{"name":"Test"}]' \
     -v
   ```

## Security Considerations

- The `Next-Action` ID is not a secret - it's a reference to server code
- The session cookie (`__session` JWT) is the actual authentication
- Action IDs may change when OpenRouter redeploys - recapture if replay fails
- The capture script never logs full response bodies (only POST data)

## Related Files

- `server/services/dashboard-api.js` - `tryManagementKeyServerActionReplay()` implementation
- `scripts/capture-mgmt-key-network.mjs` - Capture script
- `server/config.js` - Environment configuration
- `docs/MANAGEMENT_KEY_PROVISION_AUTOMATION.md` - General provision documentation
- `docs/recon/TRPC_ROUTES.md` - tRPC route documentation

## Future Enhancements

Potential improvements to the Server Action replay:

1. **Automatic discovery**: Infer action ID from page HTML/JS instead of manual capture
2. **Caching**: Remember successful action ID + body format per account
3. **Batching**: Support creating multiple keys in one Server Action call
4. **Streaming**: Parse RSC streaming responses more efficiently
5. **Fallback chain**: Automatically try older cached action IDs
