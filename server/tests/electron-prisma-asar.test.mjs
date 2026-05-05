/**
 * electron-prisma-asar.test.mjs
 *
 * Validates that the Prisma schema's generator block includes the binary targets
 * needed for Electron asar packaging across all target platforms.
 *
 * If Prisma's native query engine binary isn't available for the host platform
 * inside the asar archive, all database operations fail. This test catches
 * missing binaryTargets entries early in CI.
 *
 * Required targets (matching electron-builder mac/win/linux targets):
 *   - darwin        (macOS x64)
 *   - darwin-arm64  (macOS Apple Silicon)
 *   - debian-openssl-3.0.x  (Linux x64 — Debian/Ubuntu-based distros)
 *   - linux-arm64-openssl-3.0.x  (Linux ARM64 — e.g. Raspberry Pi / Docker)
 *   - windows       (Windows x64)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '../../prisma/schema.prisma');

/**
 * Parse the Prisma schema's generator block and extract the binaryTargets list.
 * Returns null if no binaryTargets are declared.
 */
function parseBinaryTargets(schemaPath) {
  const content = readFileSync(schemaPath, 'utf-8');
  const lines = content.split('\n');

  let inGenerator = false;
  let inBinaryTargets = false;
  const binaryTargets = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect start of generator block
    if (trimmed.startsWith('generator ')) {
      inGenerator = true;
      continue;
    }

    if (!inGenerator) continue;

    // Detect end of generator block (next top-level keyword or closing brace ... well Prisma uses no braces)
    if (trimmed === '' || (trimmed.startsWith('model ') || trimmed.startsWith('datasource ') || trimmed.startsWith('enum ') || trimmed.startsWith('generator '))) {
      if (inBinaryTargets) break; // reached the end of binaryTargets list
      if (trimmed.startsWith('generator ')) {
        // Another generator block (unlikely, but handle it)
        inBinaryTargets = false;
        continue;
      }
      // Blank line or next top-level block — if we were gathering binaryTargets we're done
      if (inBinaryTargets && trimmed === '') break;
      if (trimmed.startsWith('model ') || trimmed.startsWith('datasource ') || trimmed.startsWith('enum ')) {
        break;
      }
      continue;
    }

    // Detect binaryTargets declaration
    if (trimmed.startsWith('binaryTargets')) {
      inBinaryTargets = true;
      // Could be inline: binaryTargets = ["darwin", ...]
      const match = trimmed.match(/\[(.*?)\]/);
      if (match) {
        return match[1].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      }
      // Or multi-line: binaryTargets = [ ... ]
      // The content after the = might start with [ or might be on next lines
      continue;
    }

    if (inBinaryTargets) {
      // Collect values from array lines
      const match = trimmed.match(/"([^"]+)"/);
      if (match) {
        binaryTargets.push(match[1]);
      }
      // If we hit the closing bracket, we're done
      if (trimmed.includes(']')) {
        break;
      }
    }
  }

  return binaryTargets.length > 0 ? binaryTargets : null;
}

test('Prisma schema includes binaryTargets for asar packaging', () => {
  const targets = parseBinaryTargets(SCHEMA_PATH);

  assert.ok(targets !== null, 'generator block must declare binaryTargets');
  assert.ok(Array.isArray(targets), 'binaryTargets must be an array');
  assert.ok(targets.length >= 5, `expected at least 5 binaryTargets, got ${targets.length}: ${JSON.stringify(targets)}`);
});

test('binaryTargets includes darwin (macOS x64)', () => {
  const targets = parseBinaryTargets(SCHEMA_PATH);
  assert.ok(targets.includes('darwin'), 'binaryTargets must include "darwin" for macOS x64');
});

test('binaryTargets includes darwin-arm64 (macOS Apple Silicon)', () => {
  const targets = parseBinaryTargets(SCHEMA_PATH);
  assert.ok(targets.includes('darwin-arm64'), 'binaryTargets must include "darwin-arm64" for Apple Silicon');
});

test('binaryTargets includes debian-openssl-3.0.x (Linux x64)', () => {
  const targets = parseBinaryTargets(SCHEMA_PATH);
  assert.ok(targets.includes('debian-openssl-3.0.x'), 'binaryTargets must include "debian-openssl-3.0.x" for Linux x64');
});

test('binaryTargets includes linux-arm64-openssl-3.0.x', () => {
  const targets = parseBinaryTargets(SCHEMA_PATH);
  assert.ok(
    targets.includes('linux-arm64-openssl-3.0.x'),
    'binaryTargets must include "linux-arm64-openssl-3.0.x" for Linux ARM64',
  );
});

test('binaryTargets includes windows (Windows x64)', () => {
  const targets = parseBinaryTargets(SCHEMA_PATH);
  assert.ok(targets.includes('windows'), 'binaryTargets must include "windows" for Windows x64');
});
