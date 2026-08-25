// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HYDRA = join(ROOT, 'bin/hydra.mjs');
const MODERN_PROTOCOL_VERSION = '2026-07-28';
const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';
const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

function runHydra(args) {
  const result = spawnSync(process.execPath, [HYDRA, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function newlineFrame(message) {
  return `${JSON.stringify(message)}\n`;
}

function contentLengthFrame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function parseNewlineFrames(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function parseContentLengthFrames(text) {
  const messages = [];
  let offset = 0;
  while (offset < text.length) {
    const headerEnd = text.indexOf('\r\n\r\n', offset);
    if (headerEnd < 0) break;
    const header = text.slice(offset, headerEnd);
    const match = header.match(/content-length:\s*(\d+)/i);
    assert.ok(match, `missing Content-Length in ${header}`);
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    messages.push(JSON.parse(text.slice(bodyStart, bodyEnd)));
    offset = bodyEnd;
  }
  return messages;
}

function runMcpExchange(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HYDRA, 'mcp'], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function modernMeta() {
  return {
    [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'hydra-test', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

test('hydra mcp lists private read-only local fleet tools', () => {
  const report = JSON.parse(runHydra(['mcp', '--list-tools']));
  const names = report.tools.map((tool) => tool.name);

  assert.deepEqual(
    names,
    ['hydra_status', 'hydra_proxy_status', 'hydra_api_map', 'hydra_audit', 'hydra_doctor'],
  );
  for (const tool of report.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.idempotentHint, true);
    assert.equal(Object.hasOwn(tool, 'command'), false, 'MCP tool list must not leak command internals');
  }
});

test('hydra mcp uses newline-delimited stdio and supports the modern stateless lifecycle', async () => {
  const input = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'server/discover',
      params: { _meta: modernMeta() },
    },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: { _meta: modernMeta() },
    },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'hydra_api_map',
        arguments: { tag: 'system' },
        _meta: modernMeta(),
      },
    },
  ].map(newlineFrame).join('');

  const { code, stdout, stderr } = await runMcpExchange(input);
  assert.equal(code, 0, stderr);
  assert.doesNotMatch(stdout, /Content-Length:/i, 'standard stdio output must be newline-delimited JSON');

  const messages = parseNewlineFrames(stdout);
  assert.equal(messages.length, 3);

  assert.equal(messages[0].id, 1);
  assert.ok(messages[0].result.supportedVersions.includes(MODERN_PROTOCOL_VERSION));
  assert.equal(messages[0].result.resultType, 'complete');
  assert.equal(messages[0].result.cacheScope, 'private');
  assert.equal(messages[0].result._meta[SERVER_INFO_META_KEY].name, 'hydra-local');

  assert.equal(messages[1].id, 2);
  assert.equal(messages[1].result.resultType, 'complete');
  assert.equal(messages[1].result.cacheScope, 'private');
  assert.ok(messages[1].result.tools.some((tool) => tool.name === 'hydra_audit'));

  assert.equal(messages[2].id, 3);
  assert.equal(messages[2].result.resultType, 'complete');
  const payload = messages[2].result.structuredContent;
  assert.equal(payload.routes.every((route) => route.tag === 'system'), true);
  assert.ok(payload.routes.some((route) => route.path === '/api/system/health'));
  assert.equal(JSON.parse(messages[2].result.content[0].text).routes.length, payload.routes.length);
});

test('hydra mcp retains legacy initialize and Content-Length compatibility', async () => {
  const initialize = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'legacy-test', version: '1.0.0' },
    },
  };
  const list = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  };

  const { code, stdout, stderr } = await runMcpExchange(
    contentLengthFrame(initialize) + contentLengthFrame(list),
  );
  assert.equal(code, 0, stderr);

  const messages = parseContentLengthFrames(stdout);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].result.protocolVersion, '2025-11-25');
  assert.equal(messages[0].result.serverInfo.name, 'hydra-local');
  assert.equal(messages[1].result.tools.length, 5);
  assert.equal(Object.hasOwn(messages[1].result, 'ttlMs'), false, 'legacy list results stay unchanged');
});

test('hydra mcp returns JSON-RPC errors for malformed or invalid requests', async () => {
  const input = [
    '{not-json}\n',
    newlineFrame({ jsonrpc: '1.0', id: 2, method: 'tools/list' }),
    newlineFrame({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: '', arguments: {} },
    }),
  ].join('');

  const { code, stdout, stderr } = await runMcpExchange(input);
  assert.equal(code, 0, stderr);
  const messages = parseNewlineFrames(stdout);
  assert.deepEqual(messages.map((message) => message.error.code), [-32700, -32600, -32602]);
});
