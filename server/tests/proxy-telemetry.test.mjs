// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichRequestLogPricing,
  getProxyMaxKeyAttempts,
  normalizeCatalogPricing,
  normalizeUsageCost,
} from '../services/proxy-telemetry.js';

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} should be close to ${expected}`);
}

test('proxy key-attempt ceiling defaults to eight and clamps unsafe values', () => {
  assert.equal(getProxyMaxKeyAttempts(), 8);
  assert.equal(getProxyMaxKeyAttempts('12'), 12);
  assert.equal(getProxyMaxKeyAttempts('999'), 32);
  assert.equal(getProxyMaxKeyAttempts('0'), 8);
  assert.equal(getProxyMaxKeyAttempts('invalid'), 8);
});

test('catalog pricing accepts non-negative OpenRouter per-token values', () => {
  assert.deepEqual(normalizeCatalogPricing({
    prompt: '0.0000015',
    completion: '0.000006',
    request: '0',
  }), {
    promptPrice: 0.0000015,
    completionPrice: 0.000006,
    requestPrice: 0,
  });
  assert.equal(normalizeCatalogPricing({ prompt: '-1' }).promptPrice, null);
});

test('request log pricing preserves exact OpenRouter total and calculates in/out estimates', () => {
  const enriched = enrichRequestLogPricing({
    promptTokens: 15,
    completionTokens: 57,
    totalCost: 0.00044,
    costSource: 'openrouter_usage',
  }, {
    promptPrice: 0.000001,
    completionPrice: 0.000004,
    requestPrice: 0,
  });

  assertClose(enriched.inputCost, 0.000015);
  assertClose(enriched.outputCost, 0.000228);
  assertClose(enriched.estimatedCost, 0.000243);
  assert.equal(enriched.totalCost, 0.00044);
  assert.equal(enriched.costSource, 'openrouter_usage');
});

test('request log pricing falls back to catalog estimate when upstream omits cost', () => {
  const enriched = enrichRequestLogPricing({
    promptTokens: 10,
    completionTokens: 20,
    totalCost: null,
    costSource: null,
  }, {
    promptPrice: 0.000001,
    completionPrice: 0.000002,
  });

  assertClose(enriched.inputCost, 0.00001);
  assertClose(enriched.outputCost, 0.00004);
  assertClose(enriched.totalCost, 0.00005);
  assert.equal(enriched.costSource, 'catalog_estimate');
});

test('usage accounting stores an exact total only when upstream supplies one', () => {
  assert.deepEqual(normalizeUsageCost({ cost: 0.25 }), {
    totalCost: 0.25,
    costSource: 'openrouter_usage',
  });
  assert.deepEqual(normalizeUsageCost({}), {
    totalCost: null,
    costSource: null,
  });
});
