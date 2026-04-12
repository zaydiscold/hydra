/**
 * Hydra Pool Proxy — OpenAI-compatible proxy endpoint.
 *
 * Intercepts all /v1/* requests, validates the master key,
 * rotates through pooled keys, and forwards to OpenRouter.
 */

import { Router } from 'express';
import { Readable, Transform, pipeline } from 'stream';

import { OR_BASE } from '../config.js';
import {
  cachedRowToClientModel,
  fetchOpenRouterModelsList,
  upsertModelsFromUpstream,
} from '../services/model-cache.js';
import { prisma } from '../services/db.js';
import { logger } from '../services/logger.js';
import { rotationManager } from '../services/rotation-manager.js';
import { getMasterProxyKey, getGenericProxyKey } from '../services/store.js';

const router = Router();
const MAX_RETRIES = 3;

// Minimal static fallback model list if pool is empty AND DB cache is empty
const STATIC_MODELS = [
  { id: 'openai/gpt-4o', object: 'model', created: 1725000000, owned_by: 'openai' },
  { id: 'openai/gpt-4o-mini', object: 'model', created: 1725000000, owned_by: 'openai' },
  { id: 'anthropic/claude-sonnet-4-5-20250514', object: 'model', created: 1746000000, owned_by: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5-20251001', object: 'model', created: 1746000000, owned_by: 'anthropic' },
  { id: 'google/gemini-2.5-pro', object: 'model', created: 1746000000, owned_by: 'google' },
  { id: 'meta-llama/llama-3.3-70b-instruct', object: 'model', created: 1746000000, owned_by: 'meta' },
];

// Headers we should NOT forward from OpenRouter back to the client
const BLOCKED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

function normalizeModelId(id) {
  return String(id ?? '').trim().toLowerCase();
}

function isFreeModelId(id) {
  const normalized = normalizeModelId(id);
  return normalized === 'openrouter/free'
    || normalized.startsWith('openrouter/free/')
    || normalized.startsWith('openrouter/free:')
    || normalized.endsWith(':free')
    || normalized.endsWith('/free');
}

async function getCachedModels({ freeOnly = false } = {}) {
  const cached = await prisma.cachedModel.findMany({
    orderBy: [{ name: 'asc' }],
    select: { id: true, name: true, ctx: true, ownedBy: true },
  });

  const models = cached.map(cachedRowToClientModel);
  return freeOnly ? models.filter((model) => isFreeModelId(model.id)) : models;
}

async function resolveFreeModel(requestedModel) {
  const freeModels = await getCachedModels({ freeOnly: true });
  if (freeModels.length === 0) return null;

  const requested = normalizeModelId(requestedModel);
  if (requested) {
    const match = freeModels.find((model) => normalizeModelId(model.id) === requested);
    if (match) return match.id;
  }

  return freeModels[0].id;
}

function sendHydraError(res, status, message, code, headerValue) {
  if (headerValue) {
    res.setHeader('X-Hydra', headerValue);
  }

  return res.status(status).json({
    error: {
      message,
      type: status === 429 ? 'rate_limit_error' : 'server_error',
      code,
    },
  });
}

/** Validate the master proxy key against the vault-derived token */
async function validateMasterKey(authHeader) {
  if (!authHeader?.startsWith('Bearer sk-')) return false;
  const provided = authHeader.slice(7).trim();
  if (!provided) return false;

  const expectedHydra = getMasterProxyKey();
  const expectedGeneric = getGenericProxyKey();
  return provided === expectedHydra || provided === expectedGeneric;
}

/** Asynchronously log proxy requests to the DB */
function logRequest(keyHash, model, status, latencyMs, tokens = {}) {
  prisma.requestLog.create({
    data: {
      keyHash: keyHash ?? null,
      model,
      status,
      latencyMs,
      promptTokens: tokens.prompt_tokens || null,
      completionTokens: tokens.completion_tokens || null,
    },
  }).catch(async (err) => {
    if (keyHash) {
      try {
        await prisma.requestLog.create({
          data: {
            keyHash: null,
            model,
            status,
            latencyMs,
            promptTokens: tokens.prompt_tokens || null,
            completionTokens: tokens.completion_tokens || null,
          },
        });
        return;
      } catch {
        // fall through to error logging below
      }
    }

    logger.error(`[PROXY] Failed to write RequestLog: ${err.message}`);
  });
}

async function createRequestLog(keyHash, model, status, latencyMs) {
  try {
    return await prisma.requestLog.create({
      data: {
        keyHash: keyHash ?? null,
        model,
        status,
        latencyMs,
      },
    });
  } catch (err) {
    if (keyHash) {
      try {
        return await prisma.requestLog.create({
          data: {
            keyHash: null,
            model,
            status,
            latencyMs,
          },
        });
      } catch {
        // fall through
      }
    }
    logger.error(`[PROXY] Failed to create RequestLog placeholder: ${err.message}`);
    return null;
  }
}

function updateRequestLog(logId, model, latencyMs, tokens = {}) {
  if (!logId) return;
  prisma.requestLog.update({
    where: { id: logId },
    data: {
      model,
      latencyMs,
      promptTokens: tokens.prompt_tokens || null,
      completionTokens: tokens.completion_tokens || null,
    },
  }).catch((err) => {
    logger.error(`[PROXY] Failed to update RequestLog: ${err.message}`);
  });
}

/**
 * SseUsageObserver — a Transform stream that sits between the upstream
 * (OpenRouter) response and the client, observing SSE frames without
 * altering them.  It buffers incoming bytes into SSE frames (delimited
 * by blank lines), parses each `data:` line for JSON, and captures the
 * last `usage` and `model` fields seen before the stream ends.
 */
class SseUsageObserver extends Transform {
  constructor(options = {}) {
    super(options);
    this._buffer = '';
    this._usage = null;
    this._extractedModel = null;
  }

  _transform(chunk, _encoding, callback) {
    // Pass through unmodified — observation only
    this.push(chunk);
    // Accumulate for SSE parsing
    this._buffer += chunk.toString('utf8');
    this._parseFrames();
    callback();
  }

  _flush(callback) {
    // Drain any partial frame remaining in the buffer
    if (this._buffer.trim()) this._parseFrames();
    callback();
  }

  _parseFrames() {
    while (true) {
      const boundary = this._buffer.indexOf('\n\n');
      if (boundary < 0) break;

      const frame = this._buffer.slice(0, boundary);
      this._buffer = this._buffer.slice(boundary + 2);

      const dataLines = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      for (const dataLine of dataLines) {
        if (dataLine === '[DONE]') continue;
        try {
          const parsed = JSON.parse(dataLine);
          if (parsed?.usage) this._usage = parsed.usage;
          if (parsed?.model) this._extractedModel = parsed.model;
        } catch {
          // Ignore non-JSON SSE events.
        }
      }
    }
  }

  /** The last `usage` object extracted from SSE frames (or null). */
  get usage() { return this._usage; }
  /** The last `model` string extracted from SSE frames (or null). */
  get extractedModel() { return this._extractedModel; }
}

// ─── Main proxy handler ───────────────────────────────────────────────────────

router.use(async (req, res) => {
  const path = req.path; // e.g. /chat/completions, /models
  const startTime = Date.now();
  const isFreeRoute = path.startsWith('/free');
  const upstreamPathWithQuery = (() => {
    const rawUrl = req.url.startsWith('/') ? req.url : `/${req.url}`;
    return isFreeRoute ? rawUrl.replace(/^\/free(?=\/|$)/, '') : rawUrl;
  })();

  // ── Auth ──
  const isValid = await validateMasterKey(req.headers.authorization);
  if (!isValid) {
    return res.status(401).json({
      error: {
        message: 'Invalid Hydra key — copy it from Pool Manager',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
  }

  // ── /models — optional live passthrough ──
  if (req.method === 'GET' && path === '/models') {
    return handleModels(req, res);
  }

  // ── /free/models — cached free-tier catalog ──
  if (req.method === 'GET' && path === '/free/models') {
    return handleFreeModels(req, res);
  }

  const baseBody = req.body && typeof req.body === 'object'
    ? JSON.parse(JSON.stringify(req.body))
    : req.body;
  let forcedFreeModel = null;
  if (req.method === 'POST' && path === '/free/chat/completions') {
    forcedFreeModel = await resolveFreeModel(baseBody?.model);
    if (!forcedFreeModel) {
      return sendHydraError(
        res,
        503,
        'No cached free models are available. Refresh models in Pool Manager and try again.',
        'hydra_free_models_empty',
        'free-models-empty'
      );
    }
  }
  const isStream = baseBody?.stream === true;
  const attempted = new Set();
  const evicted = new Set();
  let lastError = null;
  let fallbackModel = forcedFreeModel;

  const currentModel = () => fallbackModel || baseBody?.model || 'unknown';
  const buildBody = () => {
    if (req.method === 'GET' || !baseBody) return undefined;
    if (typeof baseBody !== 'object') return JSON.stringify(baseBody);

    const cloned = JSON.parse(JSON.stringify(baseBody));
    if (fallbackModel) cloned.model = fallbackModel;
    if (cloned.stream === true && upstreamPathWithQuery.startsWith('/chat/completions')) {
      cloned.stream_options = {
        ...(cloned.stream_options && typeof cloned.stream_options === 'object' ? cloned.stream_options : {}),
        include_usage: true,
      };
    }
    return JSON.stringify(cloned);
  };

  // ── Failover loop ──
  for (let attempt = 0; attempt < MAX_RETRIES;) {
    const keyEntry = await rotationManager.getNextKey(attempted);

    if (!keyEntry) {
      const status = await rotationManager.getStatusAsync();
      if (status.totalPooled > 0 && status.available === 0) {
        return sendHydraError(
          res,
          429,
          'All Hydra pool keys are cooling down. Try again shortly.',
          'hydra_pool_exhausted',
          'all-keys-cooling'
        );
      }

      return sendHydraError(
        res,
        503,
        'Hydra pool is empty. Enable keys in the Pool Manager tab.',
        'hydra_pool_empty',
        'pool-empty'
      );
    }

    attempt += 1;
    attempted.add(keyEntry.hash);
    let connectTimeoutId;
    let streamTimeoutId;

    try {
      // Connect timeout: short (10s) — only covers TCP+TLS handshake + waiting for headers.
      // Stream timeout: only applied to non-SSE responses (5 min) — SSE streams are not
      // arbitrarily killed since code generation can run 2-5 minutes.
      const CONNECT_TIMEOUT_MS = 10_000;
      const NON_STREAM_TIMEOUT_MS = 5 * 60_000;
      const ctrl = new AbortController();
      connectTimeoutId = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT_MS);

      const upstreamRes = await fetch(`${OR_BASE}/api/v1${upstreamPathWithQuery}`, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${keyEntry.keyString}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3001',
          // X-Title is a self-identifying beacon — only send if HYDRA_PROXY_TITLE is explicitly set
          ...(process.env.HYDRA_PROXY_TITLE ? { 'X-Title': process.env.HYDRA_PROXY_TITLE } : {}),
        },
        body: buildBody(),
        signal: ctrl.signal,
      });

      // Headers received — connect phase succeeded, clear connect timeout.
      clearTimeout(connectTimeoutId);
      connectTimeoutId = null;

      // For non-stream responses, set a generous timeout so we don't hang forever.
      // SSE streams intentionally have no stream timeout — they end when upstream ends.
      if (!isStream) {
        streamTimeoutId = setTimeout(() => ctrl.abort(), NON_STREAM_TIMEOUT_MS);
      }

      // ── Error status handling ──
      if (upstreamRes.status === 429) {
        // Peek at body to distinguish IP-level vs key-level rate limit
        let bodyText = '';
        try { bodyText = await upstreamRes.text(); } catch { /* ignore */ }
        const isIpLimit = bodyText && !bodyText.toLowerCase().includes('key') &&
          bodyText.toLowerCase().includes('rate limit');

        // Respect upstream rate-limit headers for precise cooldown duration
        const resetHeader = upstreamRes.headers.get('X-RateLimit-Reset');
        const retryAfterHeader = upstreamRes.headers.get('Retry-After');
        let cooldownMs = null;
        if (resetHeader) {
          // X-RateLimit-Reset is usually a Unix timestamp (seconds)
          const resetAt = Number(resetHeader) * 1000;
          if (resetAt > Date.now()) cooldownMs = resetAt - Date.now();
        }
        if (!cooldownMs && retryAfterHeader) {
          // Retry-After can be seconds or an HTTP-date; try numeric first
          const secs = Number(retryAfterHeader);
          if (secs > 0) {
            cooldownMs = secs * 1000;
          } else {
            const httpDate = Date.parse(retryAfterHeader);
            if (httpDate > Date.now()) cooldownMs = httpDate - Date.now();
          }
        }

        if (isIpLimit) {
          rotationManager.coolAllKeys(cooldownMs);
        } else {
          await rotationManager.recordFailure(keyEntry.hash, 429, cooldownMs);
        }
        lastError = { status: 429, hash: keyEntry.hash };
        logRequest(keyEntry.hash, currentModel(), 429, Date.now() - startTime);
        continue;
      }

      if (upstreamRes.status === 402) {
        await rotationManager.recordFailure(keyEntry.hash, 402);
        lastError = { status: 402, hash: keyEntry.hash };
        logRequest(keyEntry.hash, currentModel(), 402, Date.now() - startTime);
        continue;
      }

      if (upstreamRes.status === 401) {
        await rotationManager.recordFailure(keyEntry.hash, 401);
        await rotationManager.evict(keyEntry.hash);
        evicted.add(keyEntry.hash);
        logRequest(keyEntry.hash, currentModel(), 401, Date.now() - startTime);
        continue;
      }

      if (upstreamRes.status >= 500 && upstreamRes.status < 600) {
        const wasDropped = await rotationManager.recordFailure(keyEntry.hash, upstreamRes.status);
        lastError = { status: upstreamRes.status, hash: keyEntry.hash, message: `Upstream error ${upstreamRes.status}` };
        logRequest(keyEntry.hash, currentModel(), upstreamRes.status, Date.now() - startTime);

        // ── Model fallback chain (request-scoped + deterministic) ──
        if (!wasDropped && !fallbackModel && baseBody && baseBody.model) {
          const model = String(baseBody.model).toLowerCase();
          if (model.includes('claude-3.5') || model.includes('gpt-4o')) {
            fallbackModel = 'google/gemini-2.5-pro';
            logger.warn(`[PROXY] Model ${baseBody.model} returned 5xx, falling back to ${fallbackModel}`);
          }
        }
        continue;
      }

      // ── Success — forward the response ──
      rotationManager.recordSuccess(keyEntry.hash); // Reset failure count
      logger.info(`[PROXY] ${req.method} ${path} → ${upstreamRes.status} (key: ${keyEntry.hash.slice(0, 8)}…, account: ${keyEntry.account?.alias ?? '?'})`);

      upstreamRes.headers.forEach((value, header) => {
        if (!BLOCKED_RESPONSE_HEADERS.has(header.toLowerCase())) {
          res.setHeader(header, value);
        }
      });
      res.setHeader('X-Hydra-Key-Hash', keyEntry.hash.slice(0, 8));
      res.setHeader('X-Hydra-Account', keyEntry.account?.alias ?? 'unknown');
      res.status(upstreamRes.status);

      if (isStream && upstreamRes.body) {
        const requestLog = await createRequestLog(
          keyEntry.hash,
          currentModel(),
          upstreamRes.status,
          Date.now() - startTime,
        );
        const sseObserver = new SseUsageObserver();

        req.on('close', () => {
          if (upstreamRes.body?.cancel) upstreamRes.body.cancel();
        });

        const nodeStream = Readable.fromWeb(upstreamRes.body);

        // Pipeline: OR response → SseUsageObserver (pass-through) → client
        // The observer extracts usage/model from SSE frames without altering data.
        pipeline(nodeStream, sseObserver, res, (err) => {
          const finalModel = sseObserver.extractedModel || currentModel();
          const finalUsage = sseObserver.usage || {};
          const latency = Date.now() - startTime;

          if (err) {
            logger.error(`[PROXY] Stream pipeline failed: ${err.message}`);
          }
          updateRequestLog(requestLog?.id, finalModel, latency, finalUsage);
        });
        return;
      }

      const contentType = upstreamRes.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const data = await upstreamRes.json();
        const tokens = data.usage || {};
        logRequest(keyEntry.hash, data.model || currentModel(), upstreamRes.status, Date.now() - startTime, tokens);
        return res.json(data);
      }

      const text = await upstreamRes.text();
      logRequest(keyEntry.hash, currentModel(), upstreamRes.status, Date.now() - startTime);
      return res.send(text);
    } catch (err) {
      if (err.name === 'AbortError') {
        const phase = connectTimeoutId ? 'connect' : 'stream';
        logger.error(`[PROXY] Upstream fetch ${phase} timeout on attempt ${attempt}`);
        lastError = { status: 504, message: `Upstream ${phase} timeout` };
        continue;
      }

      logger.error(`[PROXY] Upstream fetch error (attempt ${attempt}): ${err.message}`);
      lastError = { status: 502, message: err.message };
      // network error — try next key
    } finally {
      if (connectTimeoutId) clearTimeout(connectTimeoutId);
      if (streamTimeoutId) clearTimeout(streamTimeoutId);
    }
  }

  if (evicted.size > 0) {
    const status = await rotationManager.getStatusAsync();
    if (status.totalPooled === 0) {
      return sendHydraError(
        res,
        503,
        'All pooled keys were rejected upstream. Re-sync or replace them in Pool Manager.',
        'hydra_pool_unusable',
        'pool-drained'
      );
    }
  }

  if (lastError?.status === 429) {
    return sendHydraError(
      res,
      429,
      'Every eligible key is rate-limited right now. Hydra will retry them automatically after cooldown.',
      'hydra_all_keys_rate_limited',
      'all-rate-limited'
    );
  }

  if (lastError?.status === 402) {
    return sendHydraError(
      res,
      503,
      'Every eligible key is out of credits right now. Add credits or switch to other pooled keys.',
      'hydra_all_keys_out_of_credits',
      'all-out-of-credits'
    );
  }

  return sendHydraError(
    res,
    lastError?.status === 504 ? 504 : 502,
    lastError?.message ?? 'Hydra proxy encountered an upstream error.',
    lastError?.status === 504 ? 'hydra_timeout' : 'hydra_upstream_error'
  );
});

// ─── /v1/models handler ───────────────────────────────────────────────────────

async function handleModels(req, res) {
  return handleModelList(req, res, { freeOnly: false });
}

async function handleFreeModels(req, res) {
  return handleModelList(req, res, { freeOnly: true });
}

async function handleModelList(req, res, { freeOnly = false } = {}) {
  try {
    const cached = await getCachedModels({ freeOnly });

    if (cached.length > 0 || freeOnly) {
      res.setHeader('X-Hydra-Models-Source', 'cache');
      return res.json({
        object: 'list',
        data: cached,
      });
    }

    const keyEntry = await rotationManager.getNextKey();
    if (!keyEntry) {
      // Return a reasonable static list so clients like Cursor don't break
      res.setHeader('X-Hydra-Models-Source', 'static');
      return res.json({ object: 'list', data: STATIC_MODELS });
    }

    const result = await fetchOpenRouterModelsList(keyEntry.keyString);
    if (!result.ok) {
      res.setHeader('X-Hydra-Models-Source', 'static');
      return res.json({ object: 'list', data: STATIC_MODELS });
    }

    if (result.data.length > 0) {
      await upsertModelsFromUpstream(result.data);
    }

    res.setHeader('X-Hydra-Key-Hash', keyEntry.hash.slice(0, 8));
    res.setHeader('X-Hydra-Models-Source', 'live');
    return res.json(result.raw);
  } catch {
    res.setHeader('X-Hydra-Models-Source', 'static');
    return res.json({ object: 'list', data: STATIC_MODELS });
  }
}

export default router;
