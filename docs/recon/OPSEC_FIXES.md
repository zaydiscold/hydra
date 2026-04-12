# OPSEC Fixes — Session 21

## What

Four operational security fixes applied to reduce Hydra's fingerprint when interacting with OpenRouter and improve operator control.

### Fix 1: X-Title Header Made Configurable (Finding #50, #87)

**Before:** Every proxy request sent `X-Title: Hydra Pool Router` to OpenRouter. This is a literal self-identifying beacon — OR can trivially cluster all Hydra pool traffic by this single header value.

**After:** `X-Title` header is now configurable via `HYDRA_PROXY_TITLE` env var. Default is empty (header omitted). Operators can set it to any string for compatibility, or leave unset for OPSEC.

**File:** `server/routes/proxy.js`

### Fix 2: Proxy-Gate Kill Switch Persistence (Finding #51)

**Before:** `proxy-gate.js` kill switch state (`enabled=true/false`) reset to `enabled=true` on every process restart. If an operator disabled the proxy and the process crashed, the proxy would silently re-enable on auto-restart.

**After:** Kill switch state is persisted to `data/proxy-gate-state.json`. On startup, the persisted state is loaded. Changes are written immediately. Restart preserves the disabled state.

**File:** `server/services/proxy-gate.js`

### Fix 3: LOG_LEVEL Environment Variable (Finding #52)

**Before:** Logger had no runtime level control. In development it logged `debug`+, in production `info`+. No way for operators to silence noisy logs or increase verbosity without changing `NODE_ENV`.

**After:** `process.env.LOG_LEVEL` overrides the default level. Accepts standard levels: `error`, `warn`, `info`, `debug`, `trace`. Falls back to `NODE_ENV`-based default if not set.

**File:** `server/services/logger.js`

### Fix 4: Stream Timeout Separation (Finding #70)

**Before:** A single 30-second `AbortController` timeout governed both connection establishment AND stream continuation. Long-running code generation tasks (2-5 minutes) were silently aborted mid-stream.

**After:** Separate timeouts:
- **Connect timeout:** 10 seconds (covers DNS + TCP + TLS handshake + first byte)
- **Stream timeout:** No hard limit (stream runs until OR closes it or client disconnects)

**File:** `server/routes/proxy.js`

## Why It Matters

### X-Title
OR can identify, cluster, and potentially block all traffic from a Hydra instance with a single header check. Removing the self-identifying beacon is the single most impactful OPSEC change possible.

### Proxy-gate persistence
A crashed + auto-restarted process with proxy re-enabled means the operator's explicit kill-switch action was undone silently. In a rate-limit scenario, this could cause additional 429s before the operator notices.

### LOG_LEVEL
Without operator-controlled logging, debugging production issues required code changes. With `LOG_LEVEL=debug`, operators can temporarily increase verbosity without restarting with a different `NODE_ENV`.

### Stream timeout
Code generation with Claude or GPT-4 can take 2-5 minutes for long responses. The 30s timeout was silently truncating these responses, making Hydra unreliable for the most valuable use case. The fix ensures long streams complete while still protecting against connection hangs.

## Evidence

### X-Title
- `proxy.js` (before): `headers['X-Title'] = 'Hydra Pool Router'` — literal string
- OpenAI API spec: `X-Title` is optional, used for "application name" tracking
- No other proxy/SDK sends a self-identifying name by default

### Proxy-gate persistence
- `proxy-gate.js` (before): `let enabled = true` — in-memory only, resets on import
- `proxy-gate.js` (after): reads/writes `data/proxy-gate-state.json` on toggle + startup

### LOG_LEVEL
- `logger.js` (before): `const level = isDev ? 'debug' : 'info'` — no env override
- `logger.js` (after): `const level = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info')`

### Stream timeout
- `proxy.js` (before): single `AbortController` with 30s `setTimeout`
- `proxy.js` (after): connect timeout 10s, no stream timeout (OR controls stream end)

## Reproducibility

```bash
# X-Title: verify header is omitted or configurable
curl -v http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' 2>&1 | grep -i "x-title"

# Proxy-gate: toggle and restart
curl -X POST http://localhost:3001/api/system/proxy-toggle -H "Authorization: Bearer <token>"
# Restart server, verify state preserved
cat data/proxy-gate-state.json

# LOG_LEVEL: test level override
LOG_LEVEL=warn npm run dev  # only warn+error should appear
LOG_LEVEL=debug npm run dev # debug+info+warn+error should appear

# Stream timeout: test long generation
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-sonnet-4-20250514","messages":[{"role":"user","content":"Write a 2000-word essay on neural networks"}],"max_tokens":4096}' \
  --no-buffer
# Should stream for 1-3 minutes without abort
```
