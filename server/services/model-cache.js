import { OR_BASE, config } from '../config.js';
import { prisma } from './db.js';

const MODELS_PATH = '/api/v1/models';
const MODEL_LIST_TIMEOUT_MS = 30000;
const CLIENT_MODEL_CACHE_TTL_MS = Number(process.env.HYDRA_CLIENT_MODEL_CACHE_TTL_MS || 30000);
let clientModelCache = {
  expiresAt: 0,
  all: null,
  free: null,
};

export function normalizeModelId(id) {
  return String(id ?? '').trim().toLowerCase();
}

export function isFreeModelId(id) {
  const normalized = normalizeModelId(id);
  return normalized === 'openrouter/free'
    || normalized.startsWith('openrouter/free/')
    || normalized.startsWith('openrouter/free:')
    || normalized.endsWith(':free')
    || normalized.endsWith('/free');
}

export function clearClientModelCache() {
  clientModelCache = {
    expiresAt: 0,
    all: null,
    free: null,
  };
}

export function normalizeUpstreamModel(m) {
  return {
    id: m.id,
    name: m.name ?? m.id,
    ctx: m.context_length ?? null,
    category: null,
    ownedBy: m.architecture?.instructor ? 'instructor' : null,
  };
}

/**
 * Replace CachedModel rows with the upstream OpenRouter model list.
 * @param {Array} models - items from OpenRouter `data` array
 * @returns {number} rows written
 */
export async function upsertModelsFromUpstream(models) {
  if (!Array.isArray(models) || models.length === 0) return 0;
  const rows = models.map(normalizeUpstreamModel);
  await prisma.$transaction([
    prisma.cachedModel.deleteMany({}),
    prisma.cachedModel.createMany({ data: rows }),
  ]);
  clearClientModelCache();
  return rows.length;
}

function modelsReferer() {
  const port = config.PORT ?? 3001;
  return `http://localhost:${port}`;
}

/**
 * GET OpenRouter /api/v1/models with a standard API key.
 * @returns {{ ok: true, data: object[], raw: object } | { ok: false, status: number, data: null }}
 */
export async function fetchOpenRouterModelsList(apiKey) {
  const res = await fetch(`${OR_BASE}${MODELS_PATH}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': modelsReferer(),
    },
    signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, data: null, raw: null };
  }
  const raw = await res.json();
  const list = Array.isArray(raw?.data) ? raw.data : [];
  return { ok: true, status: res.status, data: list, raw };
}

/** OpenAI-style model object for clients reading from SQLite cache */
export function cachedRowToClientModel(m) {
  return {
    id: m.id,
    object: 'model',
    created: 0,
    owned_by: m.ownedBy || 'openrouter',
    name: m.name,
  };
}

export async function getCachedClientModels({ freeOnly = false } = {}) {
  const now = Date.now();
  if (clientModelCache.all && clientModelCache.expiresAt > now) {
    return freeOnly ? clientModelCache.free : clientModelCache.all;
  }

  const cached = await prisma.cachedModel.findMany({
    orderBy: [{ name: 'asc' }],
    select: { id: true, name: true, ctx: true, ownedBy: true },
  });
  const all = cached.map(cachedRowToClientModel);
  clientModelCache = {
    expiresAt: now + CLIENT_MODEL_CACHE_TTL_MS,
    all,
    free: all.filter((model) => isFreeModelId(model.id)),
  };

  return freeOnly ? clientModelCache.free : clientModelCache.all;
}

export async function getModelCacheSummary() {
  const [count, newest] = await Promise.all([
    prisma.cachedModel.count(),
    prisma.cachedModel.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    }),
  ]);
  return {
    count,
    updatedAt: newest?.updatedAt?.toISOString() ?? null,
  };
}
