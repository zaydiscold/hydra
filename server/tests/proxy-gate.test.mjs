// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.HYDRA_DATA_DIR = mkdtempSync(join(tmpdir(), 'hydra-proxy-gate-'));

const { proxyGate } = await import('../services/proxy-gate.js');

test('proxyGate emits changes only when enabled state changes', () => {
  const seen = [];
  const off = proxyGate.onChange((state) => seen.push(state.enabled));

  proxyGate.set(true);
  proxyGate.set(false);
  proxyGate.set(false);
  proxyGate.enable();
  off();
  proxyGate.disable();

  assert.deepEqual(seen, [false, true]);
});

test('proxyGate persisted-state fallback is visible', () => {
  const source = new URL('../services/proxy-gate.js', import.meta.url);
  const text = readFileSync(source, 'utf8');

  assert.match(text, /Ignoring invalid persisted state shape/);
  assert.match(text, /Could not read persisted state/);
  assert.match(text, /defaulting enabled=true/);
  assert.doesNotMatch(text, /catch \{ \/\* file missing or corrupt/);
});
