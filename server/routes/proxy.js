/**
 * Hydra Pool Proxy — OpenAI-compatible proxy endpoint.
 *
 * Intercepts all /v1/* requests, validates the master key,
 * rotates through pooled keys, and forwards to OpenRouter.
 */

import { Router } from 'express';
import { Readable } from 'stream';

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

// Minimal static fallback model list if pool is empty
const STATIC_MODELS = [
  { id: 'openai/gpt-4o', object: 'model', created: 1725000000, owned_by: 'openai' },
  { id: 'openai/gpt-4o-mini', object: 'model', created: 1725000000, owned_by: 'openai' },
  { id: 'anthropic/claude-3.5-sonnet', object: 'model', created: 1725000000, owned_by: 'anthropic' },
  { id: 'anthropic/claude-3-haiku', object: 'model', created: 1725000000, owned_by: 'anthropic' },
  { id: 'google/gemini-pro-1.5', object: 'model', created: 1725000000, owned_by: 'google' },
  { id: 'meta-llama/llama-3.1-70b-instruct', object: 'model', created: 1725000000, owned_by: 'meta' },
];

// Headers we should NOT forward from OpenRouter back to the client
const BLOCKED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

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

// ─── Main proxy handler ───────────────────────────────────────────────────────

router.use(async (req, res) => {
  const path = req.path; // e.g. /chat/completions, /models
  const upstreamPathWithQuery = req.url.startsWith('/') ? req.url : `/${req.url}`;
  const startTime = Date.now();

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

  const baseBody = req.body && typeof req.body === 'object'
    ? JSON.parse(JSON.stringify(req.body))
    : req.body;
  const isStream = baseBody?.stream === true;
  const attempted = new Set();
  const evicted = new Set();
  let lastError = null;
  let fallbackModel = null;

  const currentModel = () => fallbackModel || baseBody?.model || 'unknown';
  const buildBody = () => {
    if (req.method === 'GET' || !baseBody) return undefined;
    if (typeof baseBody !== 'object') return JSON.stringify(baseBody);

    const cloned = JSON.parse(JSON.stringify(baseBody));
    if (fallbackModel) cloned.model = fallbackModel;
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
    let timeoutId;

    try {
      const ctrl = new AbortController();
      timeoutId = setTimeout(() => ctrl.abort(), 30000);

      const upstreamRes = await fetch(`${OR_BASE}/api/v1${upstreamPathWithQuery}`, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${keyEntry.keyString}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3001',
          'X-Title': 'Hydra Pool Router',
        },
        body: buildBody(),
        signal: ctrl.signal,
      });

      // ── Error status handling ──
      if (upstreamRes.status === 429) {
        await rotationManager.recordFailure(keyEntry.hash, 429);
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
        req.on('close', () => {
          if (upstreamRes.body?.cancel) upstreamRes.body.cancel();
        });

        logRequest(keyEntry.hash, currentModel(), upstreamRes.status, Date.now() - startTime);
        Readable.fromWeb(upstreamRes.body).pipe(res);
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
        logger.error(`[PROXY] Upstream fetch timeout (30s) on attempt ${attempt}`);
        lastError = { status: 504, message: 'Upstream timeout after 30s' };
        continue;
      }

      logger.error(`[PROXY] Upstream fetch error (attempt ${attempt}): ${err.message}`);
      lastError = { status: 502, message: err.message };
      // network error — try next key
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
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
  try {
    // Prefer cached models when available (populated by /api/pool/models/refresh).
    const cached = await prisma.cachedModel.findMany({
      orderBy: [{ name: 'asc' }],
    });

    if (cached.length > 0) {
      res.setHeader('X-Hydra-Models-Source', 'cache');
      return res.json({
        object: 'list',
        data: cached.map(cachedRowToClientModel),
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
