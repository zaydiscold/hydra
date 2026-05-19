#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const out = resolve(root, 'openapi/hydra-api.openapi.json');

const json = {
  type: 'object',
  additionalProperties: true,
};

const okEnvelope = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: json,
    timestamp: { type: 'string', format: 'date-time' },
  },
  additionalProperties: true,
};

const errorEnvelope = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: { type: 'string' },
    code: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
  },
  additionalProperties: true,
};

const body = (description, extra = {}) => ({
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        description,
        additionalProperties: true,
        ...extra,
      },
    },
  },
});

const responses = {
  200: {
    description: 'Successful Hydra response',
    content: { 'application/json': { schema: okEnvelope } },
  },
  400: {
    description: 'Invalid request',
    content: { 'application/json': { schema: errorEnvelope } },
  },
  401: {
    description: 'Hydra vault is locked or token is invalid',
    content: { 'application/json': { schema: errorEnvelope } },
  },
  429: {
    description: 'Rate limited',
    content: { 'application/json': { schema: errorEnvelope } },
  },
  500: {
    description: 'Server error',
    content: { 'application/json': { schema: errorEnvelope } },
  },
};

const auth = [{ bearerAuth: [] }];

function op(method, path, {
  tag,
  summary,
  security = auth,
  requestBody,
  parameters = [],
}) {
  return [
    method,
    path,
    {
      tags: [tag],
      summary,
      operationId: `${method}_${path.replace(/^\/+/, '').replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+/g, '_')}`.replace(/_+$/g, ''),
      security,
      parameters,
      requestBody,
      responses,
    },
  ];
}

const idParam = (name, description = `${name} identifier`) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
});

const query = (name, description) => ({
  name,
  in: 'query',
  required: false,
  description,
  schema: { type: 'string' },
});

const routeDefs = [
  op('get', '/api/auth/status', { tag: 'auth', summary: 'Read local vault/auth setup status', security: [] }),
  op('post', '/api/auth/setup', { tag: 'auth', summary: 'Create the local Hydra vault password', security: [], requestBody: body('Password setup payload') }),
  op('post', '/api/auth/login', { tag: 'auth', summary: 'Unlock the local Hydra vault', security: [], requestBody: body('Password login payload') }),
  op('post', '/api/auth/logout', { tag: 'auth', summary: 'Clear the current unlock session' }),
  op('post', '/api/auth/change-password', { tag: 'auth', summary: 'Change the local vault password', requestBody: body('Current and replacement password') }),
  op('post', '/api/auth/nuke', { tag: 'auth', summary: 'Wipe local Hydra data after password confirmation', security: [], requestBody: body('Password plus NUKE_HYDRA confirmation') }),
  op('get', '/api/auth/magic-callback', {
    tag: 'auth',
    summary: 'Complete OpenRouter/Clerk magic-link callback',
    security: [],
    parameters: [query('signInId', 'Pending Clerk sign-in id'), query('accountId', 'Hydra account id')],
  }),

  op('get', '/api/accounts', { tag: 'accounts', summary: 'List stored accounts' }),
  op('post', '/api/accounts', { tag: 'accounts', summary: 'Add an account record', requestBody: body('Account fields') }),
  op('post', '/api/accounts/with-credentials', { tag: 'accounts', summary: 'Add an account with login credentials', requestBody: body('Account credentials') }),
  op('post', '/api/accounts/bulk', { tag: 'accounts', summary: 'Create multiple accounts', requestBody: body('Bulk account payload') }),
  op('post', '/api/accounts/bulk-otp-stubs', { tag: 'accounts', summary: 'Create bulk OTP account stubs', requestBody: body('Bulk OTP stub payload') }),
  op('post', '/api/accounts/provision-all', { tag: 'accounts', summary: 'Provision keys for all eligible accounts' }),
  op('post', '/api/accounts/{id}/detect-auth', { tag: 'accounts', summary: 'Detect account auth state', parameters: [idParam('id')] }),
  op('post', '/api/accounts/{id}/login', { tag: 'accounts', summary: 'Start account login', parameters: [idParam('id')], requestBody: body('Login options') }),
  op('post', '/api/accounts/{id}/otp/start', { tag: 'accounts', summary: 'Start OTP login', parameters: [idParam('id')], requestBody: body('OTP start options') }),
  op('post', '/api/accounts/{id}/otp/verify', { tag: 'accounts', summary: 'Verify OTP login code', parameters: [idParam('id')], requestBody: body('OTP code payload') }),
  op('post', '/api/accounts/{id}/provision', { tag: 'accounts', summary: 'Provision a management key for an account', parameters: [idParam('id')] }),
  op('post', '/api/accounts/{id}/refresh', { tag: 'accounts', summary: 'Refresh account dashboard data', parameters: [idParam('id')] }),
  op('post', '/api/accounts/{id}/refresh-login', { tag: 'accounts', summary: 'Refresh account login/session', parameters: [idParam('id')], requestBody: body('Refresh-login options') }),
  op('get', '/api/accounts/{id}/session-status', { tag: 'accounts', summary: 'Read display session status', parameters: [idParam('id')] }),
  op('get', '/api/accounts/{id}/session-check', { tag: 'accounts', summary: 'Run live session check', parameters: [idParam('id')] }),
  op('post', '/api/accounts/{id}/silent-refresh', { tag: 'accounts', summary: 'Attempt silent account refresh', parameters: [idParam('id')] }),
  op('patch', '/api/accounts/{id}', { tag: 'accounts', summary: 'Update account metadata', parameters: [idParam('id')], requestBody: body('Account patch') }),
  op('delete', '/api/accounts/{id}', { tag: 'accounts', summary: 'Delete an account', parameters: [idParam('id')] }),
  op('get', '/api/accounts/{id}/snapshot', { tag: 'accounts', summary: 'Read cached dashboard snapshot', parameters: [idParam('id')] }),
  op('get', '/api/accounts/{id}/management-key', { tag: 'accounts', summary: 'Read legacy management key status', parameters: [idParam('id')] }),
  op('get', '/api/accounts/{id}/management-keys', { tag: 'accounts', summary: 'List stored management keys', parameters: [idParam('id')] }),
  op('post', '/api/accounts/{id}/management-keys/store', { tag: 'accounts', summary: 'Store a provisioned management key', parameters: [idParam('id')], requestBody: body('Management key payload') }),
  op('get', '/api/accounts/{id}/management-keys/best', { tag: 'accounts', summary: 'Read best management key for account', parameters: [idParam('id')] }),
  op('delete', '/api/accounts/{id}/management-keys/{keyId}', { tag: 'accounts', summary: 'Delete a stored management key', parameters: [idParam('id'), idParam('keyId')] }),
  op('get', '/api/accounts/{id}/balance', { tag: 'accounts', summary: 'Read live account balance', parameters: [idParam('id')] }),
  op('post', '/api/accounts/{id}/magic-link/send', { tag: 'accounts', summary: 'Send a magic-link login email', parameters: [idParam('id')], requestBody: body('Magic-link options') }),
  op('get', '/api/accounts/{id}/magic-link/status/{signInId}', { tag: 'accounts', summary: 'Poll magic-link login status', parameters: [idParam('id'), idParam('signInId')] }),

  op('get', '/api/accounts/{accountId}/keys', { tag: 'keys', summary: 'List OpenRouter keys for an account', parameters: [idParam('accountId')] }),
  op('post', '/api/accounts/{accountId}/keys', { tag: 'keys', summary: 'Create an OpenRouter key', parameters: [idParam('accountId')], requestBody: body('Key creation options') }),
  op('post', '/api/accounts/{id}/keys/{hash}/test', { tag: 'keys', summary: 'Test an OpenRouter key', parameters: [idParam('id'), idParam('hash', 'OpenRouter key hash')] }),
  op('patch', '/api/accounts/{accountId}/keys/{hash}', { tag: 'keys', summary: 'Update an OpenRouter key', parameters: [idParam('accountId'), idParam('hash')], requestBody: body('Key patch') }),
  op('delete', '/api/accounts/{accountId}/keys/{hash}', { tag: 'keys', summary: 'Delete an OpenRouter key', parameters: [idParam('accountId'), idParam('hash')] }),

  op('get', '/api/dashboard', { tag: 'dashboard', summary: 'Read full dashboard data' }),
  op('post', '/api/dashboard/refresh', { tag: 'dashboard', summary: 'Refresh dashboard data' }),

  op('post', '/api/codes/redeem', { tag: 'codes', summary: 'Redeem one promo code on one account', requestBody: body('Code redemption payload') }),
  op('post', '/api/codes/bulk', { tag: 'codes', summary: 'Redeem one code across accounts', requestBody: body('Bulk redemption payload') }),
  op('post', '/api/codes/bulk-matrix', { tag: 'codes', summary: 'Redeem multiple codes across accounts', requestBody: body('Code/account matrix') }),
  op('post', '/api/codes/preflight', { tag: 'codes', summary: 'Preflight code redemption readiness', requestBody: body('Accounts/codes to preflight') }),
  op('get', '/api/codes/history', { tag: 'codes', summary: 'Read redemption history' }),
  op('get', '/api/codes/endpoints', { tag: 'codes', summary: 'Read discovered OpenRouter redemption endpoints' }),

  op('post', '/api/generator/start', { tag: 'generator', summary: 'Start account generator signup task', requestBody: body('Generator start options') }),
  op('get', '/api/generator/status/{taskId}', { tag: 'generator', summary: 'Read generator task status', parameters: [idParam('taskId')] }),
  op('post', '/api/generator/{taskId}/heartbeat', { tag: 'generator', summary: 'Heartbeat a generator task', parameters: [idParam('taskId')] }),
  op('post', '/api/generator/verify/{taskId}', { tag: 'generator', summary: 'Verify generator OTP', parameters: [idParam('taskId')], requestBody: body('OTP verification payload') }),
  op('delete', '/api/generator/{taskId}', { tag: 'generator', summary: 'Clean up generator task', parameters: [idParam('taskId')] }),

  op('get', '/api/pool/status', { tag: 'pool', summary: 'Read public proxy/pool liveness', security: [] }),
  op('get', '/api/pool', { tag: 'pool', summary: 'Read account/key pool state' }),
  op('get', '/api/pool/master-key', { tag: 'pool', summary: 'Read derived Hydra proxy key' }),
  op('get', '/api/pool/network', { tag: 'pool', summary: 'Read proxy LAN endpoint information' }),
  op('patch', '/api/pool/key/{hash}', { tag: 'pool', summary: 'Toggle key pooled status', parameters: [idParam('hash')], requestBody: body('Pool toggle payload') }),
  op('post', '/api/pool/account/{accountId}/toggle', { tag: 'pool', summary: 'Bulk-toggle account keys in pool', parameters: [idParam('accountId')] }),
  op('post', '/api/pool/key/{hash}/register', { tag: 'pool', summary: 'Register plaintext key for pooling', parameters: [idParam('hash')], requestBody: body('Plaintext key payload') }),
  op('post', '/api/pool/auto-provision/{accountId}', { tag: 'pool', summary: 'Auto-provision a pooled key', parameters: [idParam('accountId')] }),
  op('post', '/api/pool/sync-keys/{accountId}', { tag: 'pool', summary: 'Sync keys from OpenRouter dashboard', parameters: [idParam('accountId')] }),
  op('patch', '/api/pool/key/{hash}/disable', { tag: 'pool', summary: 'Enable or disable an upstream key', parameters: [idParam('hash')], requestBody: body('Disable toggle payload') }),
  op('delete', '/api/pool/key/{hash}', { tag: 'pool', summary: 'Delete a pooled key', parameters: [idParam('hash')] }),
  op('post', '/api/pool/reload', { tag: 'pool', summary: 'Reload proxy pool state' }),
  op('post', '/api/pool/models/refresh', { tag: 'pool', summary: 'Refresh cached OpenRouter model list' }),
  op('get', '/api/pool/traffic', { tag: 'pool', summary: 'Read traffic metrics' }),
  op('get', '/api/pool/models', { tag: 'pool', summary: 'Read cached model list' }),
  op('get', '/api/pool/sync-status', { tag: 'pool', summary: 'Read pool sync status' }),
  op('post', '/api/pool/rotate-master-key', { tag: 'pool', summary: 'Rotate Hydra proxy master key' }),

  op('get', '/api/system/tasks', { tag: 'system', summary: 'Read background task state' }),
  op('post', '/api/system/tasks/{taskId}/cancel', { tag: 'system', summary: 'Cancel a background task', parameters: [idParam('taskId')] }),
  op('get', '/api/system/health', { tag: 'system', summary: 'Read server, pool, and upstream health' }),
  op('get', '/api/system/proxy-status', { tag: 'system', summary: 'Read proxy kill-switch status' }),
  op('post', '/api/system/proxy-toggle', { tag: 'system', summary: 'Toggle proxy kill-switch', requestBody: body('Proxy enabled state') }),

  op('post', '/api/debug/trpc-probe', { tag: 'debug', summary: 'Probe OpenRouter tRPC routes with stored session', requestBody: body('Probe options') }),
  op('post', '/api/debug/vampire-mode', { tag: 'debug', summary: 'Run OpenRouter dashboard session diagnostics', requestBody: body('Diagnostic options') }),
  op('post', '/api/debug/cookie-ttl', { tag: 'debug', summary: 'Inspect Clerk client cookie TTL', requestBody: body('Account/session options') }),
  op('post', '/api/webhooks/clerk', { tag: 'webhooks', summary: 'Receive Clerk session lifecycle webhooks', security: [], requestBody: body('Clerk webhook payload') }),
  op('post', '/api/shutdown', { tag: 'system', summary: 'Shut down embedded Hydra server', requestBody: body('SHUTDOWN_HYDRA confirmation') }),

  op('get', '/v1/models', { tag: 'proxy', summary: 'OpenAI-compatible model list via Hydra proxy', security: [{ hydraProxyKey: [] }] }),
  op('post', '/v1/chat/completions', { tag: 'proxy', summary: 'OpenAI-compatible chat completions via OpenRouter rotation', security: [{ hydraProxyKey: [] }], requestBody: body('OpenAI chat completion payload') }),
];

const paths = {};
for (const [method, path, operation] of routeDefs) {
  paths[path] ??= {};
  paths[path][method] = operation;
}

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Hydra Local API',
    version: '1.0.0',
    description: 'Local API for Hydra, the Electron OpenRouter account, key, promo-code, and proxy manager.',
  },
  servers: [
    { url: 'http://127.0.0.1:3001', description: 'Default local development server' },
    { url: 'http://localhost:3001', description: 'Default localhost server' },
  ],
  'x-mcp': {
    transport: ['stdio', 'http'],
    orchestration: 'code',
    endpoint_tools: 'hidden',
    privacy: 'private-local-only',
    note: 'Hydra is a private local app. This map is for Hydra-native CLI/API planning only; do not upload, publish, register, or sync it into a public Printing Press/library catalog.',
  },
  tags: ['auth', 'accounts', 'keys', 'dashboard', 'codes', 'generator', 'pool', 'system', 'debug', 'webhooks', 'proxy']
    .map((name) => ({ name })),
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      hydraProxyKey: { type: 'http', scheme: 'bearer', description: 'Hydra proxy key such as sk-hydra-*' },
    },
    schemas: {
      OkEnvelope: okEnvelope,
      ErrorEnvelope: errorEnvelope,
    },
  },
  paths,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`[generate-hydra-openapi] wrote ${out} (${routeDefs.length} operations)`);
