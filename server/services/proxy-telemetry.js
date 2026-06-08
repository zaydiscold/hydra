const DEFAULT_MAX_KEY_ATTEMPTS = 8;
const MAX_MAX_KEY_ATTEMPTS = 32;

function optionalNonNegativeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
export function getProxyMaxKeyAttempts(value = process.env.HYDRA_PROXY_MAX_KEY_ATTEMPTS) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_KEY_ATTEMPTS;
  return Math.min(parsed, MAX_MAX_KEY_ATTEMPTS);
}

export function normalizeUsageCost(usage = {}) {
  const totalCost = optionalNonNegativeNumber(usage?.cost);
  return {
    totalCost,
    costSource: totalCost === null ? null : 'openrouter_usage',
  };
}

export function normalizeCatalogPricing(pricing = {}) {
  return {
    promptPrice: optionalNonNegativeNumber(pricing?.prompt),
    completionPrice: optionalNonNegativeNumber(pricing?.completion),
    requestPrice: optionalNonNegativeNumber(pricing?.request),
  };
}

export function enrichRequestLogPricing(log, pricing = {}) {
  const promptTokens = optionalNonNegativeNumber(log?.promptTokens);
  const completionTokens = optionalNonNegativeNumber(log?.completionTokens);
  const promptPrice = optionalNonNegativeNumber(pricing?.promptPrice);
  const completionPrice = optionalNonNegativeNumber(pricing?.completionPrice);
  const requestPrice = optionalNonNegativeNumber(pricing?.requestPrice);
  const status = Number(log?.status);
  const canEstimateCatalogCost = (status >= 200 && status < 300)
    || promptTokens !== null
    || completionTokens !== null
    || optionalNonNegativeNumber(log?.totalCost) !== null;
  const inputCost = promptTokens !== null && promptPrice !== null
    ? promptTokens * promptPrice
    : null;
  const outputCost = completionTokens !== null && completionPrice !== null
    ? completionTokens * completionPrice
    : null;
  const estimatedCost = canEstimateCatalogCost && (inputCost !== null || outputCost !== null || requestPrice !== null)
    ? (inputCost ?? 0) + (outputCost ?? 0) + (requestPrice ?? 0)
    : null;
  const upstreamTotalCost = optionalNonNegativeNumber(log?.totalCost);

  return {
    ...log,
    inputCost,
    outputCost,
    estimatedCost,
    totalCost: upstreamTotalCost ?? estimatedCost,
    costSource: log?.costSource || (estimatedCost === null ? null : 'catalog_estimate'),
    pricing: {
      promptPerToken: promptPrice,
      completionPerToken: completionPrice,
      request: requestPrice,
    },
  };
}
