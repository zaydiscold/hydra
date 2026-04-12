# Hydra Proxy Pipeline — Deep Audit (Session 21)

Date: 2026-04-08
Auditor: Automated deep analysis
Scope: Full request path client → proxy.js → rotation-manager → OpenRouter → response back

---

## Table of Contents

1. [Streaming Optimization](#1-streaming-optimization)
2. [Connection Pooling](#2-connection-pooling)
3. [Request Coalescing / Deduplication](#3-request-coalescing--deduplication)
4. [Predictive Key Warming](#4-predictive-key-warming)
5. [Response Caching for Idempotent Requests](#5-response-caching-for-idempotent-requests)
6. [Retry Budgeting](#6-retry-budgeting)
7. [Observability Tricks](#7-observability-tricks)
8. [Classic Optimization](#8-classic-optimization)
9. [Edge Cases](#9-edge-cases)
10. [Security Surface](#10-security-surface)

---

## 1. Streaming Optimization

### Current Implementation

**File: `server/routes/proxy.js:251-258`**
```js
if (isStream && upstreamRes.body) {
  req.on('close', () => {
    if (upstreamRes.body?.cancel) upstreamRes.body.cancel();
  });
  logRequest(keyEntry.hash, currentModel(), upstreamRes.status, Date.now() - startTime);
  Readable.fromWeb(upstreamRes.body).pipe(res);
  return;
}
```

### Findings

**F1.1 — No backpressure handling.** The pipe from `Readable.fromWeb(upstreamRes.body)` to `res` (an Express response which wraps Node's `ServerResponse`) does naturally respect backpressure because `pipe()` pauses the source when the destination's `write()` returns false. However, there is a subtlety: the Web ReadableStream → Node Readable conversion via `Readable.fromWeb()` does NOT propagate `highWaterMark` correctly in all Node versions. The default HWM for the converted stream may be 64KB, which could cause memory pressure on large SSE responses. **Action:** Set an explicit `highWaterMark` on the Readable:

```js
Readable.fromWeb(upstreamRes.body, { highWaterMark: 64 * 1024 })
```

**F1.2 — No Transform stream for observation/metrics.** Currently, stream latency (time to stream completion) is recorded as `Date.now() - startTime` at line 256 — BEFORE the stream has actually finished piping. This means the `latencyMs` value in RequestLog for streaming requests is actually TTFB (time to first byte), not total stream time. This is misleading. **Action:** Insert a lightweight PassThrough or Transform stream that:
- Records TTFB when the first chunk arrives
- Records stream completion when `end` fires
- Counts total bytes streamed
- Does NOT add meaningful latency (PassThrough is zero-copy internally in Node 18+)

```js
import { PassThrough } from 'stream';
const meter = new PassThrough();
let ttfb = null;
let bytesSent = 0;
meter.once('data', () => { ttfb = Date.now() - startTime; });
meter.on('data', (chunk) => { bytesSent += chunk.length; });
meter.on('end', () => {
  logRequest(keyHash, model, status, ttfb ?? (Date.now() - startTime), { streamBytes: bytesSent });
});
Readable.fromWeb(upstreamRes.body).pipe(meter).pipe(res);
```

**F1.3 — No SSE parsing on the proxy side.** The proxy blindly pipes bytes without understanding SSE framing. This means it cannot detect:
- An error event inside a 200 OK stream (OpenRouter sometimes returns `{ "error": ... }` as an SSE data line)
- The `[DONE]` sentinel to know when streaming truly ends
- Partial failure mid-stream

**Action:** For production-grade observability, implement a minimal SSE Transform stream that parses `data: ` lines and emits structured events. This enables error detection, token counting from streamed `usage` chunks, and accurate completion tracking.

**F1.4 — HTTP/2 or SSE pass-through.** The proxy runs on HTTP/1.1 (`app.listen`). Since OpenRouter also serves HTTP/1.1 (or HTTP/2 via `fetch` in Node 18+), there is no HTTP/2 end-to-end. To enable HTTP/2:
- The Express server would need to be replaced with `http2.createServer` or `spdy`
- The benefit for local proxy usage is minimal (single client, localhost)
- **Not recommended** for this use case — the overhead outweighs the benefit. SSE pass-through is already achieved via the current pipe architecture.

---

## 2. Connection Pooling

### Current Implementation

**File: `server/routes/proxy.js:178-188`**
```js
const upstreamRes = await fetch(`${OR_BASE}/api/v1${upstreamPathWithQuery}`, {
  method: req.method,
  headers: { ... },
  body: buildBody(),
  signal: ctrl.signal,
});
```

**File: `server/services/health-pinger.js:31-45`**
```js
const res = await fetch(`${OR_BASE}/api/v1/chat/completions`, { ... });
```

### Findings

**F2.1 — `fetch()` uses a NEW connection per request by default.** Node.js built-in `fetch` (undici under the hood) does NOT share connections across calls by default. Each `fetch()` call creates a new TCP+TLS handshake to `openrouter.ai`. This adds ~50-100ms of TLS overhead per request. With `http.Agent`, Node's `http`/`https` modules keep connections alive automatically, but `fetch()`/undici has its own dispatcher system.

**Action — Critical optimization:** Create a shared undici Agent/Pool and pass it as the `dispatcher` option:

```js
import { Agent } from 'undici';
const orAgent = new Agent({
  keepAliveTimeout: 60_000,     // keep connections alive 60s
  keepAliveMaxTimeout: 600_000, // max keep-alive
  connections: 10,              // pool up to 10 concurrent connections to OR
  pipelining: 1,                // no HTTP pipelining (OR likely doesn't support it)
});

// Then in fetch calls:
const upstreamRes = await fetch(url, { ...opts, dispatcher: orAgent });
```

This single change could reduce per-request latency by 50-100ms on repeated requests. The health-pinger (line 31) should also use this shared agent.

**F2.2 — No `keep-alive` header forwarded.** The proxy sets `Connection: close` by default (Node's behavior for proxied responses). The `BLOCKED_RESPONSE_HEADERS` set at line 36-41 explicitly blocks `connection` and `keep-alive` from being forwarded. This is correct for the downstream connection (client ↔ Hydra) but doesn't affect the upstream connection (Hydra ↔ OR). The upstream connection reuse is purely about undici's internal pooling, which requires the dispatcher fix above.

**F2.3 — DNS caching.** Each new undici connection performs a DNS lookup for `openrouter.ai`. With a connection pool, DNS lookups happen once per connection. Additional optimization: set `lookup` callback on the agent to use a cached DNS resolver. For a local proxy hitting one hostname, this is a minor win.

---

## 3. Request Coalescing / Deduplication

### Current Implementation

No deduplication exists. Each client request triggers an independent upstream fetch.

### Findings

**F3.1 — Full coalescing is viable for deterministic requests.** If two clients send identical `model + messages + temperature=0 + max_tokens` within a short window, the response will be identical. A request signature can be computed as:

```js
const sig = crypto.createHash('sha256')
  .update(JSON.stringify({ model, messages, temperature, max_tokens, top_p }))
  .digest('hex').slice(0, 16);
```

**Action — Implement a pending-request map:**
```js
const pendingRequests = new Map(); // sig → { promise, timestamp }

async function coalescedFetch(sig, fetchFn) {
  const existing = pendingRequests.get(sig);
  if (existing) return existing.promise; // ride along on existing request

  const promise = fetchFn().finally(() => pendingRequests.delete(sig));
  pendingRequests.set(sig, { promise, timestamp: Date.now() });
  return promise;
}
```

**F3.2 — Partial coalescing (connection sharing).** Even for different prompts, if requests target the same model, they could share the same upstream TCP connection (from the undici pool in F2.1). This is already achieved by connection pooling — no additional code needed.

**F3.3 — Fan-out for streaming.** Coalescing is harder for streaming because each client needs its own SSE stream. You can buffer the upstream stream and fan out to multiple clients:

```js
// For identical streaming requests, tee the Readable:
const [stream1, stream2] = Readable.fromWeb(upstreamRes.body).tee();
stream1.pipe(res1);
stream2.pipe(res2);
```

Caveat: `tee()` buffers chunks for the slower consumer, which can cause memory issues if one client is slow. Mitigation: set a buffer limit and disconnect slow consumers.

**Recommendation:** Start with deterministic non-streaming coalescing (temperature=0, non-stream requests only). Streaming coalescing adds complexity and risk.

---

## 4. Predictive Key Warming

### Current Implementation

**File: `server/services/rotation-manager.js:11-13`**
```js
const COOLDOWN_429 = 60 * 1000;        // 1 min for rate-limits
const COOLDOWN_402 = 10 * 60 * 1000;   // 10 min for credit-depleted keys
```

**File: `server/services/rotation-manager.js:113-118`**
```js
applyCooldown(hash, httpStatus) {
  const duration = httpStatus === 402 ? COOLDOWN_402 : COOLDOWN_429;
  this.cooldowns.set(hash, Date.now() + duration);
}
```

### Findings

**F4.1 — Fixed cooldown ignores X-RateLimit-Reset headers.** OpenRouter returns rate limit headers on 429 responses (e.g., `X-RateLimit-Reset`, `Retry-After`). The proxy currently does NOT read these headers at all. The code at proxy.js:191-205 consumes the 429 body text to distinguish IP-level vs key-level limits, but throws away the headers.

**Action — Read rate limit headers and use them for precise cooldowns:**

```js
// In proxy.js, after detecting 429:
const resetAt = upstreamRes.headers.get('x-ratelimit-reset'); // Unix timestamp
const retryAfter = upstreamRes.headers.get('retry-after');     // seconds

if (resetAt) {
  const cooldownMs = (Number(resetAt) * 1000) - Date.now();
  rotationManager.applyCooldown(hash, 429, Math.max(cooldownMs, 5000));
} else if (retryAfter) {
  rotationManager.applyCooldown(hash, 429, Number(retryAfter) * 1000);
} else {
  rotationManager.applyCooldown(hash, 429); // default 60s
}
```

**F4.2 — No predictive warming.** Currently the system is fully reactive — it only cools a key AFTER hitting 429. A predictive approach would:
1. Track per-key request counts and timestamps
2. Estimate when the next rate limit window resets based on observed patterns
3. Proactively reduce a key's weight in `getNextKey()` as it approaches the estimated limit
4. Begin pre-warming alternate keys before the active key hits its limit

**Action — Implement a key usage tracker:**

```js
class KeyUsageTracker {
  // Map<hash, { requestTimestamps: number[], estimatedWindowReset: number }>
  records = new Map();

  recordRequest(hash) {
    const rec = this.records.get(hash) ?? { timestamps: [] };
    rec.timestamps.push(Date.now());
    // Keep only last 100 timestamps
    if (rec.timestamps.length > 100) rec.timestamps.shift();
    this.records.set(hash, rec);
  }

  // Estimate requests per minute for this key
  getRPM(hash) {
    const rec = this.records.get(hash);
    if (!rec || rec.timestamps.length < 2) return 0;
    const window = Date.now() - rec.timestamps[0];
    return (rec.timestamps.length / window) * 60_000;
  }
}
```

Then in `getNextKey()`, downweight keys approaching estimated limits:

```js
const rpm = usageTracker.getRPM(key.hash);
const estimatedLimit = 20; // OR default for free keys
if (rpm > estimatedLimit * 0.7) {
  weight *= 0.3; // reduce weight as key nears limit
}
```

**F4.3 — Pre-warming cooled keys.** When a key's cooldown is about to expire (e.g., 5 seconds before), the health-pinger could pre-test it. This avoids the "first request after cooldown = cold start" problem.

---

## 5. Response Caching for Idempotent Requests

### Current Implementation

No caching exists. Every request goes to OpenRouter.

### Findings

**F5.1 — In-memory LRU cache for deterministic requests.** For `temperature=0` (or absent) requests with identical model+messages+max_tokens, responses are deterministic. A 60-second TTL cache could eliminate redundant upstream calls.

**Action:**

```js
import { LRUCache } from 'lru-cache'; // or implement a simple Map with TTL

const responseCache = new LRUCache({
  max: 500,           // max 500 cached entries
  ttl: 60_000,        // 60 second TTL
  sizeCalculation: (v) => JSON.stringify(v).length,
  maxSize: 50 * 1024 * 1024, // 50MB max total cache size
});

// Cache key = sha256(model + messages + temperature + max_tokens + top_p)
function getCacheKey(body) {
  if (body.temperature && body.temperature > 0) return null; // skip non-deterministic
  if (body.stream) return null; // skip streaming
  return crypto.createHash('sha256')
    .update(JSON.stringify({ m: body.model, msg: body.messages, mt: body.max_tokens, tp: body.top_p }))
    .digest('hex');
}
```

**F5.2 — Streaming cache is impractical.** Streaming responses are unique per request because of token-by-token delivery. Caching them would require buffering the entire stream, which defeats the purpose of streaming. **Skip caching for `stream: true` requests.**

**F5.3 — Cache invalidation.** For a local proxy with a single user, cache coherence is simple — time-based expiry is sufficient. No need for active invalidation unless the user changes keys (which changes upstream behavior).

**F5.4 — Security consideration.** Cached responses contain the full LLM output. If the proxy serves multiple users, cache entries could leak data between users. For a local single-user proxy, this is not a concern. If multi-tenant, add user-id to cache key.

---

## 6. Retry Budgeting

### Current Implementation

**File: `server/routes/proxy.js:23, 146`**
```js
const MAX_RETRIES = 3;
for (let attempt = 0; attempt < MAX_RETRIES;) { ... }
```

**File: `server/services/rotation-manager.js:13`**
```js
const MAX_RETRIES = 4; // Drop key after 4 consecutive proxy failures
```

### Findings

**F6.1 — No exponential backoff.** On retry, the proxy immediately tries the next key with zero delay. For 429 errors (rate limits), this means the next key gets hit instantly, and if it's also rate-limited, the third key gets hit instantly. This can cascade through all keys in <1 second.

**Action — Add exponential backoff with jitter:**

```js
const baseDelay = 200; // ms
for (let attempt = 0; attempt < MAX_RETRIES;) {
  // ... fetch ...
  if (upstreamRes.status === 429) {
    const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 200;
    await new Promise(r => setTimeout(r, delay));
    continue;
  }
}
```

**F6.2 — No per-key retry budget.** The `MAX_RETRIES = 4` in rotation-manager counts consecutive failures per key. But a key that fails once per minute (intermittent) is treated the same as a key that fails 4 times in a row (systemic). A per-minute retry budget would be more nuanced:

```js
// Per key: allow up to 3 retries per 60s window
const keyRetryBudget = new Map(); // hash → { count, windowStart }
function canRetry(hash) {
  const now = Date.now();
  let budget = keyRetryBudget.get(hash);
  if (!budget || now - budget.windowStart > 60_000) {
    budget = { count: 0, windowStart: now };
  }
  budget.count++;
  keyRetryBudget.set(hash, budget);
  return budget.count <= 3;
}
```

**F6.3 — Circuit breaker pattern.** The current system has a simple "drop after N failures" (rotation-manager.js:146-149). A proper circuit breaker has three states:

| State | Behavior |
|-------|----------|
| **Closed** | Normal operation. Track failures. |
| **Open** | All requests skip this key. Start a reset timer. |
| **Half-Open** | Allow ONE probe request. If it succeeds → Closed. If it fails → Open again. |

The current cooldown system is essentially Open → (timer) → Closed without the Half-Open probe. The health-pinger partially serves this role but is on a 5-minute interval and tests random keys, not the specific key that just opened.

**Action — Enhance `applyCooldown` with half-open state:**

```js
applyCooldown(hash, httpStatus) {
  const duration = httpStatus === 402 ? COOLDOWN_402 : COOLDOWN_429;
  this.cooldowns.set(hash, Date.now() + duration);
  this.circuitState.set(hash, 'open');
  // Schedule half-open transition
  setTimeout(() => {
    if (this.circuitState.get(hash) === 'open') {
      this.circuitState.set(hash, 'half-open');
    }
  }, duration);
}
```

In `getNextKey()`, prefer keys in `closed` state, allow `half-open` keys with reduced weight (they'll be probed), and skip `open` keys.

**F6.4 — Model fallback is too narrow.** At proxy.js:228-234, the model fallback chain only handles `claude-3.5` and `gpt-4o` → `gemini-2.5-pro`. This misses:
- `gpt-4o-mini` failures
- `claude-sonnet-4` failures
- `o1`/`o3` failures
- Any other model

**Action:** Implement a configurable fallback map stored in DB or config, with a generic fallback (e.g., same provider's cheaper model, then cross-provider).

---

## 7. Observability Tricks

### Current Implementation

**File: `server/routes/proxy.js:69-100`** — `logRequest()` writes to `RequestLog` with: keyHash, model, status, latencyMs, promptTokens, completionTokens.

**File: `server/routes/proxy.js:240`** — One-line log: `[PROXY] POST /chat/completions → 200 (key: abc12345…, account: work)`

### Findings

**F7.1 — No request tracing IDs.** There is no way to correlate a Hydra proxy request with an OpenRouter request. If OpenRouter shows a request in their dashboard, there's no Hydra-side ID to match it.

**Action — Generate and inject a trace ID:**

```js
const traceId = crypto.randomUUID();
// Log it locally
logger.info(`[PROXY] trace=${traceId} ${req.method} ${path}`);
// Send it upstream as a custom header
headers: {
  ...,
  'X-Hydra-Trace-Id': traceId,
}
```

OpenRouter may or may not preserve custom headers, but the trace ID should also be included in the `HTTP-Referer` or `X-Title` header as a hack:

```js
'X-Title': `Hydra trace:${traceId}`,
```

This way, the trace ID appears in OpenRouter's usage logs under the "app name" field.

**F7.2 — TTFB vs total latency is conflated.** As noted in F1.2, for streaming requests, `latencyMs` is recorded at the moment the stream starts (line 256), not when it ends. For non-streaming requests, `latencyMs` is accurate (recorded after `upstreamRes.json()` at line 265).

**Action:** Add a `ttfbMs` field to RequestLog schema and record both:

```prisma
model RequestLog {
  // ... existing fields ...
  ttfbMs       Int?    // Time to first byte from upstream
  latencyMs    Int     // Total request time (for non-stream: same as ttfbMs; for stream: time to stream end)
}
```

**F7.3 — No per-key latency tracking.** The rotation manager has no concept of "slow" vs "fast" keys. A key that consistently takes 5s to respond vs one that takes 500ms gets equal weight.

**Action — Track rolling average latency per key:**

```js
class KeyLatencyTracker {
  latencies = new Map(); // hash → { samples: number[], avg: number }

  record(hash, latencyMs) {
    let rec = this.latencies.get(hash);
    if (!rec) { rec = { samples: [] }; this.latencies.set(hash, rec); }
    rec.samples.push(latencyMs);
    if (rec.samples.length > 50) rec.samples.shift();
    rec.avg = rec.samples.reduce((a, b) => a + b, 0) / rec.samples.length;
  }

  getAvgLatency(hash) {
    return this.latencies.get(hash)?.avg ?? Infinity;
  }
}
```

Then in `getNextKey()`, factor latency into weight:

```js
const avgLat = latencyTracker.getAvgLatency(k.hash);
const latencyFactor = avgLat < 1000 ? 1.0 : avgLat < 3000 ? 0.5 : 0.1;
weight *= latencyFactor;
```

**F7.4 — No structured logging.** The `logger.info/error` calls use string interpolation, making it hard to parse logs programmatically. Consider structured JSON logging for the hot path:

```js
logger.info({ traceId, method, path, status, keyHash, latencyMs, model }, 'proxy_request');
```

---

## 8. Classic Optimization

### Findings

**F8.1 — Double JSON serialization on every request.** At proxy.js:126-128:
```js
const baseBody = req.body && typeof req.body === 'object'
  ? JSON.parse(JSON.stringify(req.body))
  : req.body;
```
And again at proxy.js:140-143:
```js
const cloned = JSON.parse(JSON.stringify(baseBody));
if (fallbackModel) cloned.model = fallbackModel;
return JSON.stringify(cloned);
```
This means every request does 3-4 JSON parse/stringify operations. For large request bodies (long conversation history), this is expensive.

**Action — Use structured clone or direct mutation:**

```js
// First clone: only needed to avoid mutating req.body
const baseBody = structuredClone(req.body); // faster than JSON round-trip in Node 18+

// In buildBody(): if no fallback model, stringify baseBody directly
const buildBody = () => {
  if (req.method === 'GET' || !baseBody) return undefined;
  if (typeof baseBody !== 'object') return JSON.stringify(baseBody);
  if (!fallbackModel) return JSON.stringify(baseBody); // skip re-clone
  const cloned = { ...baseBody, model: fallbackModel }; // spread clone (shallow, sufficient)
  return JSON.stringify(cloned);
};
```

**F8.2 — No buffer pooling.** The streaming pipe creates new Buffer objects for each chunk. Node.js's `Readable.fromWeb()` allocates fresh buffers per `pull()`. For very high throughput, a buffer pool that recycles fixed-size chunks reduces GC pressure.

**Action — Low priority for this use case.** The proxy handles 1-10 concurrent requests, not 10,000. Buffer pooling adds complexity for marginal gain. Recommended only if GC pauses become measurable.

**F8.3 — Pre-serialized common headers.** The proxy constructs a new headers object per request (proxy.js:180-185). The only variable is `Authorization: Bearer ${keyEntry.keyString}`. The rest are static.

**Action — Pre-serialize static headers:**

```js
const STATIC_HEADERS = {
  'Content-Type': 'application/json',
  'HTTP-Referer': 'http://localhost:3001',
  'X-Title': 'Hydra Pool Router',
};

// Per request:
const headers = { ...STATIC_HEADERS, Authorization: `Bearer ${keyEntry.keyString}` };
```

This is a micro-optimization but costs nothing.

**F8.4 — RequestLog write is fire-and-forget but allocates.** Each `logRequest()` call (proxy.js:69-100) creates a Prisma `requestLog.create()` promise. For high request rates, these accumulate in the microtask queue. The `.catch()` handler also creates a fallback `create()` attempt on foreign key violation.

**Action — Batch log writes:** Buffer logs and flush every N seconds:

```js
const logBuffer = [];
function logRequest(...args) {
  logBuffer.push(args);
  if (logBuffer.length >= 20) flushLogs();
}
async function flushLogs() {
  const batch = logBuffer.splice(0);
  await prisma.requestLog.createMany({ data: batch.map(...) });
}
setInterval(flushLogs, 5000);
```

`createMany` is significantly faster than individual `create` calls — a single SQLite transaction vs N transactions.

**F8.5 — `Readable.fromWeb()` conversion overhead.** Each streaming request converts a Web ReadableStream to a Node.js Readable. This is an allocation. An alternative: use `upstreamRes.body.getReader()` and write chunks to `res` directly, avoiding the intermediate Readable.

```js
const reader = upstreamRes.body.getReader();
req.on('close', () => reader.cancel());

async function pump() {
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise(r => res.once('drain', r));
    }
    res.end();
  } catch (err) {
    res.destroy(err);
  }
}
pump();
```

This gives explicit control over backpressure and avoids the Readable.fromWeb allocation.

---

## 9. Edge Cases

### Findings

**F9.1 — HTTP 200 with error in JSON body.** OpenRouter sometimes returns `{ "error": { "message": "...", "code": ... } }` with a 200 status. The proxy at proxy.js:261-267 checks `contentType.includes('application/json')`, parses the body, and returns it to the client without checking for embedded errors.

**Action — Check for error in 200 response body:**

```js
const data = await upstreamRes.json();
if (data.error) {
  // OpenRouter returned an error in a 200 body
  logger.warn(`[PROXY] 200-OK body contains error: ${JSON.stringify(data.error)}`);
  // Still forward to client (they should handle it), but log it distinctly
  logRequest(keyEntry.hash, data.model || currentModel(), 200, Date.now() - startTime, data.usage);
  return res.json(data);
}
```

**F9.2 — Partial streaming failure (stream starts OK, then 500 mid-stream).** Once the proxy starts piping the SSE stream (proxy.js:257), it has no way to detect or recover from upstream errors mid-stream. If OpenRouter's stream breaks, the client receives a truncated SSE response with no error indication.

**Action — Wrap the pipe with error handling:**

```js
const nodeStream = Readable.fromWeb(upstreamRes.body);
nodeStream.on('error', (err) => {
  logger.error(`[PROXY] Stream error mid-flight: ${err.message}`);
  if (!res.writableEnded) {
    // Attempt to send an SSE error event to the client
    res.write(`data: ${JSON.stringify({ error: { message: 'Hydra: upstream stream error', type: 'stream_error' } })}\n\n`);
    res.end();
  }
});
nodeStream.pipe(res);
```

**F9.3 — Long-running requests (5+ minute SSE).** The proxy has a 30-second abort timeout (proxy.js:176):
```js
timeoutId = setTimeout(() => ctrl.abort(), 30000);
```
This aborts the ENTIRE fetch, including the streaming phase. For code generation tasks that can take 2-5 minutes, this will kill the request mid-stream. The 30s timeout applies to the time-to-first-byte, not the total streaming duration.

**Action — Separate connect timeout from stream timeout:**

```js
const CONNECT_TIMEOUT = 30_000;   // 30s to get first byte
const STREAM_TIMEOUT = 5 * 60_000; // 5min max stream duration

let timeoutId = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT);

// After receiving response headers, switch to stream timeout
clearTimeout(timeoutId);
timeoutId = setTimeout(() => {
  logger.warn(`[PROXY] Stream timeout after ${STREAM_TIMEOUT}ms`);
  if (upstreamRes.body?.cancel) upstreamRes.body.cancel();
}, STREAM_TIMEOUT);
```

Or better: use the `AbortSignal.timeout()` for connect, and a separate timer for stream duration.

**F9.4 — Empty pool + concurrent requests.** If multiple requests arrive while the pool is empty (all keys evicted), each request independently calls `rotationManager.getNextKey()` which returns null, then `getStatusAsync()` which hits the DB. This creates a thundering herd on the DB.

**Action — Cache the "pool empty" state for a short duration:**

```js
let poolEmptyCache = { value: false, expiresAt: 0 };
async function isPoolEmpty() {
  if (poolEmptyCache.expiresAt > Date.now()) return poolEmptyCache.value;
  const status = await rotationManager.getStatusAsync();
  poolEmptyCache = { value: status.totalPooled === 0, expiresAt: Date.now() + 5000 };
  return poolEmptyCache.value;
}
```

**F9.5 — Request body already consumed.** The proxy uses `req.body` (parsed by `express.json()` middleware). If `express.json()` fails to parse a malformed body, `req.body` may be `undefined` or an empty object. The proxy handles this at line 126-128 with a fallback, but does NOT return a 400 for malformed JSON — it silently treats it as an empty body, which will likely cause a 400 from OpenRouter anyway.

**Action — Check `req.body` validity early:**

```js
if (req.method !== 'GET' && path !== '/models' && !req.body) {
  return sendHydraError(res, 400, 'Request body is required', 'invalid_request');
}
```

---

## 10. Security Surface

### Findings

**F10.1 — No request timeout on the downstream side.** A malicious client can open a streaming request and read chunks forever (or never read, creating backpressure). The 30s `AbortController` timeout (proxy.js:176) only covers the upstream fetch — it fires if OpenRouter doesn't respond within 30s. Once the stream starts piping, there is no limit on how long the downstream connection stays open.

**Action — Add downstream request timeout:**

```js
// Maximum duration a client connection may be open
const MAX_REQUEST_DURATION = 5 * 60 * 1000; // 5 minutes
const downstreamTimeout = setTimeout(() => {
  if (!res.writableEnded) {
    logger.warn('[PROXY] Downstream request timeout');
    res.destroy();
  }
}, MAX_REQUEST_DURATION);
res.on('finish', () => clearTimeout(downstreamTimeout));
```

**F10.2 — No max body size.** The `express.json()` middleware at index.js:42 uses the default 100KB limit. This is reasonable but should be explicitly set:

```js
app.use(express.json({ limit: '1mb' })); // OpenAI API limit is ~1MB for chat
```

Without an explicit limit, a client could send a multi-GB body that exhausts memory before Express rejects it. The default in Express 4.x is 100KB (`body-parser` default), but this is not guaranteed across versions.

**F10.3 — No per-client rate limiting on the proxy endpoint.** The auth rate limiter (index.js:45-49) only applies to `/api/auth/`. The `/v1` proxy endpoint has NO rate limiting. A malicious client (even one with a valid key) could send thousands of requests per second, exhausting the pool's rate limits.

**Action — Add rate limiting to the proxy endpoint:**

```js
import { rateLimit } from 'express-rate-limit';

const proxyLimiter = rateLimit({
  windowMs: 60_000,
  max: 60, // 60 requests per minute per IP
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    sendHydraError(res, 429, 'Client rate limit exceeded', 'client_rate_limit');
  },
});

app.use('/v1', proxyLimiter, proxyRoutes);
```

**F10.4 — Key pool probing via timing attacks.** A client could discover the number of keys in the pool and their cooldown schedule by:
1. Sending many rapid requests
2. Observing when the `X-Hydra-Key-Hash` header changes (line 247)
3. Counting distinct hashes to learn pool size
4. Timing the appearance of 429 errors to map rate limit windows

The `X-Hydra-Key-Hash` header (proxy.js:247) leaks which key was used. An attacker who can make requests to the proxy can enumerate all key hashes.

**Action — Remove or truncate the key hash header in production:**

```js
// Option A: Remove entirely
// res.setHeader('X-Hydra-Key-Hash', keyEntry.hash.slice(0, 8));
// Option B: Only send if a debug flag is set
if (config.EXPOSE_KEY_HASH) {
  res.setHeader('X-Hydra-Key-Hash', keyEntry.hash.slice(0, 8));
}
```

**F10.5 — Master key comparison is timing-unsafe.** At proxy.js:65:
```js
return provided === expectedHydra || provided === expectedGeneric;
```
This uses `===` which is vulnerable to timing attacks (comparisons short-circuit on first differing character). For a local proxy on localhost, this is negligible risk, but for completeness:

```js
import { timingSafeEqual } from 'crypto';
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
```

**F10.6 — No request body validation before forwarding.** The proxy forwards `req.body` to OpenRouter without validating that it conforms to the OpenAI API schema. A malicious client could:
- Set `model` to an extremely expensive model (e.g., `o1-pro`)
- Set `max_tokens` to 100000
- Inject arbitrary headers or body fields

**Action — Validate request body against a schema:**

```js
const ALLOWED_MODELS = new Set([...]); // or fetch from cache
const MAX_TOKENS_LIMIT = 16000;

if (baseBody?.max_tokens && baseBody.max_tokens > MAX_TOKENS_LIMIT) {
  return sendHydraError(res, 400, `max_tokens exceeds ${MAX_TOKENS_LIMIT}`, 'invalid_request');
}
```

**F10.7 — `buildBody()` double-parse on every retry.** The `buildBody()` function at proxy.js:136-143 re-clones and re-stringifies the body on every attempt. If `fallbackModel` is null (most retries), this is wasteful. More critically, the body could be mutated between retries if the original `baseBody` reference is used elsewhere. The current double-clone is safe but expensive.

---

## Summary of Highest-Impact Actions

| Priority | Finding | Expected Impact |
|----------|---------|----------------|
| **P0** | F2.1 — Shared undici Agent for connection reuse | -50-100ms per request |
| **P0** | F9.3 — Separate connect/stream timeouts | Fix 30s stream kills |
| **P0** | F4.1 — Read X-RateLimit-Reset headers | Precise cooldowns vs blind 60s |
| **P1** | F6.1 — Exponential backoff with jitter | Prevent key cascade on 429 |
| **P1** | F1.2 — Transform stream for TTFB metrics | Accurate latency tracking |
| **P1** | F10.3 — Proxy endpoint rate limiting | Prevent pool exhaustion |
| **P1** | F10.4 — Remove X-Hydra-Key-Hash header | Close pool probing attack |
| **P2** | F8.1 — Eliminate double JSON serialization | Reduce CPU per request |
| **P2** | F8.4 — Batch RequestLog writes | Reduce DB contention |
| **P2** | F7.1 — Request tracing IDs | Debugging correlation |
| **P2** | F5.1 — Response cache for temp=0 | Save API calls on repeat prompts |
| **P3** | F3.1 — Request coalescing | Reduce duplicate upstream calls |
| **P3** | F4.2 — Predictive key warming | Proactive rotation before 429 |
| **P3** | F7.3 — Per-key latency tracking | Smart key selection |
| **P3** | F6.3 — Circuit breaker half-open state | Faster recovery from failures |

---

*End of audit. All file:line references are based on the codebase as of the audit date.*
