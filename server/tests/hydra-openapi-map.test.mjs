import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;

const routeFiles = [
  ['server/routes/auth.js', '/api/auth'],
  ['server/routes/accounts.js', '/api/accounts'],
  ['server/routes/keys.js', '/api/accounts'],
  ['server/routes/dashboard.js', '/api/dashboard'],
  ['server/routes/codes.js', '/api/codes'],
  ['server/routes/generator.js', '/api/generator'],
  ['server/routes/pool.js', '/api/pool'],
  ['server/routes/system.js', '/api/system'],
  ['server/routes/debug.js', '/api/debug'],
  ['server/routes/webhooks.js', '/api/webhooks'],
];

function normalizeExpressPath(prefix, path) {
  const full = `${prefix}${path === '/' ? '' : path}`;
  return full.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function routesFromFile(file, prefix) {
  const source = readFileSync(join(ROOT, file), 'utf-8');
  const routes = [];
  const routePattern = /router\.(get|post|patch|delete|put)\(\s*['"`]([^'"`]+)['"`]/g;
  for (const match of source.matchAll(routePattern)) {
    routes.push({
      method: match[1],
      path: normalizeExpressPath(prefix, match[2]),
    });
  }
  return routes;
}

test('Hydra OpenAPI map covers the concrete Express route files', () => {
  const spec = JSON.parse(readFileSync(join(ROOT, 'openapi/hydra-api.openapi.json'), 'utf-8'));
  const missing = [];

  for (const [file, prefix] of routeFiles) {
    for (const route of routesFromFile(file, prefix)) {
      if (!spec.paths?.[route.path]?.[route.method]) {
        missing.push(`${route.method.toUpperCase()} ${route.path} (${file})`);
      }
    }
  }

  const fixedRoutes = [
    ['post', '/api/shutdown'],
    ['get', '/v1/models'],
    ['post', '/v1/chat/completions'],
  ];
  for (const [method, path] of fixedRoutes) {
    if (!spec.paths?.[path]?.[method]) {
      missing.push(`${method.toUpperCase()} ${path} (fixed route)`);
    }
  }

  assert.deepEqual(missing, []);
});
